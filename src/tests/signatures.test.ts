import { describe, expect, it } from 'vitest';
import { isPageRedirect, isPopunderUrl } from '../engines/popup/signatures.ts';

describe('isPopunderUrl', () => {
  it('flags ad-network landing and click URLs', () => {
    for (const url of [
      'https://cdn.example.net/afu.php?zoneid=1',
      'https://x.example/ntfc.php',
      'https://go.example/in-page-push/abc',
      'https://track.example/?zone_id=5&click_id=9',
      'https://offers.example/c?sub_id=1&offer_id=2',
      'https://a.popads.net/x',
    ]) {
      expect(isPopunderUrl(url), url).toBe(true);
    }
  });

  it('leaves ordinary pages alone', () => {
    for (const url of [
      'https://www.google.com/search?q=popunders+explained',
      'https://news.example.com/article?id=5',
      'https://shop.example/?zone_id=5',
      'https://github.com/',
    ]) {
      expect(isPopunderUrl(url), url).toBe(false);
    }
  });
});

describe('isPageRedirect', () => {
  it('is true only for script/meta redirects, never for user navigation', () => {
    expect(
      isPageRedirect({ transitionType: 'link', transitionQualifiers: ['client_redirect'] }),
    ).toBe(true);
    expect(isPageRedirect({ transitionType: 'link', transitionQualifiers: [] })).toBe(false);
    expect(isPageRedirect({ transitionType: 'auto_bookmark', transitionQualifiers: [] })).toBe(
      false,
    );
    expect(
      isPageRedirect({ transitionType: 'typed', transitionQualifiers: ['client_redirect'] }),
    ).toBe(false);
    expect(
      isPageRedirect({
        transitionType: 'link',
        transitionQualifiers: ['client_redirect', 'forward_back'],
      }),
    ).toBe(false);
    expect(
      isPageRedirect({ transitionType: 'reload', transitionQualifiers: ['client_redirect'] }),
    ).toBe(false);
  });
});
