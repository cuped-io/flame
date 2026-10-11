import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetEvents } from './helpers';

/**
 * flame#39 PROBE: does a script-tag variant survive on a React page?
 *
 * The page (e2e/probe-react, built by build.mjs) is server-rendered React,
 * hydrated by bundle.js, with flame's script tag in <head>. exp_script_tag's
 * text change targets #target-text ("Original headline" -> "Treatment
 * headline!"). Each case records what happened via test annotations and the
 * PROBE log line; the assertions encode the outcome measured on 2026-10-11.
 *
 * One assertion pins a KNOWN DEFECT as it behaves today (flame#45): when it
 * is fixed, that assertion fails on purpose; flip it then. The "reverse
 * order" case without the opt-in is the documented limit of flame#44.
 */

const PAGE = 'http://localhost:8789/e2e/probe-react/dist/index.html';
const TREATMENT = 'Treatment headline!';
const ORIGINAL = 'Original headline';

const headline = (page: Page) => page.locator('#target-text').textContent();
const hydrated = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __hydrated?: boolean }).__hydrated === true);
const hydrationErrors = (page: Page) =>
  page.evaluate(() => (window as unknown as { __hydrationErrors: string[] }).__hydrationErrors);

function record(name: string, value: unknown) {
  test.info().annotations.push({ type: name, description: JSON.stringify(value) });
  console.log(`PROBE ${test.info().title} :: ${name} = ${JSON.stringify(value)}`);
}

// Chrome's Local Network Access check blocks a fetch from localhost:8789 to
// the mock API on localhost:8788 when it starts after page load, which is
// exactly when a consent accept fires. That is a test-host artifact: in
// production the API is a public origin. Off for this probe only.
test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] } });

test.beforeEach(async ({ request }) => {
  await resetEvents(request);
});

test('default order: React hydrates, then flame applies', async ({ page }) => {
  await page.goto(PAGE);
  await hydrated(page);
  await page.waitForTimeout(1500);
  record('after load', await headline(page));
  record('hydration errors', (await hydrationErrors(page)).length);
  expect(await headline(page)).toBe(TREATMENT);
  expect(await hydrationErrors(page)).toEqual([]);

  await page.click('#rerender');
  await page.waitForTimeout(300);
  record('after unrelated re-render', await headline(page));
  expect(await headline(page)).toBe(TREATMENT);

  await page.click('#same-title');
  await page.waitForTimeout(300);
  record('after headline re-render, same value', await headline(page));
  expect(await headline(page)).toBe(TREATMENT);

  await page.click('#navigate');
  await page.click('#navigate');
  await page.waitForTimeout(300);
  record('after client-side navigate away and back', await headline(page));
  // KNOWN DEFECT flame#45: flame applies only at init, so a remount loses
  // the variant. Flip to TREATMENT when #45 is fixed.
  expect(await headline(page)).toBe(ORIGINAL);
});

test('reverse order: flame applies, then React hydrates', async ({ page }) => {
  await page.goto(`${PAGE}?hydrateDelay=2500`);
  await page
    .waitForFunction((t) => document.getElementById('target-text')?.textContent === t, TREATMENT, {
      timeout: 5000,
    })
    .catch(() => {});
  record('before hydration', await headline(page));
  expect(await headline(page)).toBe(TREATMENT);
  await hydrated(page);
  await page.waitForTimeout(500);
  record('after hydration', await headline(page));
  record('hydration errors', await hydrationErrors(page));
  // Precondition: flame really applied before React took over.
  // By design since flame#44: this probe page is hand-built React SSR with no
  // framework fingerprint and no data-wait-for-hydration opt-in, so flame
  // cannot know hydration is coming, and React throws #418 and discards the
  // variant. The opt-in case below is the fix; framework pages auto-detect.
  expect(await headline(page)).toBe(ORIGINAL);
  expect((await hydrationErrors(page)).join(' ')).toContain('418');
});

test('reverse order with data-wait-for-hydration: no #418, and the variant stays (flame#44)', async ({
  page,
}) => {
  await page.route(`${PAGE}?hydrateDelay=1500`, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(
      'data-dsn=',
      'data-wait-for-hydration="true" data-dsn='
    );
    await route.fulfill({ response: res, body });
  });
  await page.goto(`${PAGE}?hydrateDelay=1500`);
  await page.waitForTimeout(800);
  // Precondition: flame has had time to apply, and it held off.
  record('before hydration', await headline(page));
  expect(await headline(page)).toBe(ORIGINAL);

  await hydrated(page);
  await page
    .waitForFunction((t) => document.getElementById('target-text')?.textContent === t, TREATMENT, {
      timeout: 3000,
    })
    .catch(() => {});
  record('after hydration', await headline(page));
  record('hydration errors', await hydrationErrors(page));
  expect(await headline(page)).toBe(TREATMENT);
  expect(await hydrationErrors(page)).toEqual([]);
});

test('consent: accept after React has hydrated', async ({ page }) => {
  await page.route(PAGE, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace('data-dsn=', 'data-consent="required" data-dsn=');
    await route.fulfill({ response: res, body });
  });
  await page.goto(PAGE);
  await hydrated(page);
  await page.waitForTimeout(800);
  record('before accept', await headline(page));
  expect(await headline(page)).toBe(ORIGINAL);

  const state = await page.evaluate(() =>
    (
      window as unknown as { Flame: { flame: { consent: (b: boolean) => string } } }
    ).Flame.flame.consent(true)
  );
  record('consent(true) returned', state);
  expect(state).toBe('granted');
  await page.waitForTimeout(1500);
  record('after accept', await headline(page));
  expect(await headline(page)).toBe(TREATMENT);

  await page.click('#rerender');
  await page.waitForTimeout(300);
  record('after accept + unrelated re-render', await headline(page));
  expect(await headline(page)).toBe(TREATMENT);
});
