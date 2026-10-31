import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

// ESM + CJS build for npm consumers (e.g. `@cuped-io/flame-react`).
// Generates `.d.ts` from sources. Companion to `vite.config.ts`
// which produces the IIFE script-tag build.
//
// Two entry points:
// - index: the SDK
// - rules: the rules file and its local pick, for flame-edge (flame#62),
//   which must pick exactly as flame does without the SDK's bundle.
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
        rules: resolve(__dirname, 'src/rules.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entry) => `${entry}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        exports: 'named',
      },
    },
  },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version || '0.2.0'),
  },
});
