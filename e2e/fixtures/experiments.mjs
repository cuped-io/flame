/**
 * Shared test fixtures for the flame e2e suite.
 *
 * Imported by BOTH the Node mock cuped API server
 * (`mock-server/*.mjs`) and the Playwright specs (`tests/*.spec.ts`),
 * so the experiment/variant IDs the server hands out are exactly the
 * ones the tests assert against. Keep this file plain ESM (no TS) so
 * `node mock-server/api.mjs` can import it directly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Goals exactly as cuped's `/experiments/active` serves them.
 *
 * This file is a **golden instance** with a byte-identical twin in the
 * ember repo (`crates/ember-core/tests/contracts/experiments_active_goals.json`),
 * where a test asserts the endpoint emits precisely this for a known
 * goal configuration. Here it goes the other way: the mock API serves
 * it, and `tests/script-tag.spec.ts` drives real Chromium interactions
 * against `examples/script-tag/index.html` to prove the SDK turns the
 * page's `track()` calls into events named after these goals, and that it
 * fires none of them itself (flame#60).
 *
 * Why the pairing exists: cuped-io/ember#171. Goals moved to
 * project-scoped tables server-side, the SDK payload kept serializing a
 * legacy column, and browsers got `"goals": null` — every
 * dashboard-created click/submit goal recorded zero conversions,
 * silently. Both suites were green throughout: ember asserted the
 * endpoint returned experiments, and this suite asserted auto-tracking
 * worked — against a fixture that carried `goals: []`. Nothing pinned
 * the shape they exchanged.
 *
 * Read from disk rather than inlined so the twin can be diffed byte for
 * byte. Editing it means editing both copies, and the selectors below
 * must keep naming the elements that call `track()` in the script-tag
 * example page.
 */
export const CONTRACT_GOALS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./experiments-active-goals.contract.json', import.meta.url)),
    'utf8'
  )
);

/**
 * One `promoted[]` entry exactly as cuped's `/experiments/active` serves
 * it (cuped-io/ember#300, ADR 0039): a concluded experiment whose winner
 * every visitor not held out should see. Byte-identical twin of ember's
 * `crates/ember-core/tests/contracts/experiments_active_promoted.json`,
 * paired the same way as `CONTRACT_GOALS`.
 *
 * Not in the default responses. Specs that want it splice it in with
 * `page.route`.
 */
export const PROMOTED_CONTRACT = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./experiments-active-promoted.contract.json', import.meta.url)),
    'utf8'
  )
);

/** 32-char hex DSN key. `parseDsn` rejects anything else. */
export const TEST_API_KEY = '0123456789abcdef0123456789abcdef';

/** Ports the Playwright `webServer` array binds. */
export const PORTS = {
  api: 8788, // mock cuped API
  static: 8789, // static host for the script-tag example
  next: 3210, // next-app example (its own default)
};

/** DSN the examples are pointed at during e2e. */
export const TEST_DSN = `http://${TEST_API_KEY}@localhost:${PORTS.api}`;

/**
 * Script-tag experiment. flame changes nothing on the page for it
 * (flame#63): the specs read it with `flame.getVariant`.
 *
 * Its `goals` are the shared contract instance — the same JSON cuped
 * emits — so the goal specs exercise the real payload rather
 * than a shape invented here. See `CONTRACT_GOALS`.
 */
export const SCRIPT_TAG_EXPERIMENT = {
  id: 'exp_script_tag',
  slug: 'script-tag-demo',
  project_id: 'proj_e2e',
  name: 'Script-tag reads',
  description: null,
  status: 'running',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  goals: CONTRACT_GOALS,
  variants: [
    {
      id: 'var_script_control',
      experiment_id: 'exp_script_tag',
      name: 'control',
      description: null,
      is_control: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'var_script_treatment',
      experiment_id: 'exp_script_tag',
      name: 'treatment',
      description: null,
      is_control: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

/**
 * React experiment. The next-app example branches on variant *name*
 * (`control` / `treatment`). Its id
 * is fed to the app via `NEXT_PUBLIC_CUPED_EXPERIMENT_ID`.
 */
export const REACT_EXPERIMENT = {
  id: 'exp_react',
  slug: 'react-demo',
  project_id: 'proj_e2e',
  name: 'React variant',
  description: null,
  status: 'running',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  goals: [],
  variants: [
    {
      id: 'var_react_control',
      experiment_id: 'exp_react',
      name: 'control',
      description: null,
      is_control: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'var_react_treatment',
      experiment_id: 'exp_react',
      name: 'treatment',
      description: null,
      is_control: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

export const EXPERIMENTS = [SCRIPT_TAG_EXPERIMENT, REACT_EXPERIMENT];

/**
 * Deterministic assignment: everyone gets the treatment variant. The
 * suite asserts a known outcome, so we don't hash the user id.
 */
export function treatmentVariantFor(experimentId) {
  const exp = EXPERIMENTS.find((e) => e.id === experimentId);
  if (!exp) return null;
  return exp.variants.find((v) => v.name === 'treatment') ?? null;
}

/**
 * The project's rules file as ember serves it at `GET /{api_key}/rules`
 * (ember#309), from `EXPERIMENTS`. Control weighs 0, so every visitor's
 * local pick is treatment, the same arm the other endpoints answer.
 */
export const RULES = {
  version: 1,
  experiments: EXPERIMENTS.map((e) => ({
    id: e.id,
    slug: e.slug,
    url_pattern: null,
    variants: e.variants
      .map((v) => ({
        id: v.id,
        name: v.name,
        is_control: v.is_control,
        weight: v.is_control ? 0 : 1,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })),
  holdout: null,
  promoted: [],
};
