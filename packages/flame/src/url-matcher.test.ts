import { describe, it, expect } from 'vitest';
import { matchUrlPattern } from './url-matcher';

describe('matchUrlPattern', () => {
  describe('exact matches', () => {
    it('matches exact path', () => {
      expect(matchUrlPattern('/about', '/about')).toBe(true);
    });

    it('does not match different path', () => {
      expect(matchUrlPattern('/about', '/contact')).toBe(false);
    });

    it('matches root path', () => {
      expect(matchUrlPattern('/', '/')).toBe(true);
    });

    it('normalizes trailing slashes', () => {
      expect(matchUrlPattern('/about/', '/about')).toBe(true);
      expect(matchUrlPattern('/about', '/about/')).toBe(true);
    });
  });

  describe('single star (*) - matches one segment', () => {
    it('matches single segment', () => {
      expect(matchUrlPattern('/product/*', '/product/123')).toBe(true);
      expect(matchUrlPattern('/product/*', '/product/abc')).toBe(true);
    });

    it('does not match multiple segments', () => {
      expect(matchUrlPattern('/product/*', '/product/123/details')).toBe(false);
    });

    it('does not match zero segments', () => {
      expect(matchUrlPattern('/product/*', '/product')).toBe(false);
      expect(matchUrlPattern('/product/*', '/product/')).toBe(false);
    });

    it('matches in middle of path', () => {
      expect(matchUrlPattern('/shop/*/details', '/shop/item/details')).toBe(true);
      expect(matchUrlPattern('/shop/*/details', '/shop/123/details')).toBe(true);
    });

    it('does not match wrong segments in middle', () => {
      expect(matchUrlPattern('/shop/*/details', '/shop/item/info')).toBe(false);
    });

    it('matches multiple single stars', () => {
      expect(matchUrlPattern('/*/products/*', '/shop/products/123')).toBe(true);
      expect(matchUrlPattern('/*/*', '/a/b')).toBe(true);
    });
  });

  describe('double star (**) - matches any segments', () => {
    it('matches zero segments', () => {
      expect(matchUrlPattern('/checkout/**', '/checkout')).toBe(true);
    });

    it('matches one segment', () => {
      expect(matchUrlPattern('/checkout/**', '/checkout/step1')).toBe(true);
    });

    it('matches multiple segments', () => {
      expect(matchUrlPattern('/checkout/**', '/checkout/step1/confirm')).toBe(true);
      expect(matchUrlPattern('/checkout/**', '/checkout/a/b/c/d')).toBe(true);
    });

    it('does not match different prefix', () => {
      expect(matchUrlPattern('/checkout/**', '/checkouts')).toBe(false);
      expect(matchUrlPattern('/checkout/**', '/cart/checkout')).toBe(false);
    });

    it('matches at end of pattern only', () => {
      expect(matchUrlPattern('/api/**', '/api')).toBe(true);
      expect(matchUrlPattern('/api/**', '/api/v1/users/123')).toBe(true);
    });
  });

  describe('mixed patterns', () => {
    it('handles * followed by **', () => {
      expect(matchUrlPattern('/shop/*/items/**', '/shop/electronics/items')).toBe(true);
      expect(matchUrlPattern('/shop/*/items/**', '/shop/electronics/items/phones/iphone')).toBe(
        true
      );
    });

    it('handles **/ at start of pattern', () => {
      // **/checkout matches any path ending with /checkout
      expect(matchUrlPattern('**/checkout', '/checkout')).toBe(true);
      expect(matchUrlPattern('**/checkout', '/shop/checkout')).toBe(true);
      expect(matchUrlPattern('**/checkout', '/shop/cart/checkout')).toBe(true);
    });

    it('handles **/segment/more patterns', () => {
      expect(matchUrlPattern('**/api/v1', '/api/v1')).toBe(true);
      expect(matchUrlPattern('**/api/v1', '/prefix/api/v1')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty path', () => {
      expect(matchUrlPattern('/', '')).toBe(false);
    });

    it('handles special regex characters in path', () => {
      expect(matchUrlPattern('/path.with.dots', '/path.with.dots')).toBe(true);
      expect(matchUrlPattern('/path?query', '/path?query')).toBe(true);
    });

    it('is case-sensitive', () => {
      expect(matchUrlPattern('/About', '/about')).toBe(false);
      expect(matchUrlPattern('/PRODUCT/*', '/product/123')).toBe(false);
    });

    it('handles invalid regex gracefully', () => {
      // Should not throw, just return false for malformed patterns
      expect(matchUrlPattern('[invalid', '/test')).toBe(false);
    });
  });

  describe('real-world examples', () => {
    it('product pages', () => {
      expect(matchUrlPattern('/product/*', '/product/iphone-15')).toBe(true);
      expect(matchUrlPattern('/product/*', '/product/123')).toBe(true);
      expect(matchUrlPattern('/product/*/reviews', '/product/iphone-15/reviews')).toBe(true);
    });

    it('checkout flow', () => {
      expect(matchUrlPattern('/checkout/**', '/checkout')).toBe(true);
      expect(matchUrlPattern('/checkout/**', '/checkout/shipping')).toBe(true);
      expect(matchUrlPattern('/checkout/**', '/checkout/payment')).toBe(true);
      expect(matchUrlPattern('/checkout/**', '/checkout/review/confirm')).toBe(true);
    });

    it('category pages', () => {
      expect(matchUrlPattern('/category/*', '/category/electronics')).toBe(true);
      expect(matchUrlPattern('/category/**', '/category/electronics/phones/android')).toBe(true);
    });

    it('thank you page', () => {
      expect(matchUrlPattern('/thank-you', '/thank-you')).toBe(true);
      expect(matchUrlPattern('/order/*/thank-you', '/order/12345/thank-you')).toBe(true);
    });
  });
});
