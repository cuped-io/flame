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
  /** Enable observation batching (default: true) */
  enableBatching?: boolean;
  /** Number of observations to queue before flushing (default: 10) */
  batchSize?: number;
  /** Interval in milliseconds to flush queued observations (default: 5000) */
  flushIntervalMs?: number;
  /** Enable offline storage for failed observations (default: true when batching enabled) */
  enableOfflineStorage?: boolean;
  /** Maximum number of observations to store offline (default: 100) */
  maxOfflineEvents?: number;
  /** Time-to-live in milliseconds for offline observations (default: 86400000 = 24 hours) */
  offlineTtlMs?: number;
  /**
   * Pre-resolved assignments + experiments. When supplied, `init()`
   * skips the HTTP fetch and uses these directly. Produced by
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
 * Replace `element.textContent` of the matched element.
 *
 * The lowest-risk change type — won't reflow markup or break event
 * handlers attached to children. If the element has child elements,
 * setting textContent will collapse them; use `html` instead when
 * markup needs to be preserved.
 */
export interface TextChange {
  type: 'text';
  /** CSS selector to find the element */
  selector: string;
  /** New text content to apply */
  value: string;
}

/**
 * Replace `element.innerHTML` of the matched element.
 *
 * Use when the variant needs different markup, not just different
 * copy. Higher risk than `text` — invalid markup can break the
 * surrounding layout, and event listeners attached to replaced
 * children are detached.
 */
export interface HtmlChange {
  type: 'html';
  selector: string;
  /** New HTML to set as innerHTML */
  value: string;
}

/**
 * Set an attribute on the matched element.
 *
 * Common uses: `href` on links, `src` on images, `class` (whole
 * value), `aria-*` for a11y experiments, `data-*` for analytics.
 * For incremental class add/remove use `class` instead.
 */
export interface AttributeChange {
  type: 'attribute';
  selector: string;
  /** Attribute name (e.g. "href", "src", "aria-label") */
  attribute: string;
  /** New attribute value */
  value: string;
}

/**
 * Add and/or remove classes on the matched element.
 *
 * Composes cleanly with the customer's existing styles. Both `add`
 * and `remove` are optional; supply at least one.
 */
export interface ClassChange {
  type: 'class';
  selector: string;
  /** Classes to add (no-op if already present) */
  add?: string[];
  /** Classes to remove (no-op if not present) */
  remove?: string[];
}

/**
 * Set inline styles on the matched element.
 *
 * Keys can be camelCase (`backgroundColor`) or kebab-case
 * (`background-color`); both are normalized to CSS property names.
 * For styles that should affect many elements at once, prefer `css`.
 */
export interface StyleChange {
  type: 'style';
  selector: string;
  /** Map of CSS property → value */
  styles: Record<string, string>;
}

/**
 * Inject a `<style>` tag with raw CSS into the document head.
 *
 * High value-per-line — one rule can restyle many elements at once.
 * No selector field; the CSS itself contains its own selectors.
 */
export interface CssChange {
  type: 'css';
  /** Raw CSS to inject. Use standard selectors inside. */
  css: string;
}

/**
 * Show or hide the matched element via inline `display`.
 *
 * Convenience over `style` for the common "show/hide a section"
 * test. `visible: false` sets `display: none`; `visible: true`
 * clears the inline display so the element falls back to its
 * stylesheet-defined display value.
 */
export interface VisibilityChange {
  type: 'visibility';
  selector: string;
  visible: boolean;
}

/**
 * Force navigation to a different URL when this variant is assigned.
 *
 * Fires before any other changes are applied. Useful for split-URL
 * tests (e.g. `/pricing-v1` vs `/pricing-v2`) where the variant is
 * a whole different page rather than a tweak to the current one.
 *
 * Caveat: irreversible by `rollbackChanges()` — once we navigate,
 * there's nothing left to roll back.
 */
export interface RedirectChange {
  type: 'redirect';
  /** Destination URL (absolute or root-relative) */
  url: string;
}

/**
 * A variant change to apply to the DOM.
 *
 * Discriminated union over the supported change types. Add new
 * change types here and in `flame/src/apply.ts`'s dispatch.
 */
export type VariantChange =
  | TextChange
  | HtmlChange
  | AttributeChange
  | ClassChange
  | StyleChange
  | CssChange
  | VisibilityChange
  | RedirectChange;

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
  /** Optional description */
  description: string | null;
  /** Whether this is the control variant */
  is_control: boolean;
  /** Timestamp when created */
  created_at: string;
  /** Timestamp when last updated */
  updated_at: string;
  /** Changes to apply for this variant (stored as as JSON metadata) */
  changes?: VariantChange[];
}

/**
 * Experiment status (matches the cuped API)
 */
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

/**
 * Type of event to track for a goal
 */
export type GoalType = 'click' | 'submit' | 'pageview';

/**
 * A conversion goal for tracking (matches the cuped API)
 */
export interface Goal {
  /** Name of the goal (e.g., "add_to_cart", "checkout") */
  name: string;
  /** CSS selector to match elements (required for click/submit goals) */
  selector?: string;
  /** URL pattern to match for pageview goals (e.g., "/product/*", "/checkout/**") */
  url_pattern?: string;
  /** Event type to listen for */
  type: GoalType;
}

/**
 * An experiment (matches the cuped API)
 */
export interface Experiment {
  /** Unique experiment ID */
  id: string;
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
}

/**
 * Response from the active experiments endpoint
 */
export interface ActiveExperimentsResponse {
  experiments: Experiment[];
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
 * Response from the assignment endpoint (matches the cuped API)
 */
export interface AssignmentResponse {
  /** Assignment ID */
  assignment_id: string;
  /** Experiment ID */
  experiment_id: string;
  /** Variant ID */
  variant_id: string;
  /** Variant name */
  variant_name: string;
  /** Whether this is the control variant */
  is_control: boolean;
  /** Timestamp when the assignment was made */
  assigned_at: string;
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
 * Request body for creating an event (matches the cuped API)
 */
export interface CreateEventRequest {
  /** Pseudonymous user identifier */
  user_id: string;
  /** Experiment ID */
  experiment_id: string;
  /** Variant ID */
  variant_id: string;
  /** Type of event (click, conversion, purchase, etc.) */
  event_type: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** Optional client timestamp */
  timestamp?: string;
}

/**
 * Response from the events endpoint (matches the cuped API)
 */
export interface EventResponse {
  /** Event ID */
  event_id: string;
  /** Server timestamp when event was recorded */
  recorded_at: string;
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
 * An experiment assignment included with an observation
 */
export interface ExperimentAssignment {
  /** Experiment ID */
  experiment_id: string;
  /** Assigned variant ID */
  variant_id: string;
}

/**
 * Request body for creating an observation (matches the cuped API)
 *
 * Observations are the new single-event architecture:
 * - Fire ONE observation per user action, regardless of experiment count
 * - Include experiment assignments for server-side goal derivation
 * - Goals are matched server-side during ingestion
 */
export interface CreateObservationRequest {
  /** User identifier */
  user_id: string;
  /** Type of event (pageview, add_to_cart, click, etc.) */
  event_type: string;
  /** Optional metadata for event-specific data */
  metadata?: Record<string, unknown>;
  /** Experiment assignments active at time of observation */
  experiment_assignments?: ExperimentAssignment[];
}

/**
 * Response from the observations endpoint (matches the cuped API)
 */
export interface ObservationResponse {
  /** Observation ID */
  observation_id: string;
  /** Server timestamp when observation was recorded */
  recorded_at: string;
}

/**
 * Request body for creating observations in batch (matches the cuped API)
 */
export interface CreateObservationBatchRequest {
  /** List of observations to create */
  observations: CreateObservationRequest[];
}
