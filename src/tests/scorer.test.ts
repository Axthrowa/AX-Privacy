import { describe, expect, it } from 'vitest';
import { createDefaultModel, train, FEATURE_COUNT } from '../engines/brain/brain.ts';
import { isSafePlatform, scoreElement, type ScoreContext } from '../engines/brain/scorer.ts';

interface MockOpts {
  tag?: string;
  id?: string;
  className?: string;
  text?: string;
  links?: string[];
  /** querySelector(sel) finds something when sel contains one of these. */
  contains?: string[];
  /** closest(sel) finds something when sel contains one of these. */
  inside?: string[];
  inputs?: number;
  attrs?: Record<string, string>;
}

function el(o: MockOpts): Element {
  const links = (o.links ?? []).map((href) => ({ href, getAttribute: () => null }));
  return {
    tagName: (o.tag ?? 'div').toUpperCase(),
    id: o.id ?? '',
    className: o.className ?? '',
    textContent: o.text ?? '',
    getAttribute: (n: string) => o.attrs?.[n] ?? null,
    closest: (sel: string) => ((o.inside ?? []).some((k) => sel.includes(k)) ? {} : null),
    querySelector: (sel: string) =>
      (o.contains ?? []).some((k) => sel.includes(k))
        ? { getAttribute: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }) }
        : null,
    querySelectorAll: (sel: string) =>
      sel === 'a[href]' ? links : new Array(sel.includes('input') ? (o.inputs ?? 0) : 0),
  } as unknown as Element;
}

const style = (s: Partial<CSSStyleDeclaration>) =>
  ({ position: 'static', zIndex: 'auto', opacity: '1', backgroundColor: 'white', ...s }) as Pick<
    CSSStyleDeclaration,
    'position' | 'zIndex' | 'opacity' | 'backgroundColor'
  >;
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const base = (extra: Partial<ScoreContext> = {}): ScoreContext => ({
  currentHost: 'news.example.com',
  model: null,
  viewport: { width: 1200, height: 800 },
  computedStyle: style({}),
  rect: rect(100, 100, 600, 400),
  ...extra,
});

describe('scoreElement: ads are hidden', () => {
  it('fixed GIF banner with an external destination', () => {
    const r = scoreElement(
      el({ contains: ['img[src*=".gif"]'], links: ['https://ads.other.net/x'] }),
      base({ computedStyle: style({ position: 'fixed' }), rect: rect(0, 700, 500, 80) }),
    );
    expect(r.shouldHide).toBe(true);
  });

  it('IAB 728x90 with a cross-site link', () => {
    const r = scoreElement(
      el({ links: ['https://tracker.net/c'] }),
      base({ rect: rect(200, 0, 728, 90) }),
    );
    expect(r.reasons).toContain('iab-dimension');
    expect(r.shouldHide).toBe(true);
  });

  it('pageskin: narrow, tall, stuck to the edge', () => {
    const r = scoreElement(
      el({ contains: ['img[src*=".gif"]'], links: ['https://casino.net/?aff=1'] }),
      base({ computedStyle: style({ position: 'absolute' }), rect: rect(0, 0, 200, 900) }),
    );
    expect(r.shouldHide).toBe(true);
  });

  it('invisible click curtain', () => {
    const r = scoreElement(
      el({}),
      base({
        computedStyle: style({ position: 'fixed', zIndex: '9999', backgroundColor: 'transparent' }),
        rect: rect(0, 0, 1200, 800),
      }),
    );
    expect(r.reasons).toContain('invisible-click-curtain');
    expect(r.shouldHide).toBe(true);
  });

  it('fake "%87 Yükleniyor... dokunun" vignette', () => {
    const r = scoreElement(
      el({ text: '%87 Yükleniyor... Devam etmek için dokunun', contains: ['button'] }),
      base({ computedStyle: style({ position: 'fixed', zIndex: '99999' }) }),
    );
    expect(r.shouldHide).toBe(true);
  });

  it('corner push card ("Ben robot değilim / Bildirimlere izin ver")', () => {
    const r = scoreElement(
      el({ text: 'Ben robot değilim. Bildirimlere izin ver', links: ['https://push.net/a'] }),
      base({
        computedStyle: style({ position: 'fixed', zIndex: '2000' }),
        rect: rect(860, 20, 320, 120),
      }),
    );
    expect(r.shouldHide).toBe(true);
  });

  it('AX-Brain lifts a learned shape over the line on its own', () => {
    const subject = el({});
    const ctx = base({ computedStyle: style({ position: 'sticky' }), rect: rect(0, 0, 300, 50) });
    expect(scoreElement(subject, ctx).shouldHide).toBe(false);
    let model = createDefaultModel();
    const f = new Array<number>(FEATURE_COUNT).fill(0);
    f[0] = 1;
    for (let i = 0; i < 40; i++) model = train(f, 1, model, 0.5);
    const r = scoreElement(subject, { ...ctx, model });
    expect(r.reasons).toContain('ax-brain-model');
    expect(r.shouldHide).toBe(true);
  });
});

describe('scoreElement: real content is never hidden', () => {
  const fixedAd = base({
    computedStyle: style({ position: 'fixed', zIndex: '99999' }),
    rect: rect(200, 0, 728, 90),
  });
  const cases: [string, MockOpts][] = [
    ['login modal', { contains: ['input[type="password"]'], text: 'Verify your account' }],
    ['video player', { contains: ['video'], links: ['https://cdn.net/v'] }],
    ['form', { inputs: 3 }],
    ['nav tag', { tag: 'nav' }],
    ['article tag', { tag: 'article' }],
    ['long article', { text: 'x'.repeat(500), links: ['https://other.net'] }],
    ['upload button class', { className: 'upload-button ad-box' }],
    ['download badge class', { className: 'download-badge' }],
    ['YouTube guide', { inside: ['ytd-guide-renderer'] }],
    ['inside a player', { inside: ['[class*="player"]'] }],
    ['picker UI', { inside: ['nexus-picker'] }],
  ];
  for (const [name, opts] of cases) {
    it(name, () => {
      const r = scoreElement(el({ links: ['https://tracker.net/c'], ...opts }), fixedAd);
      expect(r.shouldHide).toBe(false);
    });
  }

  it('a plain sticky header with its own links stays', () => {
    const r = scoreElement(
      el({ links: ['https://news.example.com/sport', 'https://www.example.com/'] }),
      base({ computedStyle: style({ position: 'sticky' }), rect: rect(0, 0, 1200, 60) }),
    );
    expect(r.shouldHide).toBe(false);
  });
});

describe('isSafePlatform', () => {
  it('matches big platforms and their subdomains only', () => {
    expect(isSafePlatform('www.youtube.com')).toBe(true);
    expect(isSafePlatform('x.com')).toBe(true);
    expect(isSafePlatform('notx.com')).toBe(false);
    expect(isSafePlatform('news.example.com')).toBe(false);
  });
});
