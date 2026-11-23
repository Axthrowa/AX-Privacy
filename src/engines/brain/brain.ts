import { parse } from 'tldts';

/**
 * AX-Brain: a 100% local, dependency-free logistic model that scores DOM candidates as ads.
 * Ported from the v4 JS line; model shape, calibration and feature order are unchanged so
 * models already stored by v4.x keep working.
 */

export const FEATURE_NAMES = [
  'isFixedOrSticky', // 0: position fixed or sticky
  'highZIndex', // 1: z-index >= 999 (0.5) or >= 99999 (1.0)
  'hasCrossSiteLink', // 2: cross-site destination or ad click parameters
  'hasBlankTarget', // 3: target="_blank"
  'isIabSize', // 4: standard IAB ad dimensions (+-8px)
  'hasGifOrWebp', // 5: animated .gif or external .webp
  'isEdgeOrCorner', // 6: pageskin geometry or screen edge/corner widget
  'isTransparentCover', // 7: large transparent click curtain
  'hasBaitLanguage', // 8: fake verify, loading, progress or allow bait words
  'hasCloseNoForm', // 9: close control without a real form or password input
  'hasAdTokens', // 10: class/id/data matching ad patterns
  'isLateInjected', // 11: injected after the user interacted
] as const;

export const FEATURE_COUNT = FEATURE_NAMES.length;

/** Roots the brain never learns or promotes to network blocks. */
export const IMMUNE_ROOTS: ReadonlySet<string> = new Set([
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'googlevideo.com',
  'ytimg.com',
  'ggpht.com',
  'youtubei.googleapis.com',
  'twitch.tv',
  'ttvnw.net',
  'jtvnw.net',
  'github.com',
  'githubusercontent.com',
  'cloudflare.com',
  'jsdelivr.net',
  'unpkg.com',
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'discord.com',
  'stripe.com',
  'paypal.com',
  'iyzico.com',
  'paytr.com',
]);

const IAB_DIMENSIONS: readonly (readonly [number, number])[] = [
  [728, 90],
  [970, 90],
  [970, 250],
  [300, 250],
  [300, 600],
  [160, 600],
  [120, 600],
  [468, 60],
  [320, 50],
  [320, 100],
];

export const AD_IFRAME_HINTS = [
  'doubleclick',
  'googlesyndication',
  'adservice',
  'popads',
  'propeller',
  'exoclick',
  'adsterra',
  'monetag',
];

export const BAIT_WORDS = [
  'robot',
  'doğrula',
  'devam et',
  'dokun',
  'yükleniyor',
  'bildirim',
  'izin ver',
  'verify',
  'continue',
  'tap to',
  'loading',
  'allow',
  'update',
  'tıkla',
  'tamam',
];

export const AD_WORD =
  /\b(reklam|ad-?(slot|box|banner|container|wrap|wrapper|zone|space|placement)?|banner-ad|sponsor-ad|pageskin|popunder|vignette|interstitial|adsbox|adslot)\b/i;
export const AD_WORD_FALSE_POSITIVE =
  /\b(upload|download|header|loading|shadow|radio|badge|avatar)\b/i;
export const AD_LINK_PARAMS = /[?&](?:ref|aff|clickid|bannerid|ad_id|out|goto)=/i;
export const AD_LINK_PATHS = /\/(?:afu\.php|click\/)/i;

/** Standard IAB ad slot size, within 8px. */
export function isIabSize(w: number, h: number): boolean {
  return (
    w > 0 &&
    h > 0 &&
    IAB_DIMENSIONS.some(([iw, ih]) => Math.abs(w - iw) <= 8 && Math.abs(h - ih) <= 8)
  );
}

export interface BrainModel {
  version: number;
  weights: number[];
  bias: number;
  threshold: number;
  learningRate: number;
  sampleCount: number;
  lastUpdated: number;
}

export interface Prediction {
  probability: number;
  isAd: boolean;
  rawScore: number;
}

/** Registrable domain (eTLD+1) of a hostname, the hostname itself when it has none. */
export function rootDomain(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  if (!host) return '';
  return parse(host, { allowPrivateDomains: true }).domain ?? host;
}

export function createDefaultModel(): BrainModel {
  return {
    version: 2,
    // Untrained calibration: catches sticky GIF banners, IAB banners with external links,
    // pageskins, fake loading/verify cards and transparent curtains, while a lone sticky
    // header or a plain IAB-sized image stays below the 0.65 threshold.
    weights: [1.0, 0.8, 1.2, 0.3, 1.6, 1.4, 1.4, 3.0, 1.8, 0.6, 1.8, 0.6],
    bias: -2.0,
    threshold: 0.65,
    learningRate: 0.12,
    sampleCount: 0,
    lastUpdated: Date.now(),
  };
}

/** Accepts a stored model only when its shape matches; anything else falls back to the default. */
export function normalizeModel(value: unknown): BrainModel {
  const fallback = createDefaultModel();
  if (!value || typeof value !== 'object') return fallback;
  const m = value as Partial<BrainModel>;
  if (
    (m.version ?? 0) < fallback.version ||
    !Array.isArray(m.weights) ||
    m.weights.length !== FEATURE_COUNT ||
    !m.weights.every(Number.isFinite) ||
    !Number.isFinite(m.bias)
  ) {
    return fallback;
  }
  return {
    version: fallback.version,
    weights: [...m.weights],
    bias: m.bias as number,
    threshold: Number.isFinite(m.threshold) ? (m.threshold as number) : fallback.threshold,
    learningRate: Number.isFinite(m.learningRate)
      ? (m.learningRate as number)
      : fallback.learningRate,
    sampleCount: Number.isFinite(m.sampleCount) ? (m.sampleCount as number) : 0,
    lastUpdated: Number.isFinite(m.lastUpdated) ? (m.lastUpdated as number) : Date.now(),
  };
}

export function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function predict(features: readonly number[], model: BrainModel): Prediction {
  let z = model.bias;
  const len = Math.min(features.length, model.weights.length);
  for (let i = 0; i < len; i++) z += (model.weights[i] ?? 0) * (features[i] ?? 0);
  const probability = sigmoid(z);
  return { probability, isAd: probability >= model.threshold, rawScore: z };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * One online SGD step. Weights stay in [-4, 4] and bias in [-5, 2] so a burst of
 * clicks cannot push the model into blocking everything.
 */
export function train(
  features: readonly number[],
  label: 0 | 1,
  model: BrainModel,
  learningRate = model.learningRate,
): BrainModel {
  const error = label - predict(features, model).probability;
  const weights = model.weights.map((w, i) => {
    const next = w + learningRate * error * (features[i] ?? 0);
    return Number.isFinite(next) ? clamp(next, -4, 4) : 0;
  });
  const bias = model.bias + learningRate * error;
  return {
    ...model,
    weights,
    bias: Number.isFinite(bias) ? clamp(bias, -5, 2) : -2,
    sampleCount: model.sampleCount + 1,
    lastUpdated: Date.now(),
  };
}

export interface FeatureContext {
  currentHost?: string;
  computedStyle?: Pick<CSSStyleDeclaration, 'position' | 'zIndex' | 'opacity' | 'backgroundColor'>;
  rect?: Pick<DOMRect, 'width' | 'height' | 'top' | 'left' | 'right' | 'bottom'>;
  viewport?: { width: number; height: number };
  isLateInjected?: boolean;
}

/** 12-element feature vector for a DOM candidate; see FEATURE_NAMES for the order. */
export function extractFeatures(el: Element, context: FeatureContext = {}): number[] {
  const f: number[] = new Array<number>(FEATURE_COUNT).fill(0);
  const currentRoot = rootDomain(context.currentHost ?? '');
  const style = context.computedStyle ?? getComputedStyle(el);
  const pos = style.position;
  const isFixed = pos === 'fixed';
  const floating = isFixed || pos === 'absolute';

  if (isFixed || pos === 'sticky') f[0] = 1;

  const z = parseInt(style.zIndex || '0', 10) || 0;
  if (z >= 99999) f[1] = 1;
  else if (z >= 999) f[1] = 0.5;

  const rect = context.rect ?? el.getBoundingClientRect();
  const w = rect.width || 0;
  const h = rect.height || 0;

  let hasBlank = false;
  let hasCross = false;
  for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (a.getAttribute('target') === '_blank') hasBlank = true;
    const href = a.href || '';
    try {
      const u = new URL(href, 'http://localhost');
      if (u.protocol.startsWith('http')) {
        const target = rootDomain(u.hostname);
        if (currentRoot && target && currentRoot !== target) hasCross = true;
        if (AD_LINK_PARAMS.test(href) || AD_LINK_PATHS.test(href)) hasCross = true;
      }
    } catch {
      // Unparseable href: not evidence either way.
    }
    if (hasBlank && hasCross) break;
  }
  if (!hasCross) {
    const src = el.querySelector('iframe')?.getAttribute('src')?.toLowerCase() ?? '';
    if (src && AD_IFRAME_HINTS.some((hint) => src.includes(hint))) hasCross = true;
  }
  if (hasCross) f[2] = 1;
  if (hasBlank) f[3] = 1;

  if (isIabSize(w, h)) f[4] = 1;

  if (el.querySelector('img[src*=".gif"], img[src*=".webp"], [style*=".gif"], [style*=".webp"]')) {
    f[5] = 1;
  }

  const vw = context.viewport?.width ?? (globalThis.innerWidth || 1200);
  const vh = context.viewport?.height ?? (globalThis.innerHeight || 800);
  const atSideEdge = rect.left <= 30 || rect.right >= vw - 30;
  const pageskin = floating && w > 0 && w <= 280 && h >= 380 && atSideEdge;
  const cornerPush =
    floating &&
    z >= 999 &&
    w > 0 &&
    w <= 420 &&
    h > 0 &&
    h <= 260 &&
    (rect.top <= 40 || rect.bottom >= vh - 40) &&
    (rect.left <= 40 || rect.right >= vw - 40);
  if (pageskin || cornerPush) f[6] = 1;

  const text = (el.textContent ?? '').trim();
  const opacity = parseFloat(style.opacity || '1');
  const transparent =
    opacity < 0.15 ||
    style.backgroundColor === 'transparent' ||
    style.backgroundColor === 'rgba(0, 0, 0, 0)';
  if (floating && z >= 999 && w >= 250 && h >= 150 && text.length < 10 && transparent) f[7] = 1;

  const lower = text.toLowerCase();
  if (
    BAIT_WORDS.some((b) => lower.includes(b)) ||
    /\d{1,3}\s*%/.test(lower) ||
    /\b(ok|okay)\b/.test(lower)
  ) {
    f[8] = 1;
  }

  const hasClose = el.querySelector(
    '[class*="close" i], [id*="close" i], [aria-label*="close" i], button',
  );
  const hasForm = el.querySelector('form, input[type="password"], input[type="email"]');
  if (hasClose && !hasForm) f[9] = 1;

  const className = typeof el.className === 'string' ? el.className : '';
  const tokens = `${el.id} ${className} ${el.getAttribute('data-ad') ?? ''}`.toLowerCase();
  if (AD_WORD.test(tokens) && (!AD_WORD_FALSE_POSITIVE.test(tokens) || AD_WORD.test(el.id))) {
    f[10] = 1;
  }

  if (context.isLateInjected) f[11] = 1;
  return f;
}
