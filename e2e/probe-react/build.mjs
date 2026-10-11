// Builds the flame#39 probe page: server-rendered HTML for <App/>, hydrated by
// bundle.js, with flame's script tag in <head>. Output: e2e/probe-react/dist.
// Uses vite, which the repo already builds with; React comes from the Next
// example's install, so the probe adds no dependencies.
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The vite packages/flame builds with. The repo root's node_modules can hold
// stray installs from outside pnpm.
const flamePkg = createRequire(join(here, '..', '..', 'packages', 'flame', 'package.json'));
const { build } = await import(pathToFileURL(flamePkg.resolve('vite')).href);
const out = join(here, 'dist');
const reactHome = join(here, '..', '..', 'examples', 'next-app', 'node_modules');
const req = createRequire(join(reactHome, 'x.js'));
const alias = {
  'react/jsx-runtime': req.resolve('react/jsx-runtime'),
  'react-dom/client': req.resolve('react-dom/client'),
  'react-dom/server': req.resolve('react-dom/server'),
  'react-dom': req.resolve('react-dom'),
  react: req.resolve('react'),
};
const common = {
  configFile: false,
  logLevel: 'warn',
  resolve: { alias },
  esbuild: { jsx: 'automatic' },
  oxc: { jsx: { runtime: 'automatic' } },
  define: { 'process.env.NODE_ENV': '"production"' },
};

await build({
  ...common,
  build: {
    outDir: out,
    emptyOutDir: true,
    lib: { entry: join(here, 'client.tsx'), formats: ['es'], fileName: () => 'bundle.js' },
  },
});

await build({
  ...common,
  ssr: { noExternal: true },
  build: {
    outDir: join(out, 'server'),
    emptyOutDir: true,
    ssr: join(here, 'server.tsx'),
    rollupOptions: { output: { entryFileNames: 'app.server.mjs' } },
  },
});

const { render } = await import(pathToFileURL(join(out, 'server', 'app.server.mjs')).href);
const html = render();

await writeFile(
  join(out, 'index.html'),
  `<!doctype html>
<html><head><meta charset="utf-8"><title>flame#39 React probe</title>
<script>window.__hydrationErrors = [];</script>
<script src="../../../packages/flame/dist/flame.js" data-dsn="https://YOUR_KEY@localhost:8080"></script>
</head><body><div id="root">${html}</div>
<script type="module" src="./bundle.js"></script>
</body></html>
`
);
console.log('probe built:', join(out, 'index.html'));
