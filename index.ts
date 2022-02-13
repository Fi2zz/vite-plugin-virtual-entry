import fs from "fs";
import * as http from "http";
import { NormalizedOutputOptions, OutputBundle, OutputChunk } from "rollup";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { Connect } from "vite/types/connect";

type EntryFile = /* .ts,.tsx,.js,.jsx,.html */ string;
type BaseEntry = EntryFile | { [EntryName: string]: EntryFile };
export type Entry = BaseEntry | BaseEntry[];
export type RenderOption = {
	html: string;
	name: string;
	entry: string;
};
export type Render = (option: RenderOption) => RenderOption["html"];
export type UserOption = {
	entry?: Entry;
	render?: Render;
};
export type createPlugin = (option: UserOption) => Plugin;
function buildHTML(entry: EntryFile) {
	return `<!DOCTYPE html>
<html>
<head></head>
<body><script type="module" src="${entry}"></script></body>
</html>
`;
}

function buildNotfound(keys: string[], url: string, origin: string) {
	return `<!DOCTYPE html>
<html>
<head></head>
<body>
${url != "/" ? ` <h2>Sorry, Request path'${url}'not found</h2>` : ""}
<h3>Available paths: </h3>
${keys
	.map(
		(name, index) =>
			`<div>${index + 1}.<a href='${origin}${name}'>${origin}${name}</a></div>`
	)
	.join("")}
</body>
</html>
`;
}

const pluginName = "vite-plugin-multi-virtual-html";
function readHtml(filename?: string) {
	if (!filename || !filename.endsWith(".html")) return null;
	if (!fs.existsSync(filename)) return null;
	return fs.readFileSync(filename).toString();
}
const PREFIX = `\0virtual__${pluginName}__`;
function wrapVirtualId(name: string) {
	name = name.startsWith("/") ? name : `/${name}`;
	return `${PREFIX}${name}`;
}
function unwrapVirtualId(id: string) {
	return id.replace(PREFIX, "");
}
function getEntryName(name: string, root: string) {
	return name
		.replace(root, "")
		.replace(/^((\.)?\/)/, "")
		.replace(/\.(html|js|ts|jsx|tsx)$/, "")
		.replace(/(\/)$/, "");
}

type Input = {
	[k: string]: string;
};
type VirtualMap = Map<string, VirtualItem>;
type VirtualItem = {
	entry: string;
	htmlName: string;
	name: string;
	virtualId: string;
	root: string;
};
function getInputs(virtual: VirtualMap) {
	return Array.from(virtual.values()).reduce(
		(acc: Input, { name, virtualId }: VirtualItem) => {
			acc[name] = virtualId;
			return acc;
		},
		{}
	);
}

type FormattedEntry = {
	name: string;
	entry: string;
};

function getEntries(root: string, entry?: Entry) {
	function formatEntry(entry?: Entry): FormattedEntry[] {
		if (!entry) return [];
		if (Array.isArray(entry)) {
			return entry
				.map((entry) => {
					if (typeof entry == "string") return { name: entry, entry };
					return formatEntry(entry);
				})
				.flat();
		} else if (typeof entry == "string") {
			return [{ name: entry, entry: entry }];
		}
		return Object.entries(entry!).map(([name, entry]) => ({ name, entry }));
	}

	return formatEntry(entry).reduce(function (acc, { name, entry }) {
		entry = entry.replace(/^(\.)/, "");
		name = getEntryName(name, root);
		if (name == "index") name = getEntryName(entry, root);
		const virtualId = wrapVirtualId(name);
		acc.set(virtualId, {
			entry,
			htmlName: `./${name}.html`,
			name,
			virtualId,
			root,
		});
		return acc;
	}, new Map());
}

const htmlRE = /^(\<(html|!doctype))/i;

function handleNotFound(
	req: Connect.IncomingMessage,
	res: http.ServerResponse,
	keys: string[]
): void {
	let origin = (req.headers.origin || req.headers.host) as string;
	if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
		origin = "http://" + origin;
	}
	const html = buildNotfound(keys, req.originalUrl as string, origin);
	res.setHeader("content-type", "text/html").end(html);
}
import * as path from "path";
function createPlugin(options?: UserOption): Plugin {
	// @ts-ignore
	if (!options) return null;
	var virtual: VirtualMap = new Map();
	function load(id: string) {
		if (!virtual.has(id)) return null;
		const found = virtual.get(id);
		return `import "${found!.entry}";`;
	}
	function resolveId(id: string) {
		return virtual.has(id) ? id : null;
	}
	function renderHTML(virtualItem: VirtualItem, render?: Render) {
		const { name, entry, root } = virtualItem ?? {
			name: "",
			entry: "",
			root: "",
		};

		if (!entry.endsWith(".html")) {
			let html = buildHTML(entry.replace(root, ""));
			if (typeof render == "function") {
				var result = render({ html, name, entry });
				if (typeof result == "string") result = result.trim();
				if (htmlRE.test(result)) return result;
				console.log(
					`[${pluginName}]`,
					"Seems `options.render` returns non-html string, fallback to built-in html,got:"
				);
				console.log(`[${pluginName}]`, JSON.stringify(result));
				console.log();
			}
			return html;
		}
		return readHtml(entry);
	}
	function configResolved(config: ResolvedConfig) {
		virtual = getEntries(config.root, options!.entry);
		const indexHTML = path.resolve(config.root, "index.html");
		if (fs.existsSync(indexHTML) && !virtual.has("index")) {
			virtual.set("index", {
				htmlName: "./index.html",
				entry: indexHTML,
				name: "index",
				virtualId: wrapVirtualId("index"),
				root: config.root,
			});
		}
		if (config.command == "build") {
			const input = getInputs(virtual);
			config.build.rollupOptions.input = getInputs(virtual);
			//@ts-ignore
			config.plugins = config.plugins.map((plugin: Plugin) => {
				if (plugin.name !== "vite:build-html") return plugin;
				const originalTransform = plugin.transform as Plugin["transform"];
				const originalGenerateBundle =
					plugin.generateBundle as Plugin["generateBundle"];
				plugin.transform = function (code: string, id: string) {
					if (virtual.has(id)) {
						const found = virtual.get(id);
						//  vite:build-html only accept id ends with '.html'
						id = found!.htmlName;
						code = renderHTML(found as VirtualItem, options!.render) as string;
					}
					return originalTransform!.call(this, code, id);
				};
				plugin.generateBundle = function (
					options: NormalizedOutputOptions,
					bundle: OutputBundle,
					isWrite: boolean
				) {
					for (const key in bundle) {
						const chunk = bundle[key] as unknown as OutputChunk;
						if (!chunk || !chunk.facadeModuleId) continue;
						const facadeModuleId = chunk.facadeModuleId! as string;
						// chunk.facadeModuleId ends with '.html'
						if (virtual.has(facadeModuleId)) {
							const found = virtual.get(facadeModuleId) as VirtualItem;
							chunk.facadeModuleId = found.htmlName;
							bundle[key] = chunk;
						}
					}
					originalGenerateBundle!.call(this, options, bundle, isWrite);
				};
				return plugin;
			});
		}
	}

	function configureServer(server: ViteDevServer) {
		const keys = Array.from(virtual.keys()).map((x) => unwrapVirtualId(x));
		function foundId(url: string): string {
			return keys.find((key) => url.includes(key)) as string;
		}

		server.middlewares.use(async (req, res, next) => {
			if (res.writableEnded) return next();
			const accept = req.headers["accept"];
			if (accept === "*/*") return next();
			if (!accept || !accept.startsWith("text/html")) return next();
			//  we don't care about the `?xxx=xxx`
			var [url] = req.originalUrl!.split("?");
			//  for SPA history router, eg:vue-router
			/**	vite.config.js
			 *  virtualEntry({
			 * 		entry :{ base: '/path/to/base/some.js' }
			 * 	})
			 *
			 * 	SPA router.js
			 * 	 export default{
			 * 		routes:	[
			 * 			{ pathname: '/base' },
			 * 			{ pathname: '/base/sub' },
			 * 			{ pathname: '/base/sub/path/' },
			 * 		]
			 * }
			 *  foundId('/base') => 			'/base'
			 *  foundId('/base/sub') => 		'/base'
			 *  foundId('/base/sub/path') => 	'/base'
			 *
			 *  foundId('/other') => 			undefined
			 *  foundId('/other/sub/path') => 	undefined
			 */
			let html: string | undefined;
			if (url == "/" || url == "/index.html") {
				url = "index";
			} else {
				url = url.replace(/(\.htm|\/)$/, "");
			}
			const id = foundId(url) as string;
			if (id) {
				const found = virtual.get(wrapVirtualId(id)) as VirtualItem;
				html = renderHTML(found, options!.render) as string;
			}
			if (!html) return handleNotFound(req, res, keys);
			html = await server.transformIndexHtml(req.originalUrl!, html!);
			res.end(html);
		});
	}
	return {
		name: pluginName,
		load,
		resolveId,
		configResolved,
		configureServer,
	};
}
export { createPlugin };
export default createPlugin;
// @ts-ignore
module.exports = createPlugin;
