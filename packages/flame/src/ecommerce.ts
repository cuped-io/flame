import type { Goal } from './types';

/**
 * Pre-defined e-commerce goals for auto-detection
 * These selectors cover common patterns across major e-commerce platforms
 */
export const ECOMMERCE_GOALS: Goal[] = [
  {
    name: 'add_to_cart',
    selector: [
      // Data attribute patterns
      "[data-action*='add-to-cart']",
      "[data-action*='addToCart']",
      "[data-testid*='add-to-cart']",
      // Class name patterns
      '.add-to-cart',
      '.add-to-cart-btn',
      '.addToCart',
      '.btn-add-to-cart',
      // Button text/name patterns
      "button[name*='add']",
      // Form patterns (Shopify, WooCommerce)
      "form[action*='cart'] button[type='submit']",
      "form[action*='/cart/add'] button",
      // Platform-specific
      '.single_add_to_cart_button', // WooCommerce
      '.product-form__submit', // Shopify
    ].join(', '),
    type: 'click',
  },
  {
    name: 'checkout',
    selector: [
      // Data attribute patterns
      "[data-action*='checkout']",
      "[data-testid*='checkout']",
      // Class name patterns
      '.checkout-button',
      '.checkout-btn',
      '.btn-checkout',
      '.proceed-to-checkout',
      // Link patterns
      "a[href*='checkout']",
      // Platform-specific
      '.wc-proceed-to-checkout', // WooCommerce
      '.cart__checkout-button', // Shopify
    ].join(', '),
    type: 'click',
  },
  {
    name: 'buy_now',
    selector: [
      // Data attribute patterns
      "[data-action*='buy-now']",
      "[data-action*='buyNow']",
      // Class name patterns
      '.buy-now',
      '.buy-now-btn',
      '.buyNow',
      '.btn-buy-now',
      '.instant-buy',
    ].join(', '),
    type: 'click',
  },
  {
    name: 'newsletter_signup',
    selector: [
      // Form patterns
      "form[action*='subscribe'] button[type='submit']",
      "form[action*='newsletter'] button[type='submit']",
      "form[action*='signup'] button[type='submit']",
      // Class patterns
      '.newsletter-form button[type="submit"]',
      '.newsletter-signup button',
      '.subscribe-form button[type="submit"]',
      // Data attribute patterns
      "[data-action*='subscribe']",
      "[data-action*='newsletter']",
    ].join(', '),
    type: 'submit',
  },
  {
    name: 'wishlist_add',
    selector: [
      // Data attribute patterns
      "[data-action*='wishlist']",
      "[data-action*='add-to-wishlist']",
      // Class patterns
      '.add-to-wishlist',
      '.wishlist-btn',
      '.btn-wishlist',
      // Platform-specific
      '.yith-wcwl-add-button', // YITH WooCommerce Wishlist
    ].join(', '),
    type: 'click',
  },
  {
    name: 'search',
    selector: [
      // Form patterns
      "form[action*='search'] button[type='submit']",
      "form[role='search'] button[type='submit']",
      // Class patterns
      '.search-form button[type="submit"]',
      '.search-submit',
      // Data attribute patterns
      "[data-action*='search']",
    ].join(', '),
    type: 'submit',
  },
];

/**
 * Get e-commerce goals that have matching elements on the current page
 * This filters out goals that don't have any matching elements
 */
export function getActiveEcommerceGoals(): Goal[] {
  return ECOMMERCE_GOALS.filter((goal) => {
    // Skip goals without selectors (e.g., pageview goals)
    if (!goal.selector) {
      return false;
    }
    try {
      const elements = document.querySelectorAll(goal.selector);
      return elements.length > 0;
    } catch {
      // Invalid selector - skip this goal
      return false;
    }
  });
}

/**
 * Get all e-commerce goals (regardless of whether elements exist)
 */
export function getEcommerceGoals(): Goal[] {
  return [...ECOMMERCE_GOALS];
}

/**
 * Check if a selector matches any elements on the page
 */
export function selectorHasMatches(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length > 0;
  } catch {
    return false;
  }
}
