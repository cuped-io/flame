import { test, expect } from '@playwright/test';
import { resetEvents, getRecordedEvents, flushBeacons } from './helpers';

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

// Anti-flicker isn't implemented in flame yet: the script-tag SDK
// applies variants only after the experiments/assign roundtrip, so the
// control markup paints first and is then mutated — an unavoidable
// flash today. Enable this once anti-flicker lands (issue #21). The
// SSR/next-app path already renders flash-free (see next-app.spec.ts).
test.fixme('does not flash the control before applying the treatment', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#target-text')).not.toHaveText('Original text content.');
});
