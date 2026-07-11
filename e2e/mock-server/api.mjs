/**
 * Mock cuped API for the flame e2e suite.
 *
 * Implements the handful of endpoints the SDK + edge middleware hit:
 *   GET  /:key/experiments/active
 *   POST /:key/experiments/:id/assign
 *   POST /:key/identity/link
 *   POST /:key/events
 *
 * Plus test-only introspection so specs can assert on what the SDK
 * sent without a real backend:
 *   GET  /_test/events   -> recorded events (newest last)
 *   POST /_test/reset    -> clear recorded events
 *
 * Deterministic by design: everyone is assigned the treatment variant
 * (see `treatmentVariantFor`). Reachable by both the browser
 * (script-tag example, cross-origin) and the Next.js server (edge
 * middleware, same-process fetch), so CORS is wide open.
 */
import { createServer } from 'node:http';
import { EXPERIMENTS, PORTS, TEST_API_KEY, treatmentVariantFor } from '../fixtures/experiments.mjs';

/** In-memory sink for every event the SDK POSTs to `/events`. */
const recordedEvents = [];

function send(res, status, body, extraHeaders = {}) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    ...extraHeaders,
  };
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json' });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  const { method } = req;
  const url = new URL(req.url, `http://localhost:${PORTS.api}`);
  const path = url.pathname;

  // CORS preflight for the cross-origin POSTs from the script-tag page.
  if (method === 'OPTIONS') {
    send(res, 204);
    return;
  }

  // --- test-only introspection -------------------------------------
  if (path === '/_test/events' && method === 'GET') {
    send(res, 200, { events: recordedEvents });
    return;
  }
  if (path === '/_test/reset' && method === 'POST') {
    recordedEvents.length = 0;
    send(res, 200, { ok: true });
    return;
  }

  // Every real endpoint is namespaced under the DSN api key.
  const keyed = path.match(/^\/([0-9a-f]{32})(\/.*)$/i);
  if (!keyed) {
    send(res, 404, { error: 'not found' });
    return;
  }
  const [, key, rest] = keyed;
  if (key !== TEST_API_KEY) {
    send(res, 401, { error: 'bad api key' });
    return;
  }

  // GET /:key/experiments/active
  if (rest === '/experiments/active' && method === 'GET') {
    send(res, 200, { experiments: EXPERIMENTS });
    return;
  }

  // POST /:key/experiments/:id/assign
  const assignMatch = rest.match(/^\/experiments\/([^/]+)\/assign$/);
  if (assignMatch && method === 'POST') {
    const experimentId = assignMatch[1];
    const variant = treatmentVariantFor(experimentId);
    if (!variant) {
      send(res, 404, { error: `unknown experiment ${experimentId}` });
      return;
    }
    send(res, 200, {
      assignment_id: `asn_${experimentId}`,
      experiment_id: experimentId,
      variant_id: variant.id,
      variant_name: variant.name,
      is_control: variant.is_control,
      assigned_at: new Date().toISOString(),
    });
    return;
  }

  // POST /:key/identity/link
  if (rest === '/identity/link' && method === 'POST') {
    send(res, 200, { id: 'link_1', linked: true });
    return;
  }

  // POST /:key/events  (fetch fallback or sendBeacon; body may be text/plain)
  if (rest === '/events' && method === 'POST') {
    const raw = await readBody(req);
    try {
      const parsed = JSON.parse(raw);
      const events = Array.isArray(parsed?.events) ? parsed.events : [];
      recordedEvents.push(...events);
    } catch {
      // ignore malformed bodies — the SDK always sends the envelope
    }
    send(res, 204);
    return;
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORTS.api, () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-api] listening on http://localhost:${PORTS.api}`);
});
