import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

// ESM + CJS build for @cuped-io/flame-edge. Two entry points:
// - index: framework-agnostic (cookie utils + resolveAssignments)
// - next:  Next.js middleware factory + cookie helpers
//
// We externalize @cuped-io/flame and Web Crypto / fetch since
// edge runtimes (Vercel Edge, Cloudflare Workers) provide them
// as globals.
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        next: resolve(__dirname, 'src/next.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entry) => `${entry}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: ['@cuped-io/flame', 'next/server'],
      output: {
        exports: 'named',
      },
    },
  },
});
