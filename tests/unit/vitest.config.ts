import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    setupFiles: "./tests/unit/vitest.setup.ts",
    coverage: {
      provider: "istanbul",
      include: ["src/api/**/*.ts", "src/common/**/*.ts"],
      exclude: ["src/api/lambda.ts", "src/api/sqs/handlers/templates/*.ts"],
      thresholds: {
        statements: 50,
        functions: 66,
        lines: 50,
      },
    },
  },
  resolve: {
    alias: {
      api: path.resolve(__dirname, "../../src/api/"),
      common: path.resolve(__dirname, "../../src/common/"),
      ui: path.resolve(__dirname, "../../src/ui/"),
    },
  },
});
