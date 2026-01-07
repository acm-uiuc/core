/* eslint-disable no-console */
import esbuild from "esbuild";
import { copy } from "esbuild-plugin-copy";
import { packagesToTransfer } from "./createLambdaPackage.js";

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
  external: [...packagesToTransfer],
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
  plugins: [
    copy({
      resolveFrom: "cwd",
      assets: {
        from: ["./public/*"],
        to: ["../../dist/lambda/public"],
      },
    }),
  ],
};
esbuild
  .build({
    ...commonParams,
    entryPoints: ["api/lambda.js", "api/createSwagger.js"],
    outdir: "../../dist/lambda/",
    external: [...commonParams.external, "sqs/*"],
  })
  .then(() => console.log("API server build completed successfully!"))
  .catch((error) => {
    console.error("API server build failed:", error);
    process.exit(1);
  });
esbuild
  .build({
    ...commonParams,
    entryPoints: ["api/sqs/index.js", "api/sqs/driver.js"],
    outdir: "../../dist/sqsConsumer/",
  })
  .then(() => console.log("SQS consumer build completed successfully!"))
  .catch((error) => {
    console.error("SQS consumer build failed:", error);
    process.exit(1);
  });

esbuild
  .build({
    ...commonParams,
    entryPoints: ["api/warmer/lambda.js"],
    outdir: "../../dist/warmer/",
  })
  .then(() => console.log("Lambda warmer build completed successfully!"))
  .catch((error) => {
    console.error("Lambda warmer build failed:", error);
    process.exit(1);
  });
