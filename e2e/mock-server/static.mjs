/**
 * Static host for the script-tag example during e2e.
 *
 * Serves the repo root so the example's relative
 * `../../packages/flame/dist/flame.js` resolves, and rewrites the
 * placeholder `data-dsn` (`https://YOUR_KEY@localhost:8080`, which
 * `parseDsn` would reject) to the live mock DSN so the SDK actually
 * boots. The example HTML on disk is left untouched — it's a template.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { PORTS, TEST_DSN } from '../fixtures/experiments.mjs';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const ROOT_PREFIX = ROOT.endsWith(sep) ? ROOT : ROOT + sep;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTS.static}`);
  const rel = decodeURIComponent(url.pathname);
  const filePath = normalize(join(ROOT, rel));

  // Contain requests to the repo root. Require a trailing separator so
  // a sibling like `<root>-secret` can't slip past a bare prefix match.
  if (filePath !== ROOT && !filePath.startsWith(ROOT_PREFIX)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  try {
    let body = await readFile(filePath);
    const ext = extname(filePath);
    if (ext === '.html') {
      body = Buffer.from(
        body.toString('utf8').replaceAll('https://YOUR_KEY@localhost:8080', TEST_DSN),
        'utf8'
      );
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORTS.static, () => {
  // eslint-disable-next-line no-console
  console.log(`[static] serving ${ROOT} on http://localhost:${PORTS.static}`);
});
