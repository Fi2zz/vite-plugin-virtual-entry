function buildHTML(entry) {
	return `<!DOCTYPE html>
<html>
<head></head>
<body><script type="module" src="${entry}"></script></body>
</html>
`;
}
const pluginName = "vite-plugin-multi-virtual-html";
const fs = require("fs");
function readHtml(filename) {
	if (!fs.existsSync(filename)) return null;
	return fs.readFileSync(filename).toString();
}
const PREFIX = `\0virtual__${pluginName}__`;
function generateVirtualId(name) {
	name = name.startsWith("/") ? name : `/${name}`;
	return `${PREFIX}${name}`;
}
function unwrapVirtualId(id) {
	return id.replace(PREFIX, "");
}
function getEntryName(name, root) {
	return name
		.replace(root, "")
		.replace(/^((\.)?\/)/, "")
		.replace(/\.(html|js|ts|jsx|tsx)$/, "")
		.replace(/(\/)$/, "");
}

function getInputs(virtual) {
	return Array.from(virtual.values()).reduce(function inputReducer(
		acc,
		{ name, virtualId }
	) {
		acc[name] = virtualId;
		return acc;
	},
	{});
}

function getEntries(entry, root) {
	function formatEntry(entry) {
		if (Array.isArray(entry)) {
			entry = entry
				.map((entry) => {
					if (typeof entry == "string") return { name: entry, entry };
					return formatEntry(entry);
				})
				.flat();
		} else if (typeof entry == "string") {
			entry = [{ name: entry, entry: entry }];
		} else {
			entry = Object.entries(entry).map(([name, entry]) => ({ name, entry }));
		}
		return entry;
	}

	return formatEntry(entry).reduce(function (acc, { name, entry }) {
		entry = entry.replace(/^(\.)/, "");
		name = getEntryName(name, root);
		if (name == "index") name = getEntryName(entry, root);
		const virtualId = generateVirtualId(name);
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

function createPlugin(options) {
	var virtual = new Map();

	function load(id) {
		if (!virtual.has(id)) return null;
		const found = virtual.get(id);
		return `import "${found.entry}";`;
	}
	function resolveId(id) {
		return virtual.has(id) ? id : null;
	}
	function renderHTML({ name, entry, root }, render) {
		if (entry.endsWith(".html")) {
			return readHtml(entry);
		} else {
			let html = buildHTML(entry.replace(root, ""));
			if (typeof render == "function") {
				const result = render({ html, name, entry });
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
	}
	function configResolved(config) {
		virtual = getEntries(options.entry, config.root);
		if (config.command == "build") {
			config.build.rollupOptions.input = getInputs(virtual);
			config.plugins = config.plugins.map((plugin) => {
				if (plugin.name !== "vite:build-html") return plugin;
				const originalTransform = plugin.transform;
				const originalGenerateBundle = plugin.generateBundle;
				plugin.transform = function (code, id) {
					if (virtual.has(id)) {
						const found = virtual.get(id);
						//  vite:build-html only accept id ends with '.html'
						id = found.htmlName;
						code = renderHTML(found, options.render);
					}
					return originalTransform.call(this, code, id);
				};
				plugin.generateBundle = function (options, bundle) {
					for (const key in bundle) {
						const chunk = bundle[key];
						if (!chunk.facadeModuleId) continue;
						// chunk.facadeModuleId ends with '.html'
						if (virtual.has(chunk.facadeModuleId)) {
							const { htmlName } = virtual.get(chunk.facadeModuleId);
							chunk.facadeModuleId = htmlName;
							bundle[key] = chunk;
						}
					}
					originalGenerateBundle.call(this, options, bundle);
				};
				return plugin;
			});
		}
	}
	function configureServer(server) {
		const routes = (origin) =>
			Array.from(virtual.keys())
				.map(unwrapVirtualId)
				.map(
					(entry) =>
						`<li> <a href='${origin}${entry}'>${origin}${entry}</a></li>`
				)
				.join("");
		server.middlewares.use(async (req, res, next) => {
			if (res.writableEnded) return next();
			const accept = req.headers["accept"];
			if (accept === "*/*") return next();
			if (!accept || !accept.startsWith("text/html")) return next();
			//  we don't care about the `?xxx=xxx`
			const [url] = req.originalUrl.split("?");
			const found = virtual.get(generateVirtualId(url.replace(".html", "")));
			//  not found
			if (!found) {
				let origin = req.headers.origin || req.headers.host;
				if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
					origin = "http://" + origin;
				}
				const html = `
				<h1>Sorry, Request path'${req.originalUrl}'not found</h1>
				<h3>Available paths: </h3>
				<ul>${routes(origin)}</ul>`;
				return res.setHeader("content-type", "text/html").end(html);
			}
			res.end(
				await server.transformIndexHtml(url, renderHTML(found, options.render))
			);
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
module.exports = createPlugin;
