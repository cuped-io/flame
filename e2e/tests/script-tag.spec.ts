import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetEvents, getRecordedEvents, flushBeacons } from './helpers';
// @ts-expect-error -- untyped .mjs fixture module
import { PROMOTED_CONTRACT } from '../fixtures/experiments.mjs';

const PAGE = 'http://localhost:8789/examples/script-tag/index.html';

test.beforeEach(async ({ request }) => {
  await resetEvents(request);
});

test('applies the assigned treatment variant to the DOM', async ({ page }) => {
  await page.goto(PAGE);
  // The treatment's `text` change replaces #target-text once flame
  // has fetched experiments, been assigned, and applied the variant.
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');
});

test('applies every non-redirect change type', async ({ page }) => {
  await page.goto(PAGE);

  // text — established above; assert again as the anchor for readiness.
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');

  // html — innerHTML replaced with new markup.
  await expect(page.locator('#target-html strong')).toHaveText('Treatment markup');

  // attribute — href swapped.
  await expect(page.locator('#target-attribute')).toHaveAttribute(
    'href',
    'https://example.com/new'
  );

  // class — added `treatment-class`, removed `remove-me`, kept `keep-this`.
  await expect(page.locator('#target-class')).toHaveClass(/treatment-class/);
  await expect(page.locator('#target-class')).toHaveClass(/keep-this/);
  await expect(page.locator('#target-class')).not.toHaveClass(/remove-me/);

  // style — inline color + weight.
  await expect(page.locator('#target-style')).toHaveCSS('color', 'rgb(16, 185, 129)');
  await expect(page.locator('#target-style')).toHaveCSS('font-weight', '700');

  // css — injected <style> rule adds an outline to .target-css.
  await expect(page.locator('#target-css')).toHaveCSS('outline-color', 'rgb(16, 185, 129)');

  // visibility — hidden via inline display:none.
  await expect(page.locator('#target-visibility')).toBeHidden();
});

test('fires a pageview event carrying the assignment', async ({ page, request }) => {
  await page.goto(PAGE);
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');

  await flushBeacons(page);

  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('pageview');

  const pageview = (await getRecordedEvents(request)).find((e) => e.event_type === 'pageview');
  expect(pageview?.experiment_assignments).toContainEqual({
    experiment_id: 'exp_script_tag',
    variant_id: 'var_script_treatment',
  });
});

test('fires a custom track() event on button click', async ({ page, request }) => {
  await page.goto(PAGE);
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');

  await page.getByRole('button', { name: 'Fire event' }).click();
  await flushBeacons(page);

  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('demo_button_clicked');

  const event = (await getRecordedEvents(request)).find(
    (e) => e.event_type === 'demo_button_clicked'
  );
  expect(event?.metadata?.source).toBe('script-tag-example');
});

// --- goal auto-tracking (cuped-io/ember#171) -------------------------
//
// The mock serves the shared contract payload (`CONTRACT_GOALS` — the
// byte-identical twin of ember's golden fixture), so these specs assert
// the half a server-side test can't reach: that a real browser turns
// that payload into DOM listeners, and that an interaction fires an
// event *named after the goal*. That name is what the backend matches
// conversions on, so "no event by that name" and "no conversions, ever"
// are the same sentence — which is how #171 stayed invisible while both
// suites were green.

test('auto-tracks a click goal with a custom name and selector', async ({ page, request }) => {
  await page.goto(PAGE);
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');

  await page.locator('.add-to-cart-cta').click();
  await flushBeacons(page);

  // `cart_add_clicked` deliberately does NOT collide with the SDK's
  // hardcoded e-commerce auto-goals — under #171 exactly this case was
  // dead, and a name that did collide masked it.
  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('cart_add_clicked');

  const event = (await getRecordedEvents(request)).find((e) => e.event_type === 'cart_add_clicked');
  expect(event?.metadata?.selector).toBe('.add-to-cart-cta');
  expect(event?.experiment_assignments).toContainEqual({
    experiment_id: 'exp_script_tag',
    variant_id: 'var_script_treatment',
  });
});

test('auto-tracks a submit goal on a custom form selector', async ({ page, request }) => {
  await page.goto(PAGE);
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');

  // The reported #171 configuration: primary goal `checkout_complete`,
  // type submit, selector `#checkout-form`.
  await page.locator('#checkout-form button[type="submit"]').click();
  await flushBeacons(page);

  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('checkout_complete');

  const event = (await getRecordedEvents(request)).find(
    (e) => e.event_type === 'checkout_complete'
  );
  expect(event?.metadata?.event_type).toBe('submit');
  expect(event?.experiment_assignments).toContainEqual({
    experiment_id: 'exp_script_tag',
    variant_id: 'var_script_treatment',
  });
});

test('auto-tracks a project guardrail goal like any other click goal', async ({
  page,
  request,
}) => {
  await page.goto(PAGE);
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');

  // Guardrails aren't attached to the experiment server-side — they ride
  // along on the payload, and the SDK can't tell them apart. If they
  // stopped being served, this is the tracker that dies.
  await page.locator('#open-ticket').click();
  await flushBeacons(page);

  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('support_ticket_opened');
});

test('fires goal events only for interactions matching their selector', async ({
  page,
  request,
}) => {
  await page.goto(PAGE);
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');

  await page.locator('#untracked-copy').click();
  await flushBeacons(page);

  // Wait for the beacon carrying the pageview before asserting absence:
  // a goal event fired by the click above would ride the same queue
  // flush, so once this lands, "not sent" is a real observation rather
  // than "not sent yet". Reading the sink once raced here under the
  // full suite.
  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('pageview');

  const types = (await getRecordedEvents(request)).map((e) => e.event_type);
  expect(types).not.toContain('cart_add_clicked');
  expect(types).not.toContain('checkout_complete');
  expect(types).not.toContain('support_ticket_opened');
  // A pageview goal registers no DOM listener at all — its name is never
  // an event name (the SDK fires the literal `pageview`, which the
  // backend matches by url_pattern). This is why pageview goals kept
  // converting through #171 while click/submit goals didn't.
  expect(types).not.toContain('pricing_viewed');
});

// Anti-flicker (flame#16). The naive assertion "#target-text is not the
// control" passes even without a fix, because Playwright auto-waits until
// the treatment has applied — it never observes the transient flash. To
// give the red teeth we WIDEN the flash window (hold the experiments
// roundtrip) and assert the anti-flicker *contract*: the document is
// hidden until flame reveals it (on variant-resolve OR timeout). Today,
// with no hide, the control is visible during the window → this fails for
// the right reason (the flash). The SSR/next-app path renders flash-free
// already (see next-app.spec.ts).
test('does not flash the control before applying the treatment', async ({ page }) => {
  // Hold /experiments/active so variants can't apply immediately. Without
  // anti-flicker the control markup (which paints before the bottom script
  // even runs) is visible for the whole delay — the flash we must kill.
  await page.route('**/experiments/active*', async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

  // While variants are still pending, the user must NOT see the control.
  // Contract: the root is hidden (opacity 0) until flame reveals it.
  const rootOpacityWhilePending = await page.evaluate(
    () => getComputedStyle(document.documentElement).opacity
  );
  expect(rootOpacityWhilePending, 'root must be hidden until variants resolve').toBe('0');

  // And it must end revealed on the treatment — not flashed, not stuck hidden.
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).opacity))
    .toBe('1');
});

// The timeout safety-net (flame#16). Instant-hide's whole strength is that
// it doesn't wait on the network — which means a stalled/failed API would
// leave the page hidden FOREVER unless a timeout reveals it. That would be
// strictly worse than the flash (blank page vs. brief flash). So the reveal
// must fire on resolve OR timeout, and the timeout must reveal the ORIGINAL,
// never a blank. This test is proven red-first against a hide-with-no-timeout.
test('reveals the original after the timeout when the API stalls (never left blank)', async ({
  page,
}) => {
  // Stall /experiments/active so variants never resolve within the page's life.
  await page.route('**/experiments/active*', async (route) => {
    await new Promise((r) => setTimeout(r, 10_000));
    await route.continue();
  });

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

  // Hidden instantly by the inline snippet.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).opacity)).toBe('0');

  // The timeout must reveal it — showing the ORIGINAL control, not blank, and
  // not the treatment (which never resolved).
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).opacity), {
      timeout: 4000,
    })
    .toBe('1');
  await expect(page.locator('#target-text')).toContainText('Original text content.');
});

// One evaluation, then record on delivery (flame#46, ember ADR 0041).
// flame#17 made the per-experiment /assign calls parallel; flame#46
// replaces them with one /evaluate for every arm, which enrols nobody.
// flame then records each arm it delivers as a $assignment event, ahead of
// any event tagged with that arm.
test('learns every arm from one /evaluate and records each delivered arm before the pageview', async ({
  page,
  request,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/\/evaluate$|\/assign$/.test(r.url())) asked.push(new URL(r.url()).pathname);
  });

  await page.goto(PAGE);
  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');
  await flushBeacons(page);

  expect(asked.filter((p) => p.endsWith('/evaluate'))).toHaveLength(1);
  expect(asked.filter((p) => p.endsWith('/assign'))).toHaveLength(0);

  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('pageview');
  const events = await getRecordedEvents(request);
  const types = events.map((e) => e.event_type);
  const recorded = events
    .filter((e) => e.event_type === '$assignment')
    .map((e) => (e.metadata as { experiment_id: string }).experiment_id)
    .sort();
  expect(recorded).toEqual(['exp_react', 'exp_script_tag']);
  expect(types.lastIndexOf('$assignment')).toBeLessThan(types.indexOf('pageview'));
});

// The same order when flame answers while the page is still loading: the
// recommended install (an async flame tag in <head>, spark#393) on a page
// whose parsing a slow script holds up. Apply then waits for
// DOMContentLoaded, and nothing tagged may go out before the record.
// On the stock example (flame at the end of <body>) the page has already
// parsed when flame answers, so the test above cannot tell the order apart.
test('records before the pageview when flame answers while the page is still loading', async ({
  page,
  request,
}) => {
  // A served fixture, not a route-fulfilled page: Chromium treats a
  // fulfilled document as public and blocks its calls to the localhost mock.
  const SLOW_PAGE = 'http://localhost:8789/e2e/fixtures/pages/async-head.html';
  // Long enough that flame answers first, short enough to beat the snippet's
  // 1 s timeout (past it, the original is revealed and flame skips: a
  // different case, covered in the unit tests).
  await page.route('**/__slow-page.js', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  let evaluatedAt = 0;
  page.on('response', (r) => {
    if (r.url().endsWith('/evaluate')) evaluatedAt = Date.now();
  });

  await page.goto(SLOW_PAGE, { waitUntil: 'domcontentloaded' });
  const loadedAt = Date.now();
  // Precondition: flame had its answer before the page finished parsing,
  // which is the case this test exists for.
  expect(evaluatedAt, 'flame answered while the page was loading').toBeGreaterThan(0);
  expect(evaluatedAt).toBeLessThan(loadedAt);

  await expect(page.locator('#target-text')).toHaveText('Treatment headline!');
  await flushBeacons(page);
  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('pageview');
  const types = (await getRecordedEvents(request)).map((e) => e.event_type);
  expect(types).toContain('$assignment');
  expect(types.lastIndexOf('$assignment')).toBeLessThan(types.indexOf('pageview'));
});

// --- promoted winners (flame#42, cuped-io/ember#300) -----------------
//
// Promotion concludes an experiment, so ember moves it from `experiments`
// to `promoted` — and a flame that only reads `experiments` silently
// reverts every visitor to the original. These serve the shared contract
// (`PROMOTED_CONTRACT`, the byte-identical twin of ember's golden
// fixture) and assert the winner reaches the page.

/**
 * Serve the promoted contract from `/experiments/active`. The script-tag
 * experiment is dropped because it targets `#target-text` too; the React
 * experiment stays, so events still carry an assignment to compare with.
 */
async function servePromotedContract(page: Page): Promise<void> {
  await page.route('**/experiments/active', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { experiments: { id: string }[] };
    await route.fulfill({
      response,
      json: {
        experiments: body.experiments.filter((e) => e.id !== 'exp_script_tag'),
        promoted: [PROMOTED_CONTRACT],
      },
    });
  });
}

test('applies a promoted winner from the contract payload', async ({ page }) => {
  await servePromotedContract(page);
  await page.goto(PAGE);

  await expect(page.locator('#target-text')).toHaveText('Promoted winner text');
});

test('keeps the original for a visitor held out of a promoted winner', async ({ page }) => {
  await servePromotedContract(page);
  // ember holds this visitor out of the promoted winner (ADR 0024).
  await page.route('**/evaluate', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { evaluations: { experiment_id: string }[] };
    await route.fulfill({
      response,
      json: {
        evaluations: body.evaluations.map((e) =>
          e.experiment_id === PROMOTED_CONTRACT.id
            ? { ...e, variant_id: null, variant_name: null, is_control: null, resolution: 'held_out' }
            : e
        ),
      },
    });
  });
  await page.goto(PAGE);

  // Revealed on the original, not the winner.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).opacity))
    .toBe('1');
  await expect(page.locator('#target-text')).toContainText('Original text content.');
});

test('sends no events for a promoted experiment', async ({ page, request }) => {
  await servePromotedContract(page);
  await page.goto(PAGE);
  await expect(page.locator('#target-text')).toHaveText('Promoted winner text');

  await page.getByRole('button', { name: 'Fire event' }).click();
  await flushBeacons(page);

  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('demo_button_clicked');

  const events = await getRecordedEvents(request);
  // Events do carry assignments — just never the concluded experiment's.
  expect(events.find((e) => e.event_type === 'pageview')?.experiment_assignments).toContainEqual({
    experiment_id: 'exp_react',
    variant_id: 'var_react_treatment',
  });
  const experimentIds = events.flatMap(
    (e) => e.experiment_assignments?.map((a) => a.experiment_id) ?? []
  );
  expect(experimentIds).not.toContain(PROMOTED_CONTRACT.id);
  // Nor is it recorded: its results are frozen (flame#46).
  const recordedIds = events
    .filter((e) => e.event_type === '$assignment')
    .map((e) => (e.metadata as { experiment_id: string }).experiment_id);
  expect(recordedIds).toContain('exp_react');
  expect(recordedIds).not.toContain(PROMOTED_CONTRACT.id);
});
