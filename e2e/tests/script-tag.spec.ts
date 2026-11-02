import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetEvents, getRecordedEvents, flushBeacons } from './helpers';
// @ts-expect-error -- untyped .mjs fixture module
import { PORTS, PROMOTED, RULES, SCRIPT_TAG_EXPERIMENT } from '../fixtures/experiments.mjs';

const PAGE = 'http://localhost:8789/examples/script-tag/index.html';
const SLUG: string = SCRIPT_TAG_EXPERIMENT.slug;
const ARM = { experiment_id: 'exp_script_tag', variant_id: 'var_script_treatment' };

type FlameWindow = {
  flame: {
    ready: Promise<void>;
    getVariant(key: string): string | null;
    isInVariant(key: string, variant: string): boolean;
    track(event: string): void;
    consent(granted: boolean): string;
  };
};

// The configuration specs serve the page through page.route, and Chrome's
// Local Network Access check blocks a fulfilled document's calls to the mock
// API on localhost. A test-host artifact: in production the API is a public
// origin.
test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] } });

test.beforeEach(async ({ request }) => {
  await resetEvents(request);
});

/** Fire an event from page code. */
const track = (page: Page, event: string) =>
  page.evaluate((e) => (window as unknown as FlameWindow).flame.track(e), event);

/** Wait until flame's reads answer. */
const ready = (page: Page) => page.evaluate(() => (window as unknown as FlameWindow).flame.ready);

/** A read of an experiment by slug, as page code makes it. */
const read = (page: Page, key: string) =>
  page.evaluate((k) => (window as unknown as FlameWindow).flame.getVariant(k), key);

const eventTypes = async (request: Parameters<typeof getRecordedEvents>[0]) =>
  (await getRecordedEvents(request)).map((e) => e.event_type);

/** The rules file with a promoted winner added, as ember serves one (ADR 0039). */
function rulesWithPromoted() {
  return { ...RULES, promoted: [PROMOTED] };
}

// --- flame never changes the page (flame#63) -------------------------
//
// A MutationObserver starts before flame's script tag and records every
// change to the document. Under each configuration flame starts, answers
// reads, sends events and sees clicks, submits and a client-side
// navigation; the page's own code changes nothing, so any record is
// flame's.

/** Runs before flame: records mutations, and stubs what flame used to touch. */
const OBSERVER = `<script>
  window.__mutations = [];
  window.__pushState = history.pushState;
  window.__replaceState = history.replaceState;
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      // The parser adding flame's own tag and the whitespace after it.
      if (r.type === 'characterData' && !r.target.textContent.trim()) return;
      var parsed =
        r.type === 'childList' &&
        r.removedNodes.length === 0 &&
        Array.prototype.every.call(r.addedNodes, function (n) {
          return (
            (n.nodeType === 3 && !n.textContent.trim()) ||
            (n.nodeName === 'SCRIPT' && /flame\\.js$/.test(n.getAttribute('src') || ''))
          );
        });
      if (parsed) return;
      window.__mutations.push(
        r.type + ' on <' + r.target.nodeName + '>' + (r.attributeName ? ' ' + r.attributeName : '')
      );
    });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
</script>`;

/** The anti-flicker snippet 0.x asked for, reduced to what flame called. */
const ANTI_FLICKER = `<script>
  window.__cupedAntiflicker = { reveal: function () { window.__revealed = true; } };
</script>`;

interface Configuration {
  name: string;
  /** Extra attributes on flame's script tag. */
  attributes?: string;
  /** Call `flame.consent(true)` once the page has loaded. */
  consent?: boolean;
  /** Serve this rules file instead of the mock's. */
  rules?: () => unknown;
  antiFlicker?: boolean;
}

const CONFIGURATIONS: Configuration[] = [
  { name: 'the stock install' },
  { name: 'consent required and never given', attributes: 'data-consent="required"' },
  { name: 'consent required, then given', attributes: 'data-consent="required"', consent: true },
  {
    name: 'the removed data-reapply and data-wait-for-hydration attributes',
    attributes: 'data-reapply="true" data-wait-for-hydration="true"',
  },
  { name: 'a promoted winner', rules: rulesWithPromoted },
  {
    name: 'a visitor in an active Holdout',
    rules: () => ({
      ...rulesWithPromoted(),
      holdout: { id: 'hold_e2e', percentage: 100, active: true },
    }),
  },
  { name: 'an anti-flicker snippet on the page', antiFlicker: true },
];

for (const config of CONFIGURATIONS) {
  test(`flame makes no change to the page: ${config.name}`, async ({ page, request }) => {
    await page.route(PAGE, async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(
        /<script\s+src="[^"]*flame\.js"/,
        (tag) =>
          `${config.antiFlicker ? ANTI_FLICKER : ''}${OBSERVER}\n${tag} ${config.attributes ?? ''}`
      );
      await route.fulfill({ response, body: html });
    });
    const rules = config.rules;
    if (rules) await page.route('**/rules', (route) => route.fulfill({ json: rules() }));

    await page.goto(PAGE);
    await ready(page);
    if (config.consent) {
      expect(
        await page.evaluate(() => (window as unknown as FlameWindow).flame.consent(true))
      ).toBe('granted');
      await ready(page);
    }

    // Everything a page does with flame: reads, goals, a client-side navigation.
    await read(page, SLUG);
    await read(page, PROMOTED.slug);
    await page.evaluate(
      (slug) => (window as unknown as FlameWindow).flame.isInVariant(slug, 'treatment'),
      SLUG
    );
    await page.locator('.add-to-cart-cta').click();
    await page.locator('#checkout-form button[type="submit"]').click();
    await page.locator('#open-ticket').click();
    await page.locator('#untracked-copy').click();
    await page.evaluate(() => {
      history.pushState({}, '', '?next');
      history.back();
    });
    await track(page, 'marker');
    await flushBeacons(page);
    if (config.attributes?.includes('data-consent') && !config.consent) {
      // flame sends nothing before consent: give it the time it would take.
      await page.waitForTimeout(500);
    } else {
      await expect.poll(() => eventTypes(request)).toContain('marker');
    }

    const seen = await page.evaluate(() => {
      const w = window as unknown as {
        __mutations: string[];
        __revealed?: boolean;
        __pushState: unknown;
        __replaceState: unknown;
      };
      return {
        mutations: w.__mutations,
        revealed: w.__revealed ?? false,
        historyWrapped:
          history.pushState !== w.__pushState || history.replaceState !== w.__replaceState,
      };
    });
    expect(seen).toEqual({ mutations: [], revealed: false, historyWrapped: false });

    // The observer sees a change when there is one.
    await page.evaluate(() => document.body.setAttribute('data-touched', ''));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __mutations: string[] }).__mutations))
      .toEqual(['attributes on <BODY> data-touched']);
  });
}

// --- events ----------------------------------------------------------

test('fetches the rules file, and records the arm the page reads before any event carries it', async ({
  page,
  request,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(`http://localhost:${PORTS.api}/`))
      asked.push(`${r.method()} ${new URL(r.url()).pathname.split('/').slice(2).join('/')}`);
  });

  await page.goto(PAGE);
  await ready(page);
  expect(await read(page, SLUG)).toBe('var_script_treatment');
  await track(page, 'marker');
  await flushBeacons(page);
  await expect.poll(() => eventTypes(request)).toContain('marker');

  expect(asked.filter((a) => !a.endsWith('events'))).toEqual(['GET rules']);
  const events = await getRecordedEvents(request);
  const types = events.map((e) => e.event_type);
  // The unread React experiment is never recorded.
  const recorded = events
    .filter((e) => e.event_type === '$assignment')
    .map((e) => (e.metadata as { experiment_id: string }).experiment_id);
  expect(recorded).toEqual(['exp_script_tag']);
  // The pageview went out before the read, so it carries nothing.
  expect(events.find((e) => e.event_type === 'pageview')?.experiment_assignments ?? []).toEqual([]);
  expect(types.indexOf('$assignment')).toBeLessThan(types.indexOf('marker'));
  expect(events.find((e) => e.event_type === 'marker')?.experiment_assignments).toEqual([ARM]);
});

test('fires a custom track() event on button click', async ({ page, request }) => {
  await page.goto(PAGE);
  await ready(page);

  await page.getByRole('button', { name: 'Fire event' }).click();
  await flushBeacons(page);

  await expect.poll(() => eventTypes(request)).toContain('demo_button_clicked');

  const event = (await getRecordedEvents(request)).find(
    (e) => e.event_type === 'demo_button_clicked'
  );
  expect(event?.metadata?.source).toBe('script-tag-example');
});

// --- goals are the page's track() calls (flame#60) ---
//
// ember serves flame no goals: flame registers no DOM listener, and the
// example page fires each goal with `flame.track(goal.name)`. That name is
// what the backend matches conversions on, so these specs assert that each
// interaction sends exactly one event by that name, carrying the arm, and
// that nothing else does.

const GOAL_INTERACTIONS: [string, string][] = [
  ['cart_add_clicked', '.add-to-cart-cta'],
  ['checkout_complete', '#checkout-form button[type="submit"]'],
  ['support_ticket_opened', '#open-ticket'],
];

for (const [goal, target] of GOAL_INTERACTIONS) {
  test(`a page's track('${goal}') sends one goal event carrying the arm`, async ({
    page,
    request,
  }) => {
    await page.goto(PAGE);
    await ready(page);
    await read(page, SLUG);

    await page.locator(target).click();
    await flushBeacons(page);

    await expect.poll(() => eventTypes(request)).toContain(goal);

    // One, not two: a goal listener on the same selector would add a second.
    const events = (await getRecordedEvents(request)).filter((e) => e.event_type === goal);
    expect(events).toHaveLength(1);
    expect(events[0].experiment_assignments).toContainEqual(ARM);
  });
}

test('a click or submit the page does not track sends no goal event', async ({ page, request }) => {
  await page.goto(PAGE);
  await ready(page);

  // Strip the page's own track() calls: what is left is what flame alone does
  // with a click and a submit on the goal selectors.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('#goal-targets-section [onclick]')) {
      el.removeAttribute('onclick');
    }
    document.getElementById('checkout-form')!.setAttribute('onsubmit', 'return false');
  });
  await page.locator('.add-to-cart-cta').click();
  await page.locator('#checkout-form button[type="submit"]').click();
  await page.locator('#open-ticket').click();
  await page.locator('#untracked-copy').click();
  await track(page, 'marker');
  await flushBeacons(page);

  // Wait for an event tracked after the clicks before asserting absence: a
  // goal event fired by the clicks would be queued ahead of it, so once it
  // lands, "not sent" is a real observation rather than "not sent yet".
  await expect.poll(() => eventTypes(request)).toContain('marker');

  const types = await eventTypes(request);
  expect(types).not.toContain('cart_add_clicked');
  expect(types).not.toContain('checkout_complete');
  expect(types).not.toContain('support_ticket_opened');
  expect(types).not.toContain('click');
  // A pageview goal's name is never an event name: flame fires the literal
  // `pageview`, which the backend matches by url_pattern.
  expect(types).not.toContain('pricing_viewed');
});

// --- promoted winners (flame#42, cuped-io/ember#300) -----------------

test('a promoted winner is read, but never recorded or carried', async ({ page, request }) => {
  await page.route('**/rules', (route) => route.fulfill({ json: rulesWithPromoted() }));
  await page.goto(PAGE);
  await ready(page);

  expect(await read(page, PROMOTED.slug)).toBe(PROMOTED.winner.id);
  await read(page, SLUG);
  await page.getByRole('button', { name: 'Fire event' }).click();
  await flushBeacons(page);
  await expect.poll(() => eventTypes(request)).toContain('demo_button_clicked');

  const events = await getRecordedEvents(request);
  expect(
    events.find((e) => e.event_type === 'demo_button_clicked')?.experiment_assignments
  ).toEqual([ARM]);
  const recordedIds = events
    .filter((e) => e.event_type === '$assignment')
    .map((e) => (e.metadata as { experiment_id: string }).experiment_id);
  expect(recordedIds).toEqual(['exp_script_tag']);
});
