import esbuild from "esbuild";
import { resolve } from "path";
import { copy } from "esbuild-plugin-copy";

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
  sourcemap: false,
  platform: "node",
  external: [
    "aws-sdk",
    "moment-timezone",
    "passkit-generator",
    "fastify",
    "zod",
    "zod-openapi",
    "@fastify/swagger",
    "@fastify/swagger-ui",
    "argon2",
    "ioredis",
  ],
  alias: {
    "moment-timezone": resolve(
      process.cwd(),
      "../../node_modules/moment-timezone/builds/moment-timezone-with-data-10-year-range.js",
    ),
  },
  banner: {
    js: `
      import path from 'path';
      import { fileURLToPath } from 'url';
      import { createRequire as topLevelCreateRequire } from 'module';
      const require = topLevelCreateRequire(import.meta.url);
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      import "zod-openapi/extend";
    `.trim(),
  }, // Banner for compatibility with CommonJS
  plugins: [
    copy({
      resolveFrom: "cwd",
      assets: {
        from: ["../../node_modules/@fastify/swagger-ui/static/*"],
        to: ["../../dist/lambda/static"],
      },
    }),
    copy({
      resolveFrom: "cwd",
      assets: {
        from: ["./public/*"],
        to: ["../../dist/lambda/public"],
      },
    }),
  ],
  inject: [resolve(process.cwd(), "./zod-openapi-patch.js")],
};
esbuild
  .build({
    ...commonParams,
    entryPoints: ["api/lambda.js"],
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
