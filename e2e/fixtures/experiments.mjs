/**
 * Shared test fixtures for the flame e2e suite.
 *
 * Imported by BOTH the Node mock cuped API server
 * (`mock-server/*.mjs`) and the Playwright specs (`tests/*.spec.ts`),
 * so the experiment/variant IDs the server hands out are exactly the
 * ones the tests assert against. Keep this file plain ESM (no TS) so
 * `node mock-server/api.mjs` can import it directly.
 */

/**
 * One `promoted` entry of the rules file (ember ADR 0039): a concluded
 * experiment whose winner every visitor not held out should see.
 *
 * Not in the default rules file. Specs that want it splice it in with
 * `page.route`.
 */
export const PROMOTED = {
  id: '00000000-0000-4000-8000-000000000300',
  slug: 'promoted-winner',
  url_pattern: null,
  winner_promoted_at: '2026-10-10T12:00:00Z',
  winner: {
    id: '00000000-0000-4000-8000-000000000302',
    name: 'Treatment',
    is_control: false,
    weight: 1,
  },
};

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
 * The project's rules file as ember serves it at `GET /{api_key}/rules`
 * (ember#309), from `EXPERIMENTS`. Control weighs 0, so every visitor's
 * pick is treatment.
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
