import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    setupFiles: "./tests/unit/vitest.setup.ts",
  },
  resolve: {
    alias: {
      "api/": path.resolve(__dirname, "../../src/api/"),
    },
  },
});
