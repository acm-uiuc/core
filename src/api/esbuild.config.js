import { build, context } from "esbuild";
import { readFileSync } from "fs";
import { resolve } from "path";
import copyStaticFiles from "esbuild-copy-static-files";

const isWatching = !!process.argv.includes("--watch");
const nodePackage = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
);

const buildOptions = {
  entryPoints: [resolve(process.cwd(), "index.ts")],
  outfile: resolve(process.cwd(), "../", "../", "dist_devel", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  external: [
    Object.keys(nodePackage.dependencies ?? {}),
    Object.keys(nodePackage.peerDependencies ?? {}),
    Object.keys(nodePackage.devDependencies ?? {}),
  ].flat(),
  loader: {
    ".png": "file", // Add this line to specify a loader for .png files
  },
  alias: {
    "moment-timezone": resolve(
      process.cwd(),
      "../../node_modules/moment-timezone/builds/moment-timezone-with-data-10-year-range.js",
    ),
  },
  banner: {
    js: `
      import { fileURLToPath } from 'url';
      import { createRequire as topLevelCreateRequire } from 'module';
      const require = topLevelCreateRequire(import.meta.url);
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
    `.trim(),
  }, // Banner for compatibility with CommonJS
  plugins: [
    copyStaticFiles({
      src: "./public",
      dest: resolve(process.cwd(), "../", "../", "dist_devel", "public"),
    }),
  ],
};

if (isWatching) {
  context(buildOptions).then((ctx) => {
    if (isWatching) {
      ctx.watch();
    } else {
      ctx.rebuild();
    }
  });
} else {
  build(buildOptions);
}
