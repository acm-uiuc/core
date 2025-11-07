/* eslint-disable no-console */
import esbuild from "esbuild";

const commonParams = {
  bundle: true,
  format: "esm",
  minify: true,
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
};

esbuild
  .build({
    ...commonParams,
    entryPoints: ["linkryEdgeFunction/index.js"],
    outdir: "../../dist/linkryEdgeFunction/",
  })
  .then(() =>
    console.log("Linkry Edge Function lambda build completed successfully!"),
  )
  .catch((error) => {
    console.error("Linkry Edge Function lambda build failed:", error);
    process.exit(1);
  });
