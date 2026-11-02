import type {
  CreateEventBatchRequest,
  CreateEventRequest,
  CreateIdentityLinkRequest,
  IdentityLinkResponse,
} from './types';

/**
 * What became of a batch sent with {@link ApiClient.sendEvents}.
 *
 * - `sent`: ember accepted it.
 * - `retry`: it may succeed later (network error, a retryable `code`, or,
 *   with no `code` flame knows, a 5xx, 408 or 429).
 * - `refused`: it never will (any other refusal).
 */
export type EventDelivery = 'sent' | 'retry' | 'refused';

/**
 * Every `code` ember puts in an SDK route's refusal (ember#364), and whether
 * sending the same request again can help. Mirrors
 * `contracts/sdk-refusals.contract.json`.
 */
export const REFUSAL_RETRIES = {
  invalid_api_key: false,
  publishable_key_required: false,
  api_key_not_project_scoped: false,
  rate_limited: true,
  invalid_body: false,
  invalid_event: false,
  payload_too_large: false,
  origin_not_allowed: false,
  domain_claim_conflict: false,
  daily_cap_exceeded: false,
  quota_exceeded: false,
  workspace_archived: false,
  ingest_unavailable: true,
} satisfies Record<string, boolean>;

/** A `code` ember puts in an SDK route's refusal. */
export type RefusalCode = keyof typeof REFUSAL_RETRIES;

/** The `code` in a refusal's JSON body, if it is one flame knows. */
function refusalCode(body: string): RefusalCode | undefined {
  try {
    const code = (JSON.parse(body) as { code?: unknown } | null)?.code;
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(REFUSAL_RETRIES, code)
      ? (code as RefusalCode)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a refusal from ember is worth sending the same batch again. Goes by
 * its `code`, never its prose. With no `code` flame knows (a server fault, or
 * a proxy in front of ember), goes by the status.
 */
function isRetryable(status: number, body: string): boolean {
  const code = refusalCode(body);
  if (code) return REFUSAL_RETRIES[code];
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Longest a request to ember may take by default, in milliseconds (flame#58).
 * The same as flame-edge's limit on its rules fetch.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * API client for communicating with the cuped API
 *
 * Uses DSN mode where the API key is included in the URL path (/{api_key}/endpoint)
 */
export class ApiClient {
  private apiUrl: string;
  private apiKey: string;
  private debug: boolean;
  private timeoutMs: number;

  /**
   * Create an API client
   *
   * @param apiKey - API key for authentication (included in URL path)
   * @param apiUrl - API base URL
   * @param debug - Enable debug logging
   * @param timeoutMs - Longest a request may take before it is aborted
   */
  constructor(
    apiKey: string,
    apiUrl: string,
    debug = false,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.debug = debug;
    this.timeoutMs = timeoutMs;
  }

  private log(...args: unknown[]) {
    if (this.debug) {
      console.log('[Flame]', ...args);
    }
  }

  /**
   * Build the path for an API request
   * Prepends the API key to the path
   */
  private buildPath(path: string): string {
    return `/${this.apiKey}${path}`;
  }

  /**
   * A signal that aborts once the time limit passes (flame#58), so a server
   * that never answers fails the request instead of holding it forever.
   * `clear` stops the timer once the answer, body included, is read.
   */
  private timeLimit(): { signal: AbortSignal; clear: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Request timed out after ${this.timeoutMs} ms`)),
      this.timeoutMs
    );
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fullPath = this.buildPath(path);
    const url = `${this.apiUrl}${fullPath}`;
    this.log(`${method} ${url}`, body);

    const limit = this.timeLimit();
    try {
      // A GET sends no Content-Type, so the browser asks no CORS preflight and
      // the rules file costs one request.
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: limit.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API request failed: ${response.status} ${error}`);
      }

      // Handle 201 Created, 204 No Content, and other success codes that may have no body
      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      const data = JSON.parse(text);
      this.log('Response:', data);
      return data as T;
    } finally {
      limit.clear();
    }
  }

  /**
   * The project's rules file (ember#309): the same for every visitor, and
   * cached at the edge for about a minute. Returned unparsed: the caller
   * checks its version.
   *
   * GET /{api_key}/rules
   */
  async getRules(): Promise<unknown> {
    return this.request<unknown>('GET', '/rules');
  }

  /**
   * Link an authenticated user ID to a device/session ID
   *
   * POST /{api_key}/identity/link
   *
   * This enables CUPED to find pre-period events from before the user
   * authenticated, improving variance reduction.
   *
   * @param canonicalUserId - The authenticated user ID
   * @param aliasUserId - The device or session ID to link
   * @param aliasType - Type of alias ('device' or 'session')
   * @param sessionStart - When this session started (for time-bounded attribution)
   */
  async linkIdentity(
    canonicalUserId: string,
    aliasUserId: string,
    aliasType: 'device' | 'session',
    sessionStart?: string
  ): Promise<IdentityLinkResponse> {
    const payload: CreateIdentityLinkRequest = {
      canonical_user_id: canonicalUserId,
      alias_user_id: aliasUserId,
      alias_type: aliasType,
      session_start: sessionStart,
    };
    return this.request<IdentityLinkResponse>('POST', '/identity/link', payload);
  }

  /**
   * Send events and report what ember answered (flame#40)
   *
   * POST /{api_key}/events with the same `{ events: [...] }` envelope as
   * the beacon. A keepalive fetch outlives the page like a beacon does,
   * but it also sees the response.
   */
  async sendEvents(events: CreateEventRequest[]): Promise<EventDelivery> {
    const payload: CreateEventBatchRequest = { events };
    const url = `${this.apiUrl}${this.buildPath('/events')}`;
    this.log('fetch events', url, { count: events.length });

    // A timeout rejects like a network error, so it is retried the same way.
    const limit = this.timeLimit();
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          // text/plain, as for the beacon: no CORS preflight.
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload),
          keepalive: true,
          signal: limit.signal,
        });
      } catch (error) {
        this.log('Events not delivered, will retry:', error);
        return 'retry';
      }

      // Including the one refusal with no status: ember answers 204 to a
      // workspace that is archived, and drops the batch (spark#68).
      if (response.ok) {
        return 'sent';
      }
      const body = await response.text().catch(() => '');
      if (isRetryable(response.status, body)) {
        this.log(`Events not delivered (${response.status}), will retry`);
        return 'retry';
      }
      if (this.debug) {
        const noun = events.length === 1 ? 'event' : 'events';
        this.log(`ember refused ${events.length} ${noun} (${response.status}), dropping:`, body);
      }
      return 'refused';
    } finally {
      limit.clear();
    }
  }

  /**
   * Track events using sendBeacon (fire-and-forget)
   *
   * POST /{api_key}/events with the array envelope `{ events: [...] }`.
   * A lone event is sent as an array of one — there is no separate
   * single-event endpoint.
   *
   * For when the page may be leaving: the browser sends a beacon even if
   * the page unloads (e.g. checkout clicks that redirect to an external
   * page). While the page is open, use {@link sendEvents}.
   *
   * Note: sendBeacon never sees the response, so a 4xx or 5xx from ember
   * is lost unseen (flame#40). `true` means queued, not delivered.
   *
   * @param events - Events to send (at least one)
   * @returns true if the beacon was queued successfully, false otherwise
   */
  trackEventsBeacon(events: CreateEventRequest[]): boolean {
    if (events.length === 0) {
      return true;
    }

    const payload: CreateEventBatchRequest = { events };

    const fullPath = this.buildPath('/events');
    const url = `${this.apiUrl}${fullPath}`;
    this.log('sendBeacon events', url, { count: events.length });

    // Use text/plain to avoid CORS preflight - application/json triggers preflight
    // which can fail if the page navigates away before preflight completes.
    // The server parses JSON regardless of content-type.
    const blob = new Blob([JSON.stringify(payload)], { type: 'text/plain' });

    // Check if sendBeacon is available (it should be in modern browsers)
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const queued = navigator.sendBeacon(url, blob);
      this.log('sendBeacon events queued:', queued);
      return queued;
    }

    // Fallback: fire-and-forget fetch (won't work reliably on page navigation)
    this.log('sendBeacon not available, falling back to fetch');
    const limit = this.timeLimit();
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true, // Helps with page navigation
      signal: limit.signal,
    })
      .catch(() => {
        // Ignore errors - this is fire-and-forget
      })
      .finally(limit.clear);

    return true;
  }
}
