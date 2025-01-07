import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import 'dotenv/config';
import path from 'path';

export default defineConfig({
  define:{'process.env': process.env},
  plugins: [react(), tsconfigPaths()],
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@ui': path.resolve(__dirname, './'),
      '@common': path.resolve(__dirname, '../common/'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.mjs',
  },
  server: {
    historyApiFallback: true,
  },
  build: {
    outDir: '../../dist_ui',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const HugeLibraries = ['@mantine', '@azure', '@tabler', 'axios', 'react-pdf']; // modify as required based on libraries in use
          if (HugeLibraries.some((libName) => id.includes(`node_modules/${libName}`))) {
            return id.toString().split('node_modules/')[1].split('/')[0].toString();
          }
        },
      },
    },
  },
});
