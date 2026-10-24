import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TrackingManager } from './tracking';
import { getEcommerceGoals } from './ecommerce';
import type { StoredAssignment } from './types';
import type { ApiClient } from './api';

describe('TrackingManager', () => {
  let mockApiClient: ApiClient;

  beforeEach(() => {
    document.body.innerHTML = '';
    mockApiClient = {
      trackEventsBeacon: vi.fn().mockReturnValue(true),
    } as unknown as ApiClient;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerAssignment', () => {
    it('should register an assignment', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };

      manager.registerAssignment(assignment);

      // Assignment is stored internally - verify by checking getExperimentAssignments
      const assignments = manager.getExperimentAssignments();
      expect(assignments).toContainEqual({ experiment_id: 'exp-1', variant_id: 'variant-1' });
    });
  });

  describe('startAutoTracking', () => {
    it('should add click event listener', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.startAutoTracking();

      expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
    });

    it('should not add duplicate listeners', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.startAutoTracking();
      manager.startAutoTracking();

      // Should only be called twice (click + submit), not four times
      expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopAutoTracking', () => {
    it('should remove click event listener', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.startAutoTracking();
      manager.stopAutoTracking();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
    });

    it('should do nothing if not tracking', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.stopAutoTracking();

      expect(removeEventListenerSpy).not.toHaveBeenCalled();
    });
  });

  describe('click tracking', () => {
    it('should track clicks on flame-modified elements as events', () => {
      document.body.innerHTML = `
        <button id="cta" data-flame-modified="true" data-flame-selector="#cta">
          Click me
        </button>
      `;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      manager.registerAssignment(assignment);
      manager.startAutoTracking();

      const button = document.querySelector('#cta') as HTMLElement;
      button.click();

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'click',
          metadata: expect.objectContaining({ selector: '#cta', variant_click: true }),
          experiment_assignments: [{ experiment_id: 'exp-1', variant_id: 'variant-1' }],
        }),
      ]);
    });

    it('should track clicks on children of flame-modified elements', () => {
      document.body.innerHTML = `
        <div id="container" data-flame-modified="true" data-flame-selector="#container">
          <span id="inner">Click me</span>
        </div>
      `;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      manager.registerAssignment(assignment);
      manager.startAutoTracking();

      const inner = document.querySelector('#inner') as HTMLElement;
      inner.click();

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'click',
          metadata: expect.objectContaining({ selector: '#container', variant_click: true }),
          experiment_assignments: [{ experiment_id: 'exp-1', variant_id: 'variant-1' }],
        }),
      ]);
    });

    it('should not track clicks on non-modified elements without goals', () => {
      document.body.innerHTML = `
        <button id="normal">Not modified</button>
      `;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      manager.registerAssignment(assignment);
      manager.startAutoTracking();

      const button = document.querySelector('#normal') as HTMLElement;
      button.click();

      expect(mockApiClient.trackEventsBeacon).not.toHaveBeenCalled();
    });

    it('should include all experiment assignments in events', () => {
      document.body.innerHTML = `
        <button id="cta" data-flame-modified="true" data-flame-selector="#cta">
          Click me
        </button>
      `;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      const assignment1: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      const assignment2: StoredAssignment = {
        experimentId: 'exp-2',
        variantId: 'variant-2',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };

      manager.registerAssignment(assignment1);
      manager.registerAssignment(assignment2);
      manager.startAutoTracking();

      const button = document.querySelector('#cta') as HTMLElement;
      button.click();

      // Single event with all assignments
      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledTimes(1);
      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'click',
          metadata: expect.objectContaining({ selector: '#cta', variant_click: true }),
          experiment_assignments: expect.arrayContaining([
            { experiment_id: 'exp-1', variant_id: 'variant-1' },
            { experiment_id: 'exp-2', variant_id: 'variant-2' },
          ]),
        }),
      ]);
    });
  });

  describe('goal tracking', () => {
    it('should track click goals as events', () => {
      document.body.innerHTML = `
        <button id="add-to-cart" class="add-to-cart-btn">Add to Cart</button>
      `;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      manager.registerAssignment(assignment);
      manager.registerGoals('exp-1', [
        { name: 'add_to_cart', selector: '.add-to-cart-btn', type: 'click' },
      ]);
      manager.startAutoTracking();

      const button = document.querySelector('#add-to-cart') as HTMLElement;
      button.click();

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'add_to_cart',
          metadata: expect.objectContaining({ selector: '.add-to-cart-btn', event_type: 'click' }),
          experiment_assignments: [{ experiment_id: 'exp-1', variant_id: 'variant-1' }],
        }),
      ]);
    });

    it('should track goals on child elements', () => {
      document.body.innerHTML = `
        <button class="checkout-btn">
          <span class="btn-text">Checkout</span>
        </button>
      `;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      manager.registerAssignment(assignment);
      manager.registerGoals('exp-1', [
        { name: 'checkout', selector: '.checkout-btn', type: 'click' },
      ]);
      manager.startAutoTracking();

      const span = document.querySelector('.btn-text') as HTMLElement;
      span.click();

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'checkout',
          metadata: expect.objectContaining({ selector: '.checkout-btn', event_type: 'click' }),
          experiment_assignments: [{ experiment_id: 'exp-1', variant_id: 'variant-1' }],
        }),
      ]);
    });

    it('should deduplicate goals with same name', () => {
      document.body.innerHTML = `
        <button class="checkout-btn">Checkout</button>
      `;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      // Register same goal for multiple experiments
      manager.registerAssignment({
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });
      manager.registerAssignment({
        experimentId: 'exp-2',
        variantId: 'variant-2',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });
      manager.registerGoals('exp-1', [
        { name: 'checkout', selector: '.checkout-btn', type: 'click' },
      ]);
      manager.registerGoals('exp-2', [
        { name: 'checkout', selector: '.checkout-btn', type: 'click' },
      ]);
      manager.startAutoTracking();

      const button = document.querySelector('.checkout-btn') as HTMLElement;
      button.click();

      // Should only fire one event, not two
      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledTimes(1);
    });

    it('should fire a submit goal with no selector on any form submit', () => {
      document.body.innerHTML = `
        <form id="contact"><button type="submit">Send</button></form>
      `;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      manager.registerAssignment({
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });
      // No selector — the no-code "track any form submit" case.
      manager.registerGoals('exp-1', [{ name: 'lead_submitted', type: 'submit' }]);
      manager.startAutoTracking();

      const form = document.querySelector('#contact') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'lead_submitted',
          metadata: expect.objectContaining({ event_type: 'submit' }),
          experiment_assignments: [{ experiment_id: 'exp-1', variant_id: 'variant-1' }],
        }),
      ]);
    });

    // flame#54: most built-in submit selectors name the button inside the form
    // (`.newsletter-form button[type="submit"]`). The submit event's target is
    // the form, so those parts only match through `event.submitter`. Real
    // submits (button.click()), against the real built-in goal list.
    it.each([
      [
        '<form class="newsletter-form"><button type="submit">Join</button></form>',
        'newsletter_signup',
      ],
      [
        '<form action="/newsletter"><button type="submit">Join</button></form>',
        'newsletter_signup',
      ],
      [
        '<form data-action="newsletter"><button type="submit">Join</button></form>',
        'newsletter_signup',
      ],
      ['<form role="search"><button type="submit">Go</button></form>', 'search'],
      ['<form action="/search"><button type="submit">Go</button></form>', 'search'],
    ])('fires the built-in submit goal for %s', (html, goalName) => {
      document.body.innerHTML = html;
      document.querySelector('form')!.addEventListener('submit', (e) => e.preventDefault());

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      manager.registerAssignment({
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });
      manager.registerGoals('exp-1', getEcommerceGoals());
      manager.startAutoTracking();

      (document.querySelector('button') as HTMLButtonElement).click();

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({ event_type: goalName }),
      ]);
    });

    it('does not fire a built-in submit goal for an unrelated form', () => {
      document.body.innerHTML =
        '<form action="/contact"><button type="submit">Send</button></form>';
      document.querySelector('form')!.addEventListener('submit', (e) => e.preventDefault());

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      manager.registerAssignment({
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });
      manager.registerGoals('exp-1', getEcommerceGoals());
      manager.startAutoTracking();

      (document.querySelector('button') as HTMLButtonElement).click();

      expect(mockApiClient.trackEventsBeacon).not.toHaveBeenCalled();
    });

    it('should NOT fire a click goal with no selector (clicks need an explicit target)', () => {
      document.body.innerHTML = `<button id="cta">Buy</button>`;

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      manager.registerAssignment({
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });
      manager.registerGoals('exp-1', [{ name: 'any_click', type: 'click' }]);
      manager.startAutoTracking();

      (document.querySelector('#cta') as HTMLElement).click();

      expect(mockApiClient.trackEventsBeacon).not.toHaveBeenCalled();
    });
  });

  describe('debug mode', () => {
    it('should log when debug is enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new TrackingManager(mockApiClient, 'user-123', {
        debug: true,
        enableBatching: false,
      });
      manager.track('test_event');

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should log start/stop auto tracking when debug enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new TrackingManager(mockApiClient, 'user-123', {
        debug: true,
        enableBatching: false,
      });
      manager.startAutoTracking();
      manager.stopAutoTracking();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Flame] Started auto-tracking clicks and form submissions'
      );
      expect(consoleSpy).toHaveBeenCalledWith('[Flame] Stopped auto-tracking');
    });
  });

  // ============================================================================
  // Event Tracking Tests
  // ============================================================================

  describe('getExperimentAssignments', () => {
    it('should return empty array when no assignments registered', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      const assignments = manager.getExperimentAssignments();

      expect(assignments).toEqual([]);
    });

    it('should return all registered experiment assignments', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      const assignment1: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      const assignment2: StoredAssignment = {
        experimentId: 'exp-2',
        variantId: 'variant-2',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };

      manager.registerAssignment(assignment1);
      manager.registerAssignment(assignment2);

      const assignments = manager.getExperimentAssignments();

      expect(assignments).toHaveLength(2);
      expect(assignments).toContainEqual({ experiment_id: 'exp-1', variant_id: 'variant-1' });
      expect(assignments).toContainEqual({ experiment_id: 'exp-2', variant_id: 'variant-2' });
    });
  });

  describe('track', () => {
    it('should track event without assignments', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.track('pageview');

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'pageview',
          metadata: expect.objectContaining({
            url: expect.any(String),
            path: expect.any(String),
          }),
        }),
      ]);
    });

    it('should include metadata when provided', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.track('add_to_cart', { product_id: 'prod-123', value: 49.99 });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'add_to_cart',
          metadata: expect.objectContaining({ product_id: 'prod-123', value: 49.99 }),
        }),
      ]);
    });

    it('should include experiment assignments when registered', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      manager.registerAssignment(assignment);

      manager.track('click', { element: '#button' });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'click',
          metadata: expect.objectContaining({ element: '#button' }),
          experiment_assignments: [{ experiment_id: 'exp-1', variant_id: 'variant-1' }],
        }),
      ]);
    });

    it('should include multiple experiment assignments', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.registerAssignment({
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });
      manager.registerAssignment({
        experimentId: 'exp-2',
        variantId: 'variant-2',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });

      manager.track('purchase', { order_id: 'order-123' });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'purchase',
          metadata: expect.objectContaining({ order_id: 'order-123' }),
          experiment_assignments: expect.arrayContaining([
            { experiment_id: 'exp-1', variant_id: 'variant-1' },
            { experiment_id: 'exp-2', variant_id: 'variant-2' },
          ]),
        }),
      ]);
    });

    it('should log when debug mode is enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new TrackingManager(mockApiClient, 'user-123', {
        debug: true,
        enableBatching: false,
      });
      manager.track('pageview');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Flame] Tracking:',
        expect.objectContaining({
          eventType: 'pageview',
          experimentAssignments: 0,
        })
      );
    });

    it('should auto-enrich with url, path, title, and referrer', () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/products/widget',
          href: 'https://example.com/products/widget',
        },
        writable: true,
      });
      Object.defineProperty(document, 'title', { value: 'Widget Page', writable: true });
      Object.defineProperty(document, 'referrer', { value: 'https://google.com', writable: true });

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      manager.track('add_to_cart', { product_id: 'widget-123' });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'add_to_cart',
          metadata: expect.objectContaining({
            url: 'https://example.com/products/widget',
            path: '/products/widget',
            title: 'Widget Page',
            referrer: 'https://google.com',
            product_id: 'widget-123',
          }),
        }),
      ]);
    });

    it('should allow user metadata to override auto-enriched values', () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/products/widget',
          href: 'https://example.com/products/widget',
        },
        writable: true,
      });

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      // User can override the auto-enriched url if needed (e.g., for SPAs with virtual URLs)
      manager.track('checkout', {
        url: 'https://example.com/checkout/step-2',
        cart_id: 'cart-123',
      });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'checkout',
          metadata: expect.objectContaining({
            url: 'https://example.com/checkout/step-2',
            cart_id: 'cart-123',
          }),
        }),
      ]);
    });
  });

  describe('trackPageview', () => {
    it('should track pageview with path and title', () => {
      // Mock window.location
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/products/widget',
          href: 'https://example.com/products/widget',
        },
        writable: true,
      });

      // Mock document.title
      Object.defineProperty(document, 'title', {
        value: 'Widget Product Page',
        writable: true,
      });

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      manager.trackPageview();

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'pageview',
          metadata: expect.objectContaining({
            path: '/products/widget',
            url: 'https://example.com/products/widget',
            title: 'Widget Product Page',
          }),
        }),
      ]);
    });

    it('should include experiment assignments in pageview', () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/checkout',
          href: 'https://example.com/checkout',
        },
        writable: true,
      });

      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });
      manager.registerAssignment({
        experimentId: 'checkout-exp',
        variantId: 'variant-b',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });

      manager.trackPageview();

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'pageview',
          metadata: expect.objectContaining({ path: '/checkout' }),
          experiment_assignments: [{ experiment_id: 'checkout-exp', variant_id: 'variant-b' }],
        }),
      ]);
    });
  });

  describe('track ecommerce events', () => {
    it('should track add_to_cart event', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.track('add_to_cart', {
        product_id: 'prod-123',
        product_name: 'Widget Pro',
        value: 49.99,
        quantity: 2,
      });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'add_to_cart',
          metadata: expect.objectContaining({
            product_id: 'prod-123',
            product_name: 'Widget Pro',
            value: 49.99,
            quantity: 2,
          }),
        }),
      ]);
    });

    it('should track purchase event', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.track('purchase', {
        order_id: 'order-456',
        total: 199.99,
        currency: 'USD',
        items: ['prod-1', 'prod-2'],
      });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'purchase',
          metadata: expect.objectContaining({
            order_id: 'order-456',
            total: 199.99,
            currency: 'USD',
            items: ['prod-1', 'prod-2'],
          }),
        }),
      ]);
    });

    it('should track checkout event with experiment assignments', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.registerAssignment({
        experimentId: 'checkout-flow',
        variantId: 'simplified',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      });

      manager.track('checkout', {
        cart_id: 'cart-789',
        item_count: 3,
      });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'checkout',
          metadata: expect.objectContaining({ cart_id: 'cart-789', item_count: 3 }),
          experiment_assignments: [{ experiment_id: 'checkout-flow', variant_id: 'simplified' }],
        }),
      ]);
    });

    it('should track view_item event', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.track('view_item', {
        product_id: 'prod-999',
        category: 'electronics',
      });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'view_item',
          metadata: expect.objectContaining({ product_id: 'prod-999', category: 'electronics' }),
        }),
      ]);
    });

    it('should track remove_from_cart event', () => {
      const manager = new TrackingManager(mockApiClient, 'user-123', { enableBatching: false });

      manager.track('remove_from_cart', {
        product_id: 'prod-123',
        quantity: 1,
      });

      expect(mockApiClient.trackEventsBeacon).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-123',
          event_type: 'remove_from_cart',
          metadata: expect.objectContaining({ product_id: 'prod-123', quantity: 1 }),
        }),
      ]);
    });
  });
});

// ember rejects a whole /events envelope over one malformed $assignment
// (measured on dev, 2026-10-15), pageview included. So flame drops a record
// ember would refuse rather than send it (flame#46).
describe('recordAssignment drops a record ember would refuse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sendSpy = () => {
    const trackEventsBeacon = vi.fn(() => true);
    const manager = new TrackingManager({ trackEventsBeacon } as unknown as ApiClient, 'user-123', {
      enableBatching: false,
    });
    return { manager, trackEventsBeacon };
  };

  it('sends a well-formed record', () => {
    const { manager, trackEventsBeacon } = sendSpy();
    expect(manager.recordAssignment('exp-1', 'var-1')).toBe(true);
    expect(trackEventsBeacon).toHaveBeenCalledTimes(1);
  });

  it('tells the caller once the browser accepts the record, and not before', () => {
    const trackEventsBeacon = vi.fn(() => true);
    const manager = new TrackingManager({ trackEventsBeacon } as unknown as ApiClient, 'user-123', {
      flushIntervalMs: 60_000,
    });
    const onSent = vi.fn();
    manager.recordAssignment('exp-1', 'var-1', {}, onSent);
    expect(onSent).not.toHaveBeenCalled();
    manager.flush();
    expect(onSent).toHaveBeenCalledOnce();
    manager.discard();
  });

  it('does not tell the caller when the browser refuses an unbatched record', () => {
    const trackEventsBeacon = vi.fn(() => false);
    const manager = new TrackingManager({ trackEventsBeacon } as unknown as ApiClient, 'user-123', {
      enableBatching: false,
    });
    const onSent = vi.fn();
    manager.recordAssignment('exp-1', 'var-1', {}, onSent);
    expect(onSent).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty experiment id', '', 'var-1', {}],
    ['an empty variant id', 'exp-1', '', {}],
    ['metadata over 4 KB', 'exp-1', 'var-1', { context: { blob: 'x'.repeat(5000) } }],
    // ember counts bytes: 2,100 two-byte characters are 4,200 bytes.
    [
      'metadata over 4 KB in bytes but not characters',
      'exp-1',
      'var-1',
      { context: { blob: 'é'.repeat(2100) } },
    ],
  ])('drops a record with %s, with a warning', (_case, experimentId, variantId, extras) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, trackEventsBeacon } = sendSpy();
    expect(manager.recordAssignment(experimentId, variantId, extras)).toBe(false);
    expect(trackEventsBeacon).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});
