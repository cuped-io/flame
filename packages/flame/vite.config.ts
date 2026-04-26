import { defineConfig } from 'vite';
import { resolve } from 'path';

// IIFE build for the script-tag flow (`<script src="flame.js">`).
// Self-executes on load, exposes `window.flame`. The npm-consumer
// build (ESM/CJS + .d.ts) lives in `vite.config.npm.ts` and
// produces `dist/index.{mjs,cjs,d.ts}`.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Flame',
      fileName: () => 'flame.js',
      formats: ['iife'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        exports: 'named',
      },
    },
  },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version || '0.2.0'),
  },
});
