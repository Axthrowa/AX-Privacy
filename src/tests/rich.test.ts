import { describe, expect, it } from 'vitest';
import { createDefaultModel, FEATURE_COUNT, train } from '../engines/brain/brain.ts';
import {
  extractRichFeatures,
  mlpLogit,
  parseMlp,
  RICH_FEATURE_COUNT,
  RICH_FEATURE_NAMES,
  richProbability,
  SHIPPED_MLP,
  type Mlp,
} from '../engines/brain/rich.ts';
import shipped from '../engines/brain/mlp-weights.json' with { type: 'json' };

function el(text: string, attrs: Record<string, string> = {}, tag = 'DIV'): Element {
  return {
    tagName: tag,
    id: '',
    className: '',
    textContent: text,
    rel: '',
    getAttribute: (n: string) => attrs[n] ?? null,
    hasAttribute: (n: string) => n in attrs,
    attributes: Object.keys(attrs).map((name) => ({ name })),
    parentElement: null,
    children: [],
    shadowRoot: null,
    getRootNode: () => ({}),
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as Element;
}

const ctx = {
  currentHost: 'news.example',
  viewport: { width: 1000, height: 800 },
  computedStyle: { position: 'fixed', zIndex: '1', opacity: '1', backgroundColor: 'white' },
  rect: { left: 0, top: 760, width: 1000, height: 40, right: 1000, bottom: 800 },
  cursor: 'auto',
};

describe('AX-Brain 48 features', () => {
  it('names 48 features and fills every one with a finite number', () => {
    expect(RICH_FEATURE_NAMES).toHaveLength(48);
    const f = extractRichFeatures(el('Sponsorlu · 5 sn'), ctx);
    expect(f).toHaveLength(RICH_FEATURE_COUNT);
    expect(f.every(Number.isFinite)).toBe(true);
    expect(f[0]).toBe(1); // fixed
    expect(f[12]).toBe(1); // full width
    expect(f[19]).toBe(1); // at the bottom edge
    expect(f[32]).toBe(1); // sponsor word
    expect(f[33]).toBe(1); // short sponsor label
    expect(f[47]).toBe(1); // countdown
    expect(f.slice(34, 40).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('reads ad attributes and <ins> slots', () => {
    const f = extractRichFeatures(el('', { 'data-ad-slot': '1' }, 'INS'), ctx);
    expect(f[40]).toBe(1);
    expect(f[45]).toBe(1);
  });
});

describe('AX-Brain MLP', () => {
  const tiny: Mlp = {
    w1: [Array.from({ length: 48 }, (_, i) => (i === 32 ? 4 : 0))],
    b1: [0],
    w2: [1],
    b2: -2,
  };

  it('rejects weights of the wrong shape', () => {
    expect(parseMlp({})).toBeNull();
    expect(parseMlp({ ...tiny, w1: [[1, 2]] })).toBeNull();
    expect(parseMlp({ ...tiny, b2: Number.NaN })).toBeNull();
    expect(parseMlp(tiny)).toEqual(tiny);
  });

  it('scores with a ReLU hidden layer', () => {
    const f = new Array<number>(48).fill(0);
    expect(mlpLogit(f, tiny)).toBe(-2);
    f[32] = 1;
    expect(mlpLogit(f, tiny)).toBe(2);
  });

  it('lets the personal head move the shipped verdict', () => {
    const f = new Array<number>(48).fill(0);
    f[32] = 1;
    const base = richProbability(f, createDefaultModel(), tiny);
    expect(base).toBeCloseTo(1 / (1 + Math.exp(-2)));
    let personal = createDefaultModel();
    const not = new Array<number>(FEATURE_COUNT).fill(0);
    for (let i = 0; i < 20; i++) personal = train(not, 0, personal, 0.5);
    expect(richProbability(f, personal, tiny)).toBeLessThan(base);
    // No shipped weights: the v4 logistic model alone.
    expect(richProbability(f, createDefaultModel(), null)).toBeCloseTo(1 / (1 + Math.exp(2)));
  });
});

describe('shipped AX-Brain weights', () => {
  it('load and passed the quality gate on held-out sites', () => {
    expect(SHIPPED_MLP?.w1).toHaveLength(32);
    const { gate } = shipped as {
      gate: {
        precision: number;
        falseHide: number;
        test: { precision: number; falseHide: number; ads: number };
      };
    };
    expect(gate.test.precision).toBeGreaterThanOrEqual(gate.precision);
    expect(gate.test.falseHide).toBeLessThanOrEqual(gate.falseHide);
    expect(gate.precision).toBe(0.98);
    expect(gate.falseHide).toBe(0.005);
    expect(gate.test.ads).toBeGreaterThan(100);
  });
});
