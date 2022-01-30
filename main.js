function getTemplate(injection = {}) {
	return `
<!DOCTYPE html>
<html>
	<head>
	<meta charset="utf-8" />
	<title>${injection.title}</title>
	${injection.head}
	</head>
	<body>${injection.body}</body>
</html>
`;
}
function isPlainObject(v) {
	return Object.prototype.toString.call(v) === "[object Object]";
}

function formatMeta(meta) {
	return Object.entries(meta)
		.map(([name, content]) => {
			content = JSON.stringify(content);
			return `<meta name="${name}" content=${content} />`;
		})
		.join("\n");
}

function checkString(input, defaultValue = "") {
	return input && typeof input == "string" ? input : defaultValue;
}
const { mergeConfig } = require("vite");
const container = "<div id='root'> </div>";
function injectionCreator(injections = {}) {
	return (url, entry) => {
		const injection = injections[url] || {};
		injection.body = checkString(injection.body);
		injection.head = checkString(injection.head);
		injection.title = checkString(injection.title, "Title");
		injection.container = checkString(injection.container, container);
		if (isPlainObject(injection.meta)) {
			const metaTags = formatMeta({
				viewport: "width=device-width, initial-scale=1",
				...injection.meta,
			});
			injection.head = `${metaTags}\n${injection.head}`;
		}
		injection.body =
			injection.container +
			"\n" +
			injection.body +
			"\n" +
			`<script type="module" src="${entry}"></script>`;
		return injection;
	};
}

/**
 *
 * @param {object}  options
 * @param {object}  options.entry ,  webpack option entry like:{[entryName]:entryFilePath }
 * @param {object}  options.injections {[entryName]:{body,head,title,meta,container}}
 * @param {boolean} options.generateHTML
 * @returns  [pluginAutoServeVirtualHTML?,pluginVirtualInput,pluginVirtualEntry,pluginGenerateHTML ]
 */
function createPlugin(options) {
	const { entry = {}, injections, generateHTML = true } = options;
	const createInjection = injectionCreator(injections);
	const VIRTUAL_MODULE_PREFIX = `\0virtual:`;
	const { virtualInput, importEntry, serveMap, templates } = Object.entries(
		entry
	).reduce(
		(acc, [entryName, entryFile]) => {
			const virtualId = VIRTUAL_MODULE_PREFIX + entryName;
			acc.virtualInput[entryName] = virtualId;
			const outputId = `/${entryName}.js`;
			const servInjection = createInjection(entryFile);
			const buildInjection = createInjection(outputId);
			const servePath = `/${entryName}`;
			acc.serveMap[servePath] = getTemplate(servInjection);
			const entry = `import "${entryFile}";`;
			acc.importEntry[virtualId] = entry;
			const templateId = `${entryName}.html`;
			acc.templates.push({
				id: templateId,
				template: getTemplate(buildInjection),
			});
			return acc;
		},
		{ importEntry: {}, virtualInput: {}, serveMap: {}, templates: [] }
	);

	function vitePluginServeHTML() {
		return {
			enforce: "pre",
			name: "vite-plugin-serve-html",
			apply: "serve",
			configureServer(server) {
				return () => {
					server.middlewares.use(async (req, res, next) => {
						const accept = req.headers["accept"];
						if (accept === "*/*") return next();
						if (!accept || !accept.startsWith("text/html")) return next();
						const [url, _querystring] = req.originalUrl.split("?");
						const tpl = await server.transformIndexHtml(url, serveMap[url]);
						res.end(tpl);
					});
				};
			},
		};
	}
	function vitePluginVirtualHTMLTemplate() {
		return {
			apply: "build",
			name: "vite-plugin-virtual-html-template",
			config: (config) =>
				mergeConfig(config, {
					build: {
						rollupOptions: {
							input: virtualInput,
						},
					},
				}),
			resolveId: (id) => (importEntry[id] ? id : null),
			load: (id) => importEntry[id] || null,
			generateBundle() {
				if (!generateHTML) return;
				templates.forEach(({ id, template }) => {
					this.emitFile({
						type: "asset",
						fileName: id,
						source: template,
					});
				});
			},
		};
	}
	return [vitePluginServeHTML(), vitePluginVirtualHTMLTemplate()];
}
module.exports = createPlugin;
