import type { APIRequestContext, Page } from '@playwright/test';
// Plain-ESM fixtures shared with the mock server. No .d.ts; Playwright
// transpiles specs with esbuild, so the runtime import is what matters.
// @ts-expect-error -- untyped .mjs fixture module
import { PORTS } from '../fixtures/experiments.mjs';

const API = `http://localhost:${PORTS.api}`;

export interface RecordedEvent {
  user_id: string;
  event_type: string;
  metadata?: Record<string, unknown>;
  experiment_assignments?: { experiment_id: string; variant_id: string }[];
}

/** Clear the mock API's recorded-event sink. Call before each test. */
export async function resetEvents(request: APIRequestContext): Promise<void> {
  await request.post(`${API}/_test/reset`);
}

/** Every event the SDK has POSTed to `/events` so far. */
export async function getRecordedEvents(request: APIRequestContext): Promise<RecordedEvent[]> {
  const res = await request.get(`${API}/_test/events`);
  const body = (await res.json()) as { events: RecordedEvent[] };
  return body.events;
}

/**
 * Force the SDK's batched event queue to flush without navigating
 * away. The queue flushes on `visibilitychange` → hidden; we fake the
 * hidden state and dispatch the (bubbling) event so its window-level
 * listener fires and sends the beacon.
 */
export async function flushBeacons(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}
