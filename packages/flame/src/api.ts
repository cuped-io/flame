import type {
  ActiveExperimentsResponse,
  AssignmentResponse,
  CreateAssignmentRequest,
  CreateEventBatchRequest,
  CreateEventRequest,
  CreateIdentityLinkRequest,
  IdentityLinkResponse,
  IdentityMetadata,
} from './types';
import type { UserContext } from './context';

/**
 * API client for communicating with the cuped API
 *
 * Uses DSN mode where the API key is included in the URL path (/{api_key}/endpoint)
 */
export class ApiClient {
  private apiUrl: string;
  private apiKey: string;
  private debug: boolean;

  /**
   * Create an API client
   *
   * @param apiKey - API key for authentication (included in URL path)
   * @param apiUrl - API base URL
   * @param debug - Enable debug logging
   */
  constructor(apiKey: string, apiUrl: string, debug = false) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.debug = debug;
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fullPath = this.buildPath(path);
    const url = `${this.apiUrl}${fullPath}`;
    this.log(`${method} ${url}`, body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
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
  }

  /**
   * Fetch active experiments for the project
   *
   * GET /{api_key}/experiments/active
   */
  async getActiveExperiments(): Promise<ActiveExperimentsResponse> {
    return this.request<ActiveExperimentsResponse>('GET', '/experiments/active');
  }

  /**
   * Request a variant assignment for a user
   *
   * POST /{api_key}/experiments/{experiment_id}/assign
   *
   * @param experimentId - Experiment to assign user to
   * @param userId - User identifier (authenticated or device ID)
   * @param context - Device context for segment-level CUPED
   * @param identity - Identity metadata for CUPED eligibility
   */
  async assignVariant(
    experimentId: string,
    userId: string,
    context?: UserContext,
    identity?: IdentityMetadata
  ): Promise<AssignmentResponse> {
    const payload: CreateAssignmentRequest = {
      user_id: userId,
      context: context as unknown as Record<string, unknown>,
      identity,
    };
    return this.request<AssignmentResponse>('POST', `/experiments/${experimentId}/assign`, payload);
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
   * Track events using sendBeacon (fire-and-forget)
   *
   * POST /{api_key}/events with the array envelope `{ events: [...] }`.
   * A lone event is sent as an array of one — there is no separate
   * single-event endpoint.
   *
   * sendBeacon is used for reliable delivery on page navigation: the
   * browser guarantees the request is sent even if the page unloads
   * (e.g. checkout clicks that redirect to an external page).
   *
   * Note: sendBeacon does not return a response, so we can't confirm
   * the events were recorded. The server returns 204 No Content.
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
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true, // Helps with page navigation
    }).catch(() => {
      // Ignore errors - this is fire-and-forget
    });

    return true;
  }
}
