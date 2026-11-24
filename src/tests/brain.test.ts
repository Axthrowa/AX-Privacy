import { describe, expect, it } from 'vitest';
import {
  createDefaultModel,
  extractFeatures,
  FEATURE_COUNT,
  IMMUNE_ROOTS,
  normalizeModel,
  MAX_DRIFT,
  parseModel,
  predict,
  rootDomain,
  train,
} from '../engines/brain/brain.ts';

const vec = (on: Record<number, number>) => {
  const f = new Array<number>(FEATURE_COUNT).fill(0);
  for (const [i, v] of Object.entries(on)) f[Number(i)] = v;
  return f;
};

function mockElement(opts: {
  id?: string;
  className?: string;
  text?: string;
  links?: { href: string; target?: string }[];
  attrs?: Record<string, string>;
}): Element {
  const links = (opts.links ?? []).map((l) => ({
    href: l.href,
    getAttribute: (n: string) => (n === 'target' ? (l.target ?? null) : null),
  }));
  return {
    id: opts.id ?? '',
    className: opts.className ?? '',
    textContent: opts.text ?? '',
    getAttribute: (n: string) => opts.attrs?.[n] ?? null,
    querySelectorAll: (sel: string) => (sel === 'a[href]' ? links : []),
    querySelector: () => null,
  } as unknown as Element;
}

const stickyBanner = {
  computedStyle: {
    position: 'fixed',
    zIndex: '9999',
    opacity: '1',
    backgroundColor: 'red',
  },
  rect: { width: 728, height: 90, top: 0, left: 200, right: 928, bottom: 90 },
  viewport: { width: 1200, height: 800 },
};

describe('AX-Brain model', () => {
  it('starts calibrated: threshold 0.65, negative bias, 12 weights', () => {
    const m = createDefaultModel();
    expect(m.weights).toHaveLength(12);
    expect(m.threshold).toBe(0.65);
    expect(m.bias).toBeLessThan(0);
    expect(predict(vec({}), m).probability).toBeLessThan(0.25);
  });

  it('catches the target ad shapes untrained and leaves benign shapes visible', () => {
    const m = createDefaultModel();
    const ads = {
      stickyGif: vec({ 0: 1, 2: 1, 5: 1 }),
      iabExternal: vec({ 2: 1, 4: 1 }),
      pageskin: vec({ 0: 1, 2: 1, 6: 1 }),
      loadingVignette: vec({ 0: 1, 1: 1, 8: 1 }),
      cornerVerify: vec({ 0: 1, 1: 0.5, 6: 1, 8: 1, 9: 1 }),
      curtain: vec({ 7: 1 }),
      adIframe: vec({ 2: 1, 4: 1, 10: 1 }),
    };
    for (const [name, f] of Object.entries(ads)) expect(predict(f, m).isAd, name).toBe(true);
    const benign = {
      stickyHeaderWithSocialLinks: vec({ 0: 1, 2: 1, 3: 1 }),
      plainIabSizedImage: vec({ 4: 1 }),
      loadingTextInArticle: vec({ 8: 1, 9: 1 }),
    };
    for (const [name, f] of Object.entries(benign)) expect(predict(f, m).isAd, name).toBe(false);
  });

  it('learns from a pick and unlearns on undo', () => {
    const f = vec({ 0: 1, 1: 0.5, 9: 1 });
    const m0 = createDefaultModel();
    const m1 = train(f, 1, m0, 0.25);
    const m2 = train(f, 0, m1, 0.35);
    expect(predict(f, m1).probability).toBeGreaterThan(predict(f, m0).probability);
    expect(predict(f, m2).probability).toBeLessThan(predict(f, m1).probability);
    expect(m1.sampleCount).toBe(1);
    expect(m0.sampleCount).toBe(0); // train never mutates its input
  });

  it('keeps weights and bias bounded under aggressive training', () => {
    let m = createDefaultModel();
    const all = new Array<number>(FEATURE_COUNT).fill(1);
    for (let i = 0; i < 200; i++) m = train(all, 1, m, 0.5);
    for (const w of m.weights) expect(Math.abs(w)).toBeLessThanOrEqual(4);
    expect(m.bias).toBeLessThanOrEqual(2);
    for (let i = 0; i < 200; i++) m = train(vec({}), 0, m, 0.5);
    expect(m.bias).toBeGreaterThanOrEqual(-5);
  });

  it('a zero bias is kept, not reset', () => {
    const m = { ...createDefaultModel(), bias: 0 };
    expect(train(vec({}), 1, m, 0).bias).toBe(0);
  });

  it('rejects malformed or old stored models', () => {
    expect(normalizeModel(null).weights).toEqual(createDefaultModel().weights);
    expect(normalizeModel({ version: 1, weights: [1], bias: 0 }).bias).toBe(-2);
    expect(normalizeModel({ ...createDefaultModel(), weights: new Array(12).fill(NaN) }).bias).toBe(
      -2,
    );
    const trained = train(vec({ 0: 1 }), 1, createDefaultModel());
    expect(normalizeModel(JSON.parse(JSON.stringify(trained))).weights).toEqual(trained.weights);
  });

  it('parses an imported model into the bounds training keeps', () => {
    expect(parseModel({ weights: [] })).toBeNull();
    const m = parseModel({
      ...createDefaultModel(),
      weights: new Array<number>(12).fill(-9),
      threshold: 0.1,
    });
    expect(m?.weights).toEqual(createDefaultModel().weights.map((w) => w - MAX_DRIFT));
    expect(m?.threshold).toBe(0.5);
  });

  it('personal training stays within MAX_DRIFT of the shipped model', () => {
    const base = createDefaultModel();
    let m = base;
    const all = new Array<number>(FEATURE_COUNT).fill(1);
    for (let i = 0; i < 500; i++) m = train(all, 0, m, 0.5);
    m.weights.forEach((w, i) =>
      expect(w).toBeGreaterThanOrEqual((base.weights[i] ?? 0) - MAX_DRIFT),
    );
    expect(m.bias).toBeGreaterThanOrEqual(base.bias - MAX_DRIFT);
    for (let i = 0; i < 500; i++) m = train(all, 1, m, 0.5);
    m.weights.forEach((w, i) => expect(w).toBeLessThanOrEqual((base.weights[i] ?? 0) + MAX_DRIFT));
  });

  it('1,000 predictions finish in under 15 ms', () => {
    const m = createDefaultModel();
    const f = vec({ 0: 1, 1: 0.5, 2: 1, 4: 1, 5: 1, 8: 1, 9: 1, 11: 1 });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) predict(f, m);
    expect(performance.now() - t0).toBeLessThan(15);
  });
});

describe('AX-Brain features', () => {
  it('detects a late-injected sticky IAB banner with an external blank link', () => {
    const el = mockElement({
      id: 'ad-slot-header',
      className: 'banner-container',
      text: 'Tap to continue / Reklam',
      links: [{ href: 'https://cross-site-tracker.com/click', target: '_blank' }],
      attrs: { 'data-ad': '12345' },
    });
    const f = extractFeatures(el, {
      ...stickyBanner,
      currentHost: 'www.my-publisher.com',
      isLateInjected: true,
    });
    expect(f).toEqual([1, 0.5, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1]);
  });

  it('same-site links and false-positive class tokens do not count', () => {
    const el = mockElement({
      className: 'ad-header upload',
      links: [{ href: 'https://news.example.co.uk/article' }],
    });
    const f = extractFeatures(el, { ...stickyBanner, currentHost: 'www.example.co.uk' });
    expect(f[2]).toBe(0);
    expect(f[10]).toBe(0);
  });

  it('flags ad click parameters even on the same site', () => {
    const el = mockElement({ links: [{ href: 'https://example.com/go?clickid=1' }] });
    expect(extractFeatures(el, { ...stickyBanner, currentHost: 'example.com' })[2]).toBe(1);
  });
});

describe('AX-Brain immunity', () => {
  it('covers YouTube, Twitch, Google, CDNs and auth/payment', () => {
    for (const d of [
      'youtube.com',
      'music.youtube.com',
      'googlevideo.com',
      'twitch.tv',
      'ttvnw.net',
      'google.com',
      'jsdelivr.net',
      'accounts.google.com',
      'paypal.com',
      'stripe.com',
    ]) {
      expect(IMMUNE_ROOTS.has(d), d).toBe(true);
    }
  });

  it('rootDomain uses the public suffix list', () => {
    expect(rootDomain('a.b.example.co.uk')).toBe('example.co.uk');
    expect(rootDomain('WWW.Example.com.tr')).toBe('example.com.tr');
    expect(rootDomain('')).toBe('');
  });
});
