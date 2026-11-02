/**
 * Configuration options for the Flame SDK.
 *
 * Find the DSN under your project's Settings → Install Snippet.
 * Format: `https://<api_key>@<host>`. The api_key is a 32-char hex
 * string issued by cuped; the host is your cuped API hostname.
 *
 * Example:
 *   ```
 *   { dsn: 'https://YOUR_KEY@api.cuped.io' }
 *   ```
 */
export interface FlameConfig {
  /** DSN string — `https://<api_key>@<host>`, e.g. `https://YOUR_KEY@api.cuped.io`. */
  dsn: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Enable event batching (default: true) */
  enableBatching?: boolean;
  /** Number of events to queue before flushing (default: 50) */
  batchSize?: number;
  /** Interval in milliseconds to flush queued events (default: 5000) */
  flushIntervalMs?: number;
  /** Enable offline storage for failed events (default: true when batching enabled) */
  enableOfflineStorage?: boolean;
  /** Maximum number of events to store offline (default: 100) */
  maxOfflineEvents?: number;
  /** Time-to-live in milliseconds for offline events (default: 86400000 = 24 hours) */
  offlineTtlMs?: number;
  /**
   * Longest a request to ember may take, in milliseconds (default: 10000;
   * flame#58). A request that runs out counts as failed: with no rules file
   * reads answer control and init completes, and an event batch is kept and
   * sent again.
   */
  requestTimeoutMs?: number;
  /**
   * Wait for the visitor's consent before doing anything (flame#18): no ID,
   * no storage, no network, original page, until `flame.consent(true)`.
   * Script tag: `data-consent="required"`.
   */
  requireConsent?: boolean;
  /**
   * When an accept takes effect (flame#18). `'immediate'` (default) starts
   * flame on the current page, so reads answer with the visitor's arms.
   * `'next-page'` saves the grant and starts flame at the next document
   * load. That effectively excludes single-page apps and single landing pages, where the next
   * document load may never come in the same visit.
   * Script tag: `data-consent-apply="next-page"`.
   */
  consentApply?: 'immediate' | 'next-page';
  /**
   * Pre-resolved assignments + experiments. When supplied, `init()`
   * fetches no rules file and reads these at once (flame#24). Produced by
   * `@cuped-io/flame-edge` for SSR zero-flash; the React SDK forwards
   * its `prehydrated` prop here. See `PrehydratedState`.
   */
  prehydrated?: PrehydratedState;
}

/**
 * Pre-resolved SDK state. Produced at the edge (typically by
 * `@cuped-io/flame-edge`'s middleware) and consumed by `flame.init()`
 * to bypass the active-experiments + assign HTTP roundtrips on the
 * client.
 *
 * Wire format is JSON-serializable: this same shape is what the
 * edge writes to the signed cookie that the server component reads.
 */
export interface PrehydratedState {
  /** Stable user identifier used to compute deterministic assignments. */
  user_id: string;
  /** ISO timestamp when the user_id was first issued (for CUPED eligibility). */
  user_id_created_at?: string;
  /** Active experiments at resolution time. */
  experiments: Experiment[];
  /** Map from `experiment_id` → assignment. */
  assignments: Record<string, StoredAssignment>;
}

/**
 * A variant in an experiment (matches the cuped API)
 */
export interface Variant {
  /** Unique variant ID */
  id: string;
  /** ID of the experiment this variant belongs to */
  experiment_id: string;
  /** Human-readable variant name */
  name: string;
  /** Optional description. The rules file (flame#24) does not carry it. */
  description?: string | null;
  /** Whether this is the control variant */
  is_control: boolean;
  /** The pick's weight (flame#24). From the rules file only. */
  weight?: number;
  /** Timestamp when created. The rules file does not carry it. */
  created_at?: string;
  /** Timestamp when last updated. The rules file does not carry it. */
  updated_at?: string;
}

/**
 * Experiment status (matches the cuped API)
 */
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

/**
 * Goal template / category. The backend matches all variants by event
 * name — this enum is a UI template hint. flame listens to no DOM event for
 * goals (flame#60):
 * - `pageview` — Fired by flame on load and SPA navigation. Backend match
 *   additionally filters by `url_pattern`.
 * - `click` / `submit` / `custom` — Fired by the page with
 *   `flame.track(goal.name)` (or `useTrack()`).
 */
export type GoalType = 'click' | 'submit' | 'pageview' | 'custom';

/**
 * A conversion goal for tracking (matches the cuped API). All goal
 * types are matched by event name on the backend; flame fires only the
 * pageview, and the page fires the rest with `flame.track()`.
 */
export interface Goal {
  /**
   * Name of the goal — also the event name used to match incoming
   * events. Examples: `"add_to_cart"`, `"vote_cast"`,
   * `"signup_completed"`. For pageview goals this is just a label;
   * the SDK fires the literal `"pageview"` event for matching.
   */
  name: string;
  /**
   * CSS selector a `click`/`submit` goal was set up with. Neither flame
   * (since flame#60) nor the backend matcher reads it.
   */
  selector?: string;
  /** URL pattern to match for pageview goals (e.g., "/product/*", "/checkout/**") */
  url_pattern?: string;
  /** Goal template / category. See {@link GoalType}. */
  type: GoalType;
}

/**
 * An experiment (matches the cuped API)
 */
export interface Experiment {
  /** Unique experiment ID */
  id: string;
  /** URL-safe experiment slug. Reads accept it as well as the id (flame#24). */
  slug?: string;
  /** Project this experiment belongs to */
  project_id: string;
  /** Human-readable experiment name */
  name: string;
  /** Optional description */
  description: string | null;
  /** Experiment status */
  status: ExperimentStatus;
  /** Conversion goals for this experiment */
  goals?: Goal[];
  /** Timestamp when created */
  created_at: string;
  /** Timestamp when last updated */
  updated_at: string;
  /** Available variants (included in active experiments response) */
  variants?: Variant[];
  /**
   * The pages this experiment runs on, in the goals' `url_pattern` syntax
   * (flame#50). A visitor is assigned and counted only on a matching page.
   * `null` or absent: every page.
   */
  url_pattern?: string | null;
}

/**
 * Response from the active experiments endpoint
 */
export interface ActiveExperimentsResponse {
  experiments: Experiment[];
  /**
   * Concluded experiments whose winner was promoted (ember ADR 0039). An
   * experiment is in exactly one of the two lists. Absent from older APIs.
   */
  promoted?: PromotedExperiment[];
}

/**
 * A concluded experiment whose winning variant is served to everyone not
 * held out. The SDK still asks `/evaluate` (the Holdout gate runs first) but
 * tracks nothing for it: its results are frozen.
 */
export interface PromotedExperiment {
  /** Experiment ID */
  id: string;
  /** Human-readable experiment name */
  name: string;
  /** URL-safe experiment slug */
  slug: string;
  /** Timestamp when the winner was promoted */
  winner_promoted_at: string;
  /** The promoted variant, served to every visitor not held out */
  winner: Variant;
}

/**
 * Identity type indicates how reliable the user identity is for CUPED
 */
export type IdentityType = 'authenticated' | 'device' | 'session';

/**
 * Identity metadata sent with assignments
 */
export interface IdentityMetadata {
  /** Type of identity (affects CUPED eligibility) */
  type: IdentityType;
  /** Device ID (for linking authenticated users to device history) */
  device_id: string;
  /** When the device ID was created (ISO timestamp) */
  device_id_created_at?: string;
}

/**
 * Request body for creating an assignment (matches the cuped API)
 */
export interface CreateAssignmentRequest {
  /** Pseudonymous user identifier */
  user_id: string;
  /** Optional context data for segment-level CUPED */
  context?: Record<string, unknown>;
  /** Identity metadata for CUPED eligibility */
  identity?: IdentityMetadata;
}

/**
 * Which arm answered an `/assign` or `/evaluate` call (ember#278). Exactly
 * one per answer.
 *
 * - `assigned`: the caller is in a variant.
 * - `promoted_winner`: the experiment's winner, served to everyone.
 * - `held_out`: the caller is in the project's Holdout. Lasting.
 * - `cap_reached`: the workspace is at its event cap and this new caller was
 *   not enrolled. Lifts on upgrade or billing reset.
 * - `workspace_archived`: the workspace is archived and this new caller was
 *   not enrolled. Lifts on revive.
 *
 * The last three leave every variant field `null`: the caller sees the
 * original experience.
 */
export type Resolution =
  | 'assigned'
  | 'promoted_winner'
  | 'held_out'
  | 'cap_reached'
  | 'workspace_archived';

/**
 * Response from the assignment endpoint (matches the cuped API)
 */
export interface AssignmentResponse {
  /** Assignment ID. `null` unless an assignment row was written. */
  assignment_id: string | null;
  /** Experiment ID */
  experiment_id: string;
  /** Variant ID. `null` when the caller is in no variant (see `resolution`). */
  variant_id: string | null;
  /** Variant name. `null` when the caller is in no variant. */
  variant_name: string | null;
  /** Whether this is the control variant. `null` when the caller is in no variant. */
  is_control: boolean | null;
  /** Timestamp when the assignment was made. `null` unless an assignment row was written. */
  assigned_at: string | null;
  /** Which arm answered. */
  resolution: Resolution;
}

/**
 * One experiment's answer from `POST /{api_key}/evaluate` (ember ADR 0041).
 * Evaluation enrols nobody: the visitor is counted only when flame records
 * the arm it delivers (flame#46). The fields mean what they mean on
 * {@link AssignmentResponse}.
 */
export interface ExperimentEvaluation {
  experiment_id: string;
  /** The arm to deliver. `null` when held out, capped or archived. */
  variant_id: string | null;
  variant_name: string | null;
  is_control: boolean | null;
  resolution: Resolution;
}

/**
 * Response from `POST /{api_key}/evaluate`: one answer per running experiment
 * and promoted winner. An experiment with no arm to give is left out.
 */
export interface EvaluateResponse {
  evaluations: ExperimentEvaluation[];
}

/**
 * Stored assignment (local representation)
 */
export interface StoredAssignment {
  /** Experiment ID */
  experimentId: string;
  /** Assigned variant ID */
  variantId: string;
  /** User ID */
  userId: string;
  /** Timestamp of assignment */
  assignedAt: string;
}

/**
 * Alias type for identity linking
 */
export type AliasType = 'device' | 'session';

/**
 * Request body for linking identities (matches the cuped API)
 */
export interface CreateIdentityLinkRequest {
  /** The authenticated/canonical user ID */
  canonical_user_id: string;
  /** The alias user ID (device or session ID) */
  alias_user_id: string;
  /** Type of alias */
  alias_type: AliasType;
  /** When this session started (for time-bounded attribution) */
  session_start?: string;
}

/**
 * Response from the identity link endpoint (matches the cuped API)
 */
export interface IdentityLinkResponse {
  /** Link ID */
  id: string;
  /** Whether this was a new link or existing */
  linked: boolean;
}

/**
 * An experiment assignment included with an event
 */
export interface ExperimentAssignment {
  /** Experiment ID */
  experiment_id: string;
  /** Assigned variant ID */
  variant_id: string;
}

/**
 * Request body for creating an event (matches the cuped API)
 *
 * Events are the single-event architecture:
 * - Fire ONE event per user action, regardless of experiment count
 * - Include experiment assignments for server-side goal derivation
 * - Goals are matched server-side during ingestion
 */
export interface CreateEventRequest {
  /** User identifier */
  user_id: string;
  /** Type of event (pageview, add_to_cart, click, etc.) */
  event_type: string;
  /** Optional metadata for event-specific data */
  metadata?: Record<string, unknown>;
  /** Experiment assignments active at time of event */
  experiment_assignments?: ExperimentAssignment[];
  /** When it happened. ember dates an event without one at receipt. */
  occurred_at?: string;
}

/**
 * Response from the events endpoint (matches the cuped API)
 */
export interface EventResponse {
  /** Event ID */
  event_id: string;
  /** Server timestamp when the event was recorded */
  recorded_at: string;
}

/**
 * Request body for the `/events` ingest endpoint (matches the cuped API).
 *
 * The SDK always POSTs this array envelope to `POST /{api_key}/events`,
 * even for a single event (an array of one).
 */
export interface CreateEventBatchRequest {
  /** List of events to create */
  events: CreateEventRequest[];
}
