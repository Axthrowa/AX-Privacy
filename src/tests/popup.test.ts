import { describe, expect, it } from 'vitest';
import { compileList } from '../engines/adblock/network.ts';
import { createPopupMatcher, urlFilterToRegExp } from '../engines/popup/matcher.ts';

const matcher = (...lines: string[]) =>
  createPopupMatcher(compileList(lines, { allowRegex: true }).popupRules);

describe('urlFilterToRegExp', () => {
  it('implements DNR anchors, wildcards and separators', () => {
    const re = urlFilterToRegExp('||ads.example^');
    expect(re.test('https://ads.example/x')).toBe(true);
    expect(re.test('https://sub.ads.example:8080/')).toBe(true);
    expect(re.test('https://ads.example')).toBe(true);
    expect(re.test('https://badads.example/')).toBe(false);
    expect(re.test('https://ads.example.org/')).toBe(false);
    expect(urlFilterToRegExp('|https://a.b/*/go|').test('https://a.b/x/go')).toBe(true);
    expect(urlFilterToRegExp('|https://a.b/*/go|').test('https://a.b/x/go?q')).toBe(false);
    expect(urlFilterToRegExp('/pop.php?id=').test('https://x.y/pop.php?id=3')).toBe(true);
    expect(urlFilterToRegExp('/AD/', true).test('https://x.y/ad/')).toBe(false);
  });
});

describe('createPopupMatcher', () => {
  it('blocks matching popups by URL, opener domain and party', () => {
    const m = matcher(
      '||popads.example^$popup',
      '/landing.php$popup,domain=stream.example',
      '||self.example^$popup,third-party',
    );
    expect(m('https://popads.example/c?x=1', 'https://news.example/')).toBe(true);
    expect(m('https://shop.example/landing.php', 'https://stream.example/watch')).toBe(true);
    expect(m('https://shop.example/landing.php', 'https://other.example/')).toBe(false);
    expect(m('https://self.example/', 'https://www.self.example/')).toBe(false);
    expect(m('https://self.example/', 'https://other.example/')).toBe(true);
    expect(m('https://news.example/article', 'https://news.example/')).toBe(false);
  });

  it('lets exceptions win at equal priority and $important beat exceptions', () => {
    expect(
      matcher('||popads.example^$popup', '@@||popads.example/ok^$popup')(
        'https://popads.example/ok/1',
        'https://a.example/',
      ),
    ).toBe(false);
    expect(
      matcher('||popads.example^$popup,important', '@@||popads.example/ok^$popup')(
        'https://popads.example/ok/1',
        'https://a.example/',
      ),
    ).toBe(true);
  });

  it('ignores non-web URLs and invalid regexes', () => {
    const m = createPopupMatcher([
      { priority: 1, action: { type: 'block' }, condition: { regexFilter: '(' } },
      { priority: 1, action: { type: 'block' }, condition: { urlFilter: 'ads' } },
    ]);
    expect(m('about:blank', 'https://a.example/')).toBe(false);
    expect(m('https://ads.example/', 'chrome://newtab/')).toBe(false);
    expect(m('https://ads.example/', 'https://a.example/')).toBe(true);
  });
});
