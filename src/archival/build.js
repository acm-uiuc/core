/* eslint-disable no-console */
import esbuild from "esbuild";
import { excludeVendorFromSourceMapPlugin } from "../common/esbuild-plugins.js"; // eslint-disable-line import/extensions

const commonParams = {
  bundle: true,
  format: "esm",
  minify: true,
  sourcesContent: false,
  outExtension: { ".js": ".mjs" },
  loader: {
    ".png": "file",
    ".pkpass": "file",
    ".json": "file",
  }, // File loaders
  target: "es2022", // Target ES2022
  sourcemap: true,
  platform: "node",
  external: ["@aws-sdk/*"],
  banner: {
    js: `
      import path from 'path';
      import { fileURLToPath } from 'url';
      import { createRequire as topLevelCreateRequire } from 'module';
      const require = topLevelCreateRequire(import.meta.url);
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
    `.trim(),
  }, // Banner for compatibility with CommonJS
  plugins: [excludeVendorFromSourceMapPlugin()],
};

esbuild
  .build({
    ...commonParams,
    entryPoints: ["archival/dynamoStream.js"],
    outdir: "../../dist/archival/",
  })
  .then(() => console.log("Archival lambda build completed successfully!"))
  .catch((error) => {
    console.error("Archival lambda build failed:", error);
    process.exit(1);
  });
