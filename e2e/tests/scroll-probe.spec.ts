import { test, expect, chromium, webkit } from '@playwright/test';

/**
 * flame#39 PROBE: when consent applies a variant that grows content ABOVE
 * where the visitor has scrolled, does the page jump under them?
 * Browsers' scroll anchoring should hold the visible content still.
 * Measured in Chromium and WebKit (Safari's engine).
 */

const PAGE = 'http://localhost:8789/e2e/probe-react/scroll.html';
const API = 'http://localhost:8788';

const experiment = {
  id: 'exp_scroll',
  project_id: 'proj_e2e',
  name: 'Scroll',
  description: null,
  status: 'running',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  goals: [],
  variants: [
    {
      id: 'var_scroll_treatment',
      experiment_id: 'exp_scroll',
      name: 'treatment',
      description: null,
      is_control: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      changes: [
        { type: 'html', selector: '#grow', value: '<div style="height:600px">Tall new hero</div>' },
      ],
    },
  ],
};

for (const anchoring of [true, false])
  for (const [name, engine] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ] as const) {
    test(`${name}, scroll anchoring ${anchoring ? 'on (browser default)' : 'OFF (positive control)'}: consent applies a taller variant above the scroll position`, async () => {
      const browser = await engine.launch(
        name === 'chromium' ? { args: ['--disable-features=LocalNetworkAccessChecks'] } : {}
      );
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      // Playwright tries the most recently added route first, so the
      // catch-all goes in first.
      await page.route(`${API}/**`, (r) => r.fulfill({ json: {} }));
      await page.route(`${API}/**/experiments/active`, (r) =>
        r.fulfill({ json: { experiments: [experiment] } })
      );
      await page.route(`${API}/**/evaluate`, (r) =>
        r.fulfill({
          json: {
            evaluations: [
              {
                experiment_id: 'exp_scroll',
                variant_id: 'var_scroll_treatment',
                variant_name: 'treatment',
                is_control: false,
                held_out: false,
                cap_reached: false,
                workspace_archived: false,
              },
            ],
          },
        })
      );

      await page.goto(PAGE);
      // Positive control: with anchoring off the same change must visibly
      // shift the page, proving a 0px reading with it on is meaningful.
      if (!anchoring)
        await page.addStyleTag({ content: '* { overflow-anchor: none !important; }' });
      await page.evaluate(() =>
        document.getElementById('ref')!.scrollIntoView({ block: 'center' })
      );
      await page.waitForTimeout(300);
      const before = await page.evaluate(
        () => document.getElementById('ref')!.getBoundingClientRect().top
      );

      const state = await page.evaluate(() =>
        (
          window as unknown as { Flame: { flame: { consent: (b: boolean) => string } } }
        ).Flame.flame.consent(true)
      );
      await page.waitForFunction(() => document.getElementById('grow')!.offsetHeight > 500, null, {
        timeout: 5000,
      });
      await page.waitForTimeout(300);
      const after = await page.evaluate(
        () => document.getElementById('ref')!.getBoundingClientRect().top
      );

      const shift = Math.round(after - before);
      test.info().annotations.push({ type: 'shift px', description: String(shift) });
      console.log(
        `PROBE scroll ${name} anchoring=${anchoring} :: consent=${state} reading-position shift = ${shift}px`
      );
      await browser.close();
    });
  }
