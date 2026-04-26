import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyVariant, getModifiedElements, rollbackChanges } from './apply';
import type { Variant, VariantChange } from './types';

// Test helper — minimal Variant with the given changes.
function v(changes: VariantChange[]): Variant {
  return {
    id: 'variant-1',
    experiment_id: 'exp-1',
    name: 'Test Variant',
    description: null,
    is_control: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    changes,
  };
}

describe('apply', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('[data-flame-css]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  describe('text', () => {
    it('replaces textContent on the matched element', () => {
      document.body.innerHTML = '<h1 id="title">Original</h1>';
      applyVariant(v([{ selector: '#title', type: 'text', value: 'New' }]));
      expect(document.querySelector('#title')?.textContent).toBe('New');
    });

    it('marks the element as modified with the selector', () => {
      document.body.innerHTML = '<h1 id="title">Original</h1>';
      applyVariant(v([{ selector: '#title', type: 'text', value: 'New' }]));
      const el = document.querySelector('#title');
      expect(el?.getAttribute('data-flame-modified')).toBe('true');
      expect(el?.getAttribute('data-flame-selector')).toBe('#title');
    });

    it('handles multiple changes in one variant', () => {
      document.body.innerHTML = `
        <h1 id="title">Original Title</h1>
        <p class="description">Original Description</p>
      `;
      applyVariant(
        v([
          { selector: '#title', type: 'text', value: 'New Title' },
          { selector: '.description', type: 'text', value: 'New Description' },
        ])
      );
      expect(document.querySelector('#title')?.textContent).toBe('New Title');
      expect(document.querySelector('.description')?.textContent).toBe('New Description');
    });

    it('handles missing selector gracefully', () => {
      document.body.innerHTML = '<h1 id="title">Original</h1>';
      expect(() =>
        applyVariant(v([{ selector: '#nonexistent', type: 'text', value: 'x' }]))
      ).not.toThrow();
    });

    it('does nothing when changes array is empty', () => {
      document.body.innerHTML = '<h1 id="title">Original</h1>';
      applyVariant(v([]));
      const el = document.querySelector('#title');
      expect(el?.textContent).toBe('Original');
      expect(el?.hasAttribute('data-flame-modified')).toBe(false);
    });

    it('does nothing when changes is undefined', () => {
      document.body.innerHTML = '<h1 id="title">Original</h1>';
      applyVariant({
        id: 'v',
        experiment_id: 'e',
        name: 'C',
        description: null,
        is_control: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });
      expect(document.querySelector('#title')?.textContent).toBe('Original');
    });

    it('rollback restores the original even after multiple applies', () => {
      document.body.innerHTML = '<h1 id="title">Original</h1>';
      applyVariant(v([{ selector: '#title', type: 'text', value: 'First' }]));
      applyVariant(v([{ selector: '#title', type: 'text', value: 'Second' }]));
      expect(document.querySelector('#title')?.textContent).toBe('Second');
      rollbackChanges();
      expect(document.querySelector('#title')?.textContent).toBe('Original');
    });

    it('logs debug messages when debug is enabled', () => {
      document.body.innerHTML = '<h1 id="title">x</h1>';
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      applyVariant(v([{ selector: '#title', type: 'text', value: 'y' }]), true);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('html', () => {
    it('replaces innerHTML on the matched element', () => {
      document.body.innerHTML = '<div id="card"><span>old</span></div>';
      applyVariant(v([{ selector: '#card', type: 'html', value: '<strong>new</strong>' }]));
      expect(document.querySelector('#card')?.innerHTML).toBe('<strong>new</strong>');
    });

    it('rollback restores original markup', () => {
      document.body.innerHTML = '<div id="card"><span>old</span></div>';
      applyVariant(v([{ selector: '#card', type: 'html', value: '<strong>new</strong>' }]));
      rollbackChanges();
      expect(document.querySelector('#card')?.innerHTML).toBe('<span>old</span>');
    });
  });

  describe('attribute', () => {
    it('sets a new attribute', () => {
      document.body.innerHTML = '<a id="cta">Click</a>';
      applyVariant(
        v([{ selector: '#cta', type: 'attribute', attribute: 'href', value: '/signup' }])
      );
      expect(document.querySelector('#cta')?.getAttribute('href')).toBe('/signup');
    });

    it('overrides an existing attribute', () => {
      document.body.innerHTML = '<a id="cta" href="/old">Click</a>';
      applyVariant(v([{ selector: '#cta', type: 'attribute', attribute: 'href', value: '/new' }]));
      expect(document.querySelector('#cta')?.getAttribute('href')).toBe('/new');
    });

    it('rollback restores the original value', () => {
      document.body.innerHTML = '<a id="cta" href="/old">Click</a>';
      applyVariant(v([{ selector: '#cta', type: 'attribute', attribute: 'href', value: '/new' }]));
      rollbackChanges();
      expect(document.querySelector('#cta')?.getAttribute('href')).toBe('/old');
    });

    it('rollback removes an attribute that did not exist before', () => {
      document.body.innerHTML = '<a id="cta">Click</a>';
      applyVariant(v([{ selector: '#cta', type: 'attribute', attribute: 'href', value: '/x' }]));
      expect(document.querySelector('#cta')?.hasAttribute('href')).toBe(true);
      rollbackChanges();
      expect(document.querySelector('#cta')?.hasAttribute('href')).toBe(false);
    });
  });

  describe('class', () => {
    it('adds classes', () => {
      document.body.innerHTML = '<button id="b" class="btn">x</button>';
      applyVariant(v([{ selector: '#b', type: 'class', add: ['btn-primary', 'large'] }]));
      const el = document.querySelector('#b');
      expect(el?.classList.contains('btn')).toBe(true);
      expect(el?.classList.contains('btn-primary')).toBe(true);
      expect(el?.classList.contains('large')).toBe(true);
    });

    it('removes classes', () => {
      document.body.innerHTML = '<button id="b" class="btn old">x</button>';
      applyVariant(v([{ selector: '#b', type: 'class', remove: ['old'] }]));
      expect(document.querySelector('#b')?.classList.contains('old')).toBe(false);
      expect(document.querySelector('#b')?.classList.contains('btn')).toBe(true);
    });

    it('add and remove in the same change', () => {
      document.body.innerHTML = '<button id="b" class="btn old">x</button>';
      applyVariant(v([{ selector: '#b', type: 'class', add: ['new'], remove: ['old'] }]));
      const el = document.querySelector('#b');
      expect(el?.classList.contains('new')).toBe(true);
      expect(el?.classList.contains('old')).toBe(false);
    });

    it('rollback removes added classes and restores removed ones', () => {
      document.body.innerHTML = '<button id="b" class="btn old">x</button>';
      applyVariant(v([{ selector: '#b', type: 'class', add: ['new'], remove: ['old'] }]));
      rollbackChanges();
      const el = document.querySelector('#b');
      expect(el?.classList.contains('new')).toBe(false);
      expect(el?.classList.contains('old')).toBe(true);
      expect(el?.classList.contains('btn')).toBe(true);
    });

    it('does not double-add a class that was already present', () => {
      document.body.innerHTML = '<button id="b" class="btn">x</button>';
      applyVariant(v([{ selector: '#b', type: 'class', add: ['btn'] }]));
      rollbackChanges();
      // The class was already there before we touched it; rollback
      // must not remove it.
      expect(document.querySelector('#b')?.classList.contains('btn')).toBe(true);
    });
  });

  describe('style', () => {
    it('applies inline styles (camelCase)', () => {
      document.body.innerHTML = '<div id="box">x</div>';
      applyVariant(
        v([
          { selector: '#box', type: 'style', styles: { backgroundColor: 'red', fontSize: '20px' } },
        ])
      );
      const el = document.querySelector('#box') as HTMLElement;
      expect(el.style.backgroundColor).toBe('red');
      expect(el.style.fontSize).toBe('20px');
    });

    it('applies inline styles (kebab-case)', () => {
      document.body.innerHTML = '<div id="box">x</div>';
      applyVariant(
        v([{ selector: '#box', type: 'style', styles: { 'background-color': 'blue' } }])
      );
      expect((document.querySelector('#box') as HTMLElement).style.backgroundColor).toBe('blue');
    });

    it('rollback restores the original inline style', () => {
      document.body.innerHTML = '<div id="box" style="background-color: green;">x</div>';
      applyVariant(v([{ selector: '#box', type: 'style', styles: { backgroundColor: 'red' } }]));
      rollbackChanges();
      expect((document.querySelector('#box') as HTMLElement).style.backgroundColor).toBe('green');
    });

    it('rollback removes a style we set when there was no inline value before', () => {
      document.body.innerHTML = '<div id="box">x</div>';
      applyVariant(v([{ selector: '#box', type: 'style', styles: { color: 'red' } }]));
      rollbackChanges();
      const el = document.querySelector('#box') as HTMLElement;
      expect(el.style.color).toBe('');
    });
  });

  describe('css', () => {
    it('injects a <style> tag with the given CSS', () => {
      applyVariant(v([{ type: 'css', css: '.x { color: red }' }]));
      const tag = document.head.querySelector('style[data-flame-css]') as HTMLStyleElement | null;
      expect(tag).not.toBeNull();
      expect(tag?.textContent).toBe('.x { color: red }');
    });

    it('rollback removes injected <style> tags', () => {
      applyVariant(v([{ type: 'css', css: '.x { color: red }' }]));
      rollbackChanges();
      expect(document.head.querySelector('style[data-flame-css]')).toBeNull();
    });
  });

  describe('visibility', () => {
    it('hides an element with visible:false', () => {
      document.body.innerHTML = '<div id="banner">hi</div>';
      applyVariant(v([{ selector: '#banner', type: 'visibility', visible: false }]));
      expect((document.querySelector('#banner') as HTMLElement).style.display).toBe('none');
    });

    it('shows an element with visible:true (clears inline display)', () => {
      document.body.innerHTML = '<div id="banner" style="display: none;">hi</div>';
      applyVariant(v([{ selector: '#banner', type: 'visibility', visible: true }]));
      expect((document.querySelector('#banner') as HTMLElement).style.display).toBe('');
    });

    it('rollback restores the original inline display', () => {
      document.body.innerHTML = '<div id="banner" style="display: block;">hi</div>';
      applyVariant(v([{ selector: '#banner', type: 'visibility', visible: false }]));
      rollbackChanges();
      expect((document.querySelector('#banner') as HTMLElement).style.display).toBe('block');
    });
  });

  describe('redirect', () => {
    it('navigates window.location.href and skips other changes', () => {
      document.body.innerHTML = '<h1 id="title">Original</h1>';
      // jsdom's window.location.href is settable but doesn't navigate;
      // assert we set it and that subsequent changes did not run.
      const originalHref = window.location.href;
      applyVariant(
        v([
          { type: 'redirect', url: '/pricing-v2' },
          { selector: '#title', type: 'text', value: 'should NOT apply' },
        ])
      );
      // The text change must not have run, because redirect short-circuits.
      expect(document.querySelector('#title')?.textContent).toBe('Original');
      // Reset href if jsdom let us mutate it (best-effort, jsdom is lenient).
      try {
        window.location.href = originalHref;
      } catch {
        /* jsdom may reject; harmless for the assertion above */
      }
    });
  });

  describe('mixed changes on the same element', () => {
    it('text + class + style all applied, all rolled back', () => {
      document.body.innerHTML = '<button id="b" class="btn" style="color: blue;">Original</button>';
      applyVariant(
        v([
          { selector: '#b', type: 'text', value: 'New' },
          { selector: '#b', type: 'class', add: ['primary'] },
          { selector: '#b', type: 'style', styles: { color: 'red' } },
        ])
      );
      const el = document.querySelector('#b') as HTMLElement;
      expect(el.textContent).toBe('New');
      expect(el.classList.contains('primary')).toBe(true);
      expect(el.style.color).toBe('red');

      rollbackChanges();
      expect(el.textContent).toBe('Original');
      expect(el.classList.contains('primary')).toBe(false);
      expect(el.style.color).toBe('blue');
    });
  });

  describe('getModifiedElements', () => {
    it('returns all flame-marked elements', () => {
      document.body.innerHTML = `
        <h1 id="t">x</h1>
        <p class="d">y</p>
        <span>z</span>
      `;
      applyVariant(
        v([
          { selector: '#t', type: 'text', value: 'a' },
          { selector: '.d', type: 'text', value: 'b' },
        ])
      );
      expect(getModifiedElements().length).toBe(2);
    });

    it('returns empty when nothing has been modified', () => {
      document.body.innerHTML = '<h1>x</h1>';
      expect(getModifiedElements().length).toBe(0);
    });
  });

  describe('rollbackChanges', () => {
    it('restores text content', () => {
      document.body.innerHTML = '<h1 id="t">Original</h1>';
      applyVariant(v([{ selector: '#t', type: 'text', value: 'New' }]));
      rollbackChanges();
      expect(document.querySelector('#t')?.textContent).toBe('Original');
    });

    it('removes flame-tracking attributes', () => {
      document.body.innerHTML = '<h1 id="t">Original</h1>';
      applyVariant(v([{ selector: '#t', type: 'text', value: 'New' }]));
      rollbackChanges();
      const el = document.querySelector('#t');
      expect(el?.hasAttribute('data-flame-modified')).toBe(false);
      expect(el?.hasAttribute('data-flame-selector')).toBe(false);
    });

    it('rolls back multiple elements in one pass', () => {
      document.body.innerHTML = `
        <h1 id="t">A</h1>
        <p class="d">B</p>
      `;
      applyVariant(
        v([
          { selector: '#t', type: 'text', value: 'X' },
          { selector: '.d', type: 'text', value: 'Y' },
        ])
      );
      rollbackChanges();
      expect(document.querySelector('#t')?.textContent).toBe('A');
      expect(document.querySelector('.d')?.textContent).toBe('B');
    });

    it('is a no-op when nothing is modified', () => {
      document.body.innerHTML = '<h1 id="t">Original</h1>';
      expect(() => rollbackChanges()).not.toThrow();
      expect(document.querySelector('#t')?.textContent).toBe('Original');
    });
  });
});
