import { describe, expect, it } from 'vitest';
import { patternToRegExp, realTarget, type LinkRule } from '../engines/core/link-clean.ts';
import { LINK_RULES } from '../filters/debounce-data.ts';

const RULES: LinkRule[] = [
  { include: ['*://track.example/go/*'], exclude: ['*://track.example/go/keep*'], param: 'url' },
  { include: ['*://*.b64.example/*'], exclude: [], param: 'to', base64: true },
];

describe('link cleaning', () => {
  it('reads the real target out of a tracking link', () => {
    expect(realTarget('https://track.example/go/1?url=https%3A%2F%2Fshop.example%2Fa', RULES)).toBe(
      'https://shop.example/a',
    );
    const encoded = btoa('https://shop.example/b');
    expect(realTarget(`https://x.b64.example/r?to=${encoded}`, RULES)).toBe(
      'https://shop.example/b',
    );
  });

  it('leaves everything else alone', () => {
    for (const href of [
      'https://track.example/other?url=https://shop.example/',
      'https://track.example/go/keep?url=https://shop.example/',
      'https://track.example/go/1',
      'https://track.example/go/1?url=/relative',
      'https://track.example/go/1?url=javascript:alert(1)',
      'https://track.example/go/1?url=data:text/html,x',
      'https://track.example/go/1?url=https://track.example/self',
      'not a url',
    ]) {
      expect(realTarget(href, RULES), href).toBeNull();
    }
  });

  it('matches subdomains only where the pattern asks', () => {
    expect(patternToRegExp('*://*.a.example/*').test('https://x.a.example/p')).toBe(true);
    expect(patternToRegExp('*://*.a.example/*').test('https://a.example/p')).toBe(true);
    expect(patternToRegExp('*://a.example/*').test('https://x.a.example/p')).toBe(false);
    expect(patternToRegExp('*://a.example/*').test('https://evila.example/p')).toBe(false);
  });

  it('knows the common redirects', () => {
    expect(realTarget('https://www.google.com/url?q=https://site.example/&sa=D', LINK_RULES)).toBe(
      'https://site.example/',
    );
    expect(
      realTarget('https://l.facebook.com/l.php?u=https%3A%2F%2Fsite.example%2F', LINK_RULES),
    ).toBe('https://site.example/');
  });
});
