function buildHTML(entry) {
	return `<!DOCTYPE html>
<html>
<head></head>
<body><script type="module" src="${entry}"></script></body>
</html>
`;
}
const pluginName = "vite-plugin-virtual-entry";
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

const pwd = process.cwd();
function formatEntry(entry) {
	if (Array.isArray(entry)) {
		entry = entry
			.map((entry) => {
				if (typeof entry == "string") return { name: entry, entry };
				return formatEntry(entry);
			})
			.flat();
	} else if (typeof entry == "string") {
		entry = [{ name: "main", entry: entry }];
	} else {
		entry = Object.entries(entry).map(([name, entry]) => ({ name, entry }));
	}
	return entry;
}
function virtualReducer(root) {
	return function (acc, { name, entry }) {
		name = name
			.replace(pwd, "")
			.replace(/\.*$/, "")
			.replace(/(main|index)$/i, "")
			.replace(/(\/)$/, "")
			.replace(/^(\/)/, "");
		const virtualId = generateVirtualId(name);
		acc.set(virtualId, {
			entry,
			htmlName: `./${name}.html`,
			name,
			virtualId,
			root,
		});
		return acc;
	};
}
function inputReducer(acc, { name, virtualId }) {
	acc[name] = virtualId;
	return acc;
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
		virtual = formatEntry(options.entry).reduce(
			virtualReducer(config.root),
			virtual
		);
		if (config.command == "build") {
			const input = Array.from(virtual.values());
			config.build.rollupOptions.input = input.reduce(inputReducer, {});
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
		const routes = Array.from(virtual.keys())
			.map(unwrapVirtualId)
			.map((entry) => `<a href='${entry}' >${entry}</a>`);
		server.middlewares.use(async (req, res, next) => {
			if (res.writableEnded) return next();
			const accept = req.headers["accept"];
			if (accept === "*/*") return next();
			if (!accept || !accept.startsWith("text/html")) return next();
			//  we don't care about the `?xxx=xxx`
			const [url] = req.originalUrl.split("?");
			const found = virtual.get(generateVirtualId(url));
			// `/` or `/index.html` or not found
			if (url == "/" || url == "/index.html" || !found)
				return res.end(routes.join("<br/>"));
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
