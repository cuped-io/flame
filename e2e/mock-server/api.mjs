/**
 * Mock cuped API for the flame e2e suite.
 *
 * Implements the handful of endpoints the SDK + edge middleware hit:
 *   GET  /:key/rules                 (flame#24: the rules file flame and flame-edge pick from)
 *   POST /:key/identity/link
 *   POST /:key/events
 *
 * Plus test-only introspection so specs can assert on what the SDK
 * sent without a real backend:
 *   GET  /_test/events   -> recorded events (newest last)
 *   POST /_test/reset    -> clear recorded events
 *
 * Deterministic by design: the rules file gives everyone the treatment
 * variant. A refusal carries ember's `code` (ember#364). Reachable by
 * both the browser (script-tag example, cross-origin) and the Next.js
 * server (edge middleware, same-process fetch), so CORS is wide open.
 */
import { createServer } from 'node:http';
import { PORTS, RULES, TEST_API_KEY } from '../fixtures/experiments.mjs';

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
    send(res, 401, { error: 'bad api key', code: 'invalid_api_key' });
    return;
  }

  // GET /:key/rules (ember#309)
  if (rest === '/rules' && method === 'GET') {
    send(res, 200, RULES);
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
      // As ember does: one malformed $assignment refuses the whole envelope,
      // pageview included, so a bad record fails the suite here too.
      const bad = events.findIndex(
        (e) =>
          e?.event_type === '$assignment' &&
          !(
            typeof e.metadata?.experiment_id === 'string' &&
            e.metadata.experiment_id &&
            typeof e.metadata?.variant_id === 'string' &&
            e.metadata.variant_id
          )
      );
      if (bad !== -1) {
        send(res, 400, {
          error: `events[${bad}]: $assignment: malformed metadata`,
          code: 'invalid_event',
        });
        return;
      }
      // As ember does: an assignment with no variant refuses the envelope too.
      // A held-out visitor's events carry no entry for the experiment.
      const unassigned = events.findIndex((e) =>
        e?.experiment_assignments?.some((a) => typeof a?.variant_id !== 'string')
      );
      if (unassigned !== -1) {
        send(res, 400, {
          error: `events[${unassigned}]: experiment_assignments: variant_id must be a string`,
          code: 'invalid_body',
        });
        return;
      }
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
