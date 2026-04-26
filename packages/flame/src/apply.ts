import type {
  AttributeChange,
  ClassChange,
  CssChange,
  HtmlChange,
  RedirectChange,
  StyleChange,
  TextChange,
  Variant,
  VisibilityChange,
} from './types';

/**
 * Per-element rollback state captured the first time we mutate
 * something. WeakMap so detached elements get garbage-collected.
 *
 * `null` in `attributes` means the attribute didn't exist on the
 * element before we touched it (so rollback should `removeAttribute`).
 */
interface ElementRollback {
  text?: string;
  html?: string;
  attributes?: Record<string, string | null>;
  /** Classes we added; rollback removes them. */
  addedClasses?: string[];
  /** Classes we removed; rollback re-adds them. */
  removedClasses?: string[];
  /** Original inline-style values keyed by CSS property name. Empty string means the prop wasn't set. */
  styles?: Record<string, string>;
  /** Original inline `display` for visibility changes (separate from `styles` so a style+visibility combo doesn't clobber). */
  display?: string;
}

const rollbackState = new WeakMap<Element, ElementRollback>();
const insertedStyleTags: HTMLStyleElement[] = [];

function ensureRollback(el: Element): ElementRollback {
  let r = rollbackState.get(el);
  if (!r) {
    r = {};
    rollbackState.set(el, r);
  }
  return r;
}

function markModified(el: Element, selector: string): void {
  el.setAttribute('data-flame-modified', 'true');
  if (!el.hasAttribute('data-flame-selector')) {
    el.setAttribute('data-flame-selector', selector);
  }
}

/** Normalize camelCase or kebab-case to a CSS property name. */
function toCssProp(prop: string): string {
  if (prop.includes('-')) return prop;
  return prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

function applyTextChange(change: TextChange, debug: boolean): boolean {
  const el = document.querySelector(change.selector);
  if (!el) {
    if (debug) console.warn(`[Flame] Element not found for selector: ${change.selector}`);
    return false;
  }
  const r = ensureRollback(el);
  if (r.text === undefined) r.text = el.textContent ?? '';
  el.textContent = change.value;
  markModified(el, change.selector);
  if (debug) console.log(`[Flame] text change on ${change.selector}:`, change.value);
  return true;
}

function applyHtmlChange(change: HtmlChange, debug: boolean): boolean {
  const el = document.querySelector(change.selector);
  if (!el) {
    if (debug) console.warn(`[Flame] Element not found for selector: ${change.selector}`);
    return false;
  }
  const r = ensureRollback(el);
  if (r.html === undefined) r.html = el.innerHTML;
  el.innerHTML = change.value;
  markModified(el, change.selector);
  if (debug) console.log(`[Flame] html change on ${change.selector}`);
  return true;
}

function applyAttributeChange(change: AttributeChange, debug: boolean): boolean {
  const el = document.querySelector(change.selector);
  if (!el) {
    if (debug) console.warn(`[Flame] Element not found for selector: ${change.selector}`);
    return false;
  }
  const r = ensureRollback(el);
  r.attributes ??= {};
  if (!(change.attribute in r.attributes)) {
    r.attributes[change.attribute] = el.getAttribute(change.attribute);
  }
  el.setAttribute(change.attribute, change.value);
  markModified(el, change.selector);
  if (debug)
    console.log(
      `[Flame] attribute change on ${change.selector}: ${change.attribute}=${change.value}`
    );
  return true;
}

function applyClassChange(change: ClassChange, debug: boolean): boolean {
  const el = document.querySelector(change.selector);
  if (!el) {
    if (debug) console.warn(`[Flame] Element not found for selector: ${change.selector}`);
    return false;
  }
  const r = ensureRollback(el);
  r.addedClasses ??= [];
  r.removedClasses ??= [];
  for (const cls of change.add ?? []) {
    if (!el.classList.contains(cls)) {
      el.classList.add(cls);
      r.addedClasses.push(cls);
    }
  }
  for (const cls of change.remove ?? []) {
    if (el.classList.contains(cls)) {
      el.classList.remove(cls);
      r.removedClasses.push(cls);
    }
  }
  markModified(el, change.selector);
  if (debug)
    console.log(`[Flame] class change on ${change.selector}`, {
      add: change.add,
      remove: change.remove,
    });
  return true;
}

function applyStyleChange(change: StyleChange, debug: boolean): boolean {
  const el = document.querySelector(change.selector);
  if (!el || !(el instanceof HTMLElement)) {
    if (debug)
      console.warn(`[Flame] Element not found or not HTMLElement for selector: ${change.selector}`);
    return false;
  }
  const r = ensureRollback(el);
  r.styles ??= {};
  for (const [prop, value] of Object.entries(change.styles)) {
    const cssProp = toCssProp(prop);
    if (!(cssProp in r.styles)) {
      r.styles[cssProp] = el.style.getPropertyValue(cssProp);
    }
    el.style.setProperty(cssProp, value);
  }
  markModified(el, change.selector);
  if (debug) console.log(`[Flame] style change on ${change.selector}`, change.styles);
  return true;
}

function applyCssChange(change: CssChange, debug: boolean): boolean {
  const style = document.createElement('style');
  style.setAttribute('data-flame-css', 'true');
  style.textContent = change.css;
  document.head.appendChild(style);
  insertedStyleTags.push(style);
  if (debug) console.log('[Flame] css injected', { length: change.css.length });
  return true;
}

function applyVisibilityChange(change: VisibilityChange, debug: boolean): boolean {
  const el = document.querySelector(change.selector);
  if (!el || !(el instanceof HTMLElement)) {
    if (debug)
      console.warn(`[Flame] Element not found or not HTMLElement for selector: ${change.selector}`);
    return false;
  }
  const r = ensureRollback(el);
  if (r.display === undefined) r.display = el.style.display;
  el.style.display = change.visible ? '' : 'none';
  markModified(el, change.selector);
  if (debug)
    console.log(`[Flame] visibility change on ${change.selector}: visible=${change.visible}`);
  return true;
}

function applyRedirectChange(change: RedirectChange, debug: boolean): void {
  if (debug) console.log(`[Flame] redirect to ${change.url}`);
  // Run on a microtask so a synchronous test or caller can inspect
  // the call before the page actually navigates.
  if (typeof window !== 'undefined') {
    window.location.href = change.url;
  }
}

/**
 * Apply all changes for a variant to the DOM.
 *
 * Changes are applied in the order they appear in `variant.changes`.
 * If a `redirect` change is present, it fires immediately and the
 * remaining changes are skipped (the page is about to unload anyway).
 */
export function applyVariant(variant: Variant, debug = false): void {
  if (!variant.changes || variant.changes.length === 0) {
    if (debug) console.log(`[Flame] No changes to apply for variant: ${variant.name}`);
    return;
  }
  if (debug) console.log(`[Flame] Applying variant: ${variant.name}`);

  // If any change is a redirect, fire it first and short-circuit.
  // Other changes are pointless once we're navigating away.
  const redirect = variant.changes.find((c): c is RedirectChange => c.type === 'redirect');
  if (redirect) {
    applyRedirectChange(redirect, debug);
    return;
  }

  for (const change of variant.changes) {
    switch (change.type) {
      case 'text':
        applyTextChange(change, debug);
        break;
      case 'html':
        applyHtmlChange(change, debug);
        break;
      case 'attribute':
        applyAttributeChange(change, debug);
        break;
      case 'class':
        applyClassChange(change, debug);
        break;
      case 'style':
        applyStyleChange(change, debug);
        break;
      case 'css':
        applyCssChange(change, debug);
        break;
      case 'visibility':
        applyVisibilityChange(change, debug);
        break;
      case 'redirect':
        // Already handled above; here to satisfy exhaustiveness.
        break;
      default: {
        // Exhaustiveness check — TS will error if a VariantChange
        // case is added without a branch above.
        const _exhaustive: never = change;
        if (debug) console.warn('[Flame] Unknown change type:', _exhaustive);
      }
    }
  }
}

/** All elements currently flagged as flame-modified. */
export function getModifiedElements(): Element[] {
  return Array.from(document.querySelectorAll('[data-flame-modified="true"]'));
}

/**
 * Roll back every change applied via `applyVariant`.
 *
 * Restores text, HTML, attributes, classes, inline styles, and
 * visibility in one pass; removes any injected `<style>` tags.
 *
 * `redirect` changes are not reversible by definition — the page
 * has already navigated.
 */
export function rollbackChanges(): void {
  // Remove injected <style> tags.
  for (const tag of insertedStyleTags) {
    tag.remove();
  }
  insertedStyleTags.length = 0;

  const modified = getModifiedElements();
  for (const el of modified) {
    const r = rollbackState.get(el);
    if (r) {
      if (r.text !== undefined) el.textContent = r.text;
      if (r.html !== undefined) el.innerHTML = r.html;
      if (r.attributes) {
        for (const [attr, val] of Object.entries(r.attributes)) {
          if (val === null) el.removeAttribute(attr);
          else el.setAttribute(attr, val);
        }
      }
      if (r.addedClasses) {
        for (const cls of r.addedClasses) el.classList.remove(cls);
      }
      if (r.removedClasses) {
        for (const cls of r.removedClasses) el.classList.add(cls);
      }
      if (el instanceof HTMLElement) {
        if (r.styles) {
          for (const [prop, val] of Object.entries(r.styles)) {
            if (val) el.style.setProperty(prop, val);
            else el.style.removeProperty(prop);
          }
        }
        if (r.display !== undefined) el.style.display = r.display;
      }
      rollbackState.delete(el);
    }
    el.removeAttribute('data-flame-modified');
    el.removeAttribute('data-flame-selector');
  }
}
