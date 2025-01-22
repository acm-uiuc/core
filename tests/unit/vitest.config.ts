import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: "./tests/unit/vitest.setup.ts",
  },
});
