import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cdnArtifactsPlugin } from './scripts/vite-plugin-cdn-artifacts';
import pkg from './package.json';

// Version stamped into the runtime SDK (__VERSION__) and the CDN artifact
// filename/manifest. Read from package.json directly so a bare `vite build`
// (no npm_package_version in the env) can never mint a mis-versioned
// immutable pin like `flame@0.2.0.js` for a 0.4.0 release.
const VERSION = pkg.version;

// IIFE build for the script-tag flow (`<script src="flame.js">`).
// Self-executes on load, exposes `window.flame`. The npm-consumer
// build (ESM/CJS + .d.ts) lives in `vite.config.npm.ts` and
// produces `dist/index.{mjs,cjs,d.ts}`.
//
// The cdnArtifactsPlugin runs after the IIFE is written and emits the
// immutable pinned copy (`flame@X.Y.Z.js`) + SRI manifest (`flame.sri.json`)
// so the CDN can serve a versioned, integrity-pinnable artifact.
export default defineConfig({
  plugins: [cdnArtifactsPlugin(VERSION)],
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
    __VERSION__: JSON.stringify(VERSION),
  },
});
