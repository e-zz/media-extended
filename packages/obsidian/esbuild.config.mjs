import obPlugin from "@aidenlx/esbuild-plugin-obsidian";
import { build } from "esbuild";
import { lessLoader } from "esbuild-plugin-less";
import open from "open";

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source visit the plugins github repository
*/
`;

const isProd = process.env.BUILD === "production";

const cmModules = [
  "@codemirror/autocomplete",
  "@codemirror/closebrackets",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/comment",
  "@codemirror/fold",
  "@codemirror/gutter",
  "@codemirror/highlight",
  "@codemirror/history",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/matchbrackets",
  "@codemirror/panel",
  "@codemirror/rangeset",
  "@codemirror/rectangular-selection",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/stream-parser",
  "@codemirror/text",
  "@codemirror/tooltip",
  "@codemirror/view",
];

import { promises } from "fs";
import { join } from "path";

import inlineCodePlugin from "./scripts/inline-code.mjs";
import { INJECT_BILIBILI, MAIN_PS } from "./src/const.mjs";
/**
 * @type {import("esbuild").Plugin}
 */
const remoteRedux = {
  name: "enable-remote-redux-devtools",
  setup: (build) => {
    if (isProd) return;
    build.onLoad(
      { filter: /src\/player\/store\/create-store\.ts$/ },
      async (args) => ({
        contents: (
          `import devToolsEnhancer from "remote-redux-devtools";` +
          (await promises.readFile(args.path, "utf8"))
        ).replace(
          `enhancers: []`,
          `enhancers: [devToolsEnhancer({ realtime: true, hostname: "localhost", port: 8000, name })]`,
        ),
        loader: "ts",
      }),
    );
  },
};

/**
 * @type {import("esbuild").Plugin}
 */
const LessPathAlias = {
  name: "less-path-alias",
  setup: (build) => {
    build.onResolve(
      { filter: /^@styles.+\.less$/, namespace: "file" },
      async ({ path, namespace }) => {
        path = path.replace("@styles", "player/component/styles");
        return { path: join(process.cwd(), "src", path), namespace };
      },
    );
  },
};

const injectScriptConfig = {
  bundle: true,
  watch: !isProd,
  platform: "browser",
  target: "es2020",
  format: "iife",
  mainFields: ["browser", "module", "main"],
  banner: { js: banner },
  sourcemap: isProd ? false : "inline",
  minify: isProd,
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.BUILD),
  },
};

try {
  const main = build({
    entryPoints: ["src/mx-main.ts"],
    bundle: true,
    watch: !isProd,
    platform: "browser",
    external: [
      "obsidian",
      "https",
      "@electron/remote",
      "electron",
      ...cmModules,
    ],
    loader: {
      ".svg": "text",
    },
    format: "cjs",
    mainFields: ["browser", "module", "main"],
    sourcemap: isProd ? false : "inline",
    minify: isProd,
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.BUILD),
    },
    outfile: "build/main.js",
    plugins: [
      LessPathAlias,
      lessLoader(),
      obPlugin(),
      inlineCodePlugin(injectScriptConfig),
    ],
    // metafile: true,
  });
  const preloadBili = build({
    entryPoints: ["src/player/component/bilibili/inject/index.ts"],
    outfile: join("build", INJECT_BILIBILI),
    ...injectScriptConfig,
    // incremental: !isProd,
    // metafile: true,
  });
  const mainProcess = build({
    entryPoints: ["src/player/ipc/hack/main-ps/index.ts"],
    bundle: true,
    watch: !isProd,
    platform: "browser",
    external: ["electron"],
    target: "es2020",
    format: "cjs",
    mainFields: ["browser", "module", "main"],
    sourcemap: isProd ? false : "inline",
    minify: isProd,
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.BUILD),
    },
    outfile: join("build", MAIN_PS),
    // metafile: true,
  });
  // await promises.writeFile(
  //   "meta.json",
  //   JSON.stringify(result.metafile),
  //   "utf8",
  // );
  if (!isProd) open("obsidian://open?vault=mx-test");
} catch (err) {
  console.error(err);
  process.exit(1);
}
