import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import "dotenv/config";
import path from "path";

export default defineConfig({
  define: { "process.env": { AWS_REGION: process.env.AWS_REGION } },
  plugins: [react(), tsconfigPaths()],
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@ui": path.resolve(__dirname, "./"),
      "@common": path.resolve(__dirname, "../common/"),
      "@tabler/icons-react": "@tabler/icons-react/dist/esm/icons/index.mjs",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./vitest.setup.mjs",
    env: {
      VITE_RUN_ENVIRONMENT: "dev",
    },
  },
  server: {
    historyApiFallback: true,
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: "../../dist_ui",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const HugeLibraries = [
            "@mantine",
            "moment-timezone",
            "moment",
            "@azure",
            "@tabler",
            "axios",
            "react-router",
          ]; // modify as required based on libraries in use
          if (
            HugeLibraries.some((libName) =>
              id.includes(`node_modules/${libName}`),
            )
          ) {
            return `vendor/${id
              .toString()
              .split("node_modules/")[1]
              .split("/")[0]
              .toString()}`;
          }
          if (id.includes("node_modules")) {
            return `vendor/main`;
          }
          if (id.includes("src/common")) {
            return "common";
          }
        },
      },
    },
  },
});
