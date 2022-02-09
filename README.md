# vite-plugin-virtual-entry

vite's [MPA](https://vitejs.dev/guide/build.html#multi-page-app) needs html file for every entry which makes your project's looks chaotic.

And if you follow vite's MPA, put other file in other directory, unlike `index.html`, you need useless middle directory(Ex. from vite's MPA doc `http://localhost:3000/nested/nested.html`) to located it.

This plugin to make vite's MPA in `serve` and `build` have same behavior.

This plugin use vite's `configureServer` Hook to intercept html request and response the html content requested from browser.

This plugin intercept `transform` and `generateBundle` hooks of `vite:build-html` .

## Note

1. please DO NOT use this plugin in lib mode

## Features

- no html file needed
- webpack [entry](https://webpack.js.org/configuration/entry-context/#entry) like
- auto config `build.rollupOptions.input` from entry

## Usage

```
    yarn add vite-plugin-virtual-entry --dev
    // or
    npm install vite-plugin-virtual-entry -D
```

Add it to `vite.config.js`

```ts
// vite.config.js
const virtualEntry = require("vite-plugin-virtual-entry");
//  xxx.html | xxx.js(x) | xxx.ts(x)
type EntryFile = string;
type EntryName = EntryFile | string;

type Entry =
	| EntryFile
	| {
			[k: EntryName]: EntryFile;
	  };

//  Case Entry As Object
const entryAsObject: Entry = {
	// http://localhost:3000/index
	// http://localhost:3000/index.html
	index: "/src/index/index.js",
	// http://localhost:3000/nested/page
	// http://localhost:3000/nested/page.html
	"nested/page": "/src/nested/page/index.js",
	// http://localhost:3000/login
	// http://localhost:3000/login.html
	login: "/src/login/login.js",
};

//  Case Entry As Object Array
const entryAsObjectArray: Entry[] = [entryAsObject];

//  Case Entry As String

//  http://localhost:3000/src/login/login
//  http://localhost:3000/src/login/login.html
const entryAsString = "/src/login/login.js";

//  Case Entry As String Array
//  http://localhost:3000/src/login/login
//  http://localhost:3000/src/login/login.html
const entryAsStringArray = ["/src/login/login.js"];

type renderOption = {
	html: string;
	name: string;
	entry: string;
};
type Render = (option: renderOption) => renderOption["html"];
// optional
const render: Render = ({ html, name: entryName, entry: entryFile }) => {
	//  you can update default html content when you needed
	return html;
};

const entry =
	entryAsObject | entryAsObjectArray | entryAsStringArray | entryAsString;
module.exports = {
	plugins: [virtualEntry({ entry, render })],
};
```

## 404 & Index Path

Plugin will intercept request, if the requested path does not exist , plugin will send something like below to browser

```
    http://localhost:3000/index
    http://localhost:3000/nested/Page
    http://localhost:3000/login
```

## Further Info

[vite-plugin-mpa](https://www.npmjs.com/package/vite-plugin-mpa)

[vite-plugin-multipage](https://www.npmjs.com/package/vite-plugin-multipage)

[vite-plugin-html-template](https://www.npmjs.com/package/vite-plugin-html-template)

[vite-plugin-virtual-html](https://www.npmjs.com/package/vite-plugin-virtual-html)

[@rollup/plugin-virtual](https://www.npmjs.com/package/@rollup/plugin-virtual)
