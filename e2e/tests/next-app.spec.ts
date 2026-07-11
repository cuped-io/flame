import { test, expect } from '@playwright/test';
import { resetEvents, getRecordedEvents, flushBeacons } from './helpers';

const BASE = 'http://localhost:3210';

test.beforeEach(async ({ request }) => {
  await resetEvents(request);
});

test('SSR renders the assigned variant flash-free on a warm visit', async ({ page }) => {
  // Cold first visit: the edge middleware resolves assignments and
  // writes the signed `cuped_state` cookie onto the response. The
  // browser context stores it.
  await page.goto(BASE);

  // Warm visit: this response is server-rendered straight from the
  // signed cookie, so the assigned variant is already in the HTML —
  // no control-then-treatment flash. Assert against the raw server
  // payload (page.request shares the context's cookies).
  const res = await page.request.get(BASE);
  const html = await res.text();

  expect(html).toContain('treatment branch (green)'); // <Experiment> treatment branch
  expect(html).toContain('Assigned variant:'); // useExperiment resolved server-side
  expect(html).not.toContain('loading…'); // never the fallback
});

test('useExperiment and <Experiment> show the treatment variant in the browser', async ({
  page,
}) => {
  await page.goto(BASE);

  // Declarative <Experiment> renders the treatment pill.
  await expect(page.getByText('treatment branch (green)')).toBeVisible();

  // useExperiment hook resolves to the treatment variant by name.
  const hookLine = page.getByText('Assigned variant:');
  await expect(hookLine).toBeVisible();
  await expect(hookLine.locator('strong')).toHaveText('treatment');
});

test('useTrack fires an event carrying the React assignment', async ({ page, request }) => {
  await page.goto(BASE);
  await expect(page.getByText('treatment branch (green)')).toBeVisible();

  // The example alerts() after firing — auto-dismiss so click resolves.
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Fire event' }).click();
  await flushBeacons(page);

  await expect
    .poll(async () => (await getRecordedEvents(request)).map((e) => e.event_type))
    .toContain('demo_button_clicked');

  const event = (await getRecordedEvents(request)).find(
    (e) => e.event_type === 'demo_button_clicked'
  );
  expect(event?.metadata?.source).toBe('next-example');
  expect(event?.experiment_assignments).toContainEqual({
    experiment_id: 'exp_react',
    variant_id: 'var_react_treatment',
  });
});
