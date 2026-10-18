/**
 * An experiment's `url_pattern` (flame#50) uses the goals' syntax. These cases
 * are ember's own (`goal_matching.rs`), so flame and ember agree on a page.
 */
import { describe, it, expect } from 'vitest';
import { matchesUrlPattern } from './url-pattern';

describe('matchesUrlPattern', () => {
  it('an exact path, ignoring a trailing slash', () => {
    expect(matchesUrlPattern('/about', '/about')).toBe(true);
    expect(matchesUrlPattern('/about', '/about/')).toBe(true);
    expect(matchesUrlPattern('/about', '/about/us')).toBe(false);
    expect(matchesUrlPattern('/pricing/', '/pricing')).toBe(true);
  });

  it('`*` is one segment', () => {
    expect(matchesUrlPattern('/product/*', '/product/123')).toBe(true);
    expect(matchesUrlPattern('/product/*', '/product/abc')).toBe(true);
    expect(matchesUrlPattern('/product/*', '/product/123/details')).toBe(false);
    expect(matchesUrlPattern('/product/*', '/product')).toBe(false);
  });

  it('a `/**` suffix is the prefix itself or anything beneath it', () => {
    expect(matchesUrlPattern('/checkout/**', '/checkout')).toBe(true);
    expect(matchesUrlPattern('/checkout/**', '/checkout/step1')).toBe(true);
    expect(matchesUrlPattern('/checkout/**', '/checkout/a/b/c')).toBe(true);
    expect(matchesUrlPattern('/checkout/**', '/checkoutx')).toBe(false);
    expect(matchesUrlPattern('/**', '/anything/at/all')).toBe(true);
  });

  it('a `**/` prefix is the suffix itself or anything ending in it', () => {
    expect(matchesUrlPattern('**/confirmation', '/confirmation')).toBe(true);
    expect(matchesUrlPattern('**/confirmation', '/checkout/confirmation')).toBe(true);
    expect(matchesUrlPattern('**/confirmation', '/a/b/confirmation')).toBe(true);
    expect(matchesUrlPattern('**/confirmation', '/preconfirmation')).toBe(false);
  });

  it('the root matches only the root', () => {
    expect(matchesUrlPattern('/', '/')).toBe(true);
    expect(matchesUrlPattern('/', '/about')).toBe(false);
  });

  it('regex metacharacters, and `*` in the literal half of a `**` form, are literals', () => {
    expect(matchesUrlPattern('/a.b+c', '/a.b+c')).toBe(true);
    expect(matchesUrlPattern('/a.b+c', '/axbbc')).toBe(false);
    expect(matchesUrlPattern('**/*.html', '/*.html')).toBe(true);
    expect(matchesUrlPattern('**/*.html', '/x/index.html')).toBe(false);
    expect(matchesUrlPattern('/a*b/**', '/a*b/c')).toBe(true);
    expect(matchesUrlPattern('/a*b/**', '/axxb/c')).toBe(false);
  });
});
