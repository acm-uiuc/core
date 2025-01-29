import esbuild from "esbuild";
import { resolve } from "path";

esbuild
  .build({
    entryPoints: ["api/lambda.js"], // Entry file
    bundle: true,
    format: "esm",
    minify: true,
    outdir: "../../dist/lambda/",
    outExtension: { ".js": ".mjs" },
    loader: {
      ".png": "file",
      ".pkpass": "file",
      ".json": "file",
    }, // File loaders
    target: "es2022", // Target ES2022
    sourcemap: false,
    platform: "node",
    external: ["aws-sdk", "moment-timezone", "passkit-generator", "fastify"],
    alias: {
      'moment-timezone': resolve(process.cwd(), '../../node_modules/moment-timezone/builds/moment-timezone-with-data-10-year-range.js')
    },
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
  })
  .then(() => console.log("Build completed successfully!"))
  .catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
