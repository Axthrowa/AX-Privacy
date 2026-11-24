import {
  AD_IFRAME_HINTS,
  AD_LINK_PARAMS,
  AD_WORD,
  AD_WORD_FALSE_POSITIVE,
  createDefaultModel,
  extractFeatures,
  FEATURE_COUNT,
  predict,
  rootDomain,
  sigmoid,
  type BrainModel,
  type FeatureContext,
} from './brain.ts';
import shipped from './mlp-weights.json' with { type: 'json' };

/**
 * AX-Brain layer 1, v5: 48 features scored by a small MLP (48 -> 32 -> 1) trained offline
 * (scripts/brain-train.ts). The first 12 features are the v4 ones; the user's own logistic model
 * still learns on those and shifts the MLP's verdict (the "personal head").
 */
export const RICH_FEATURE_NAMES = [
  // 0-11: the v4 features, see FEATURE_NAMES in brain.ts.
  'isFixedOrSticky',
  'highZIndex',
  'hasCrossSiteLink',
  'hasBlankTarget',
  'isIabSize',
  'hasGifOrWebp',
  'isEdgeOrCorner',
  'isTransparentCover',
  'hasBaitLanguage',
  'hasCloseNoForm',
  'hasAdTokens',
  'isLateInjected',
  // Geometry
  'relWidth', // 12: width / viewport width
  'relHeight', // 13: height / viewport height
  'aspect', // 14: log2(width / height) / 4, in [-1, 1]
  'areaFraction', // 15: share of the viewport covered
  'aboveFold', // 16: starts inside the first screen
  'isAbsolute', // 17: position absolute
  'nearTop', // 18: within 40px of the viewport top
  'nearBottom', // 19: within 40px of the viewport bottom
  'coversCenter', // 20: floating over the viewport centre
  // Links
  'linkCount', // 21: links / 10
  'crossLinkRatio', // 22: share of links leaving the site
  'trackingParam', // 23: click ids, affiliate or utm parameters
  'sponsoredRel', // 24: rel="sponsored" / "nofollow"
  // Content
  'iframeCount', // 25: iframes / 3
  'iframeCrossSite', // 26: an iframe from another site
  'iframeAdHint', // 27: an iframe from a known ad server
  'imageCount', // 28: images / 5
  'backgroundImage', // 29: inline background image
  // Text
  'textLength', // 30: text length / 200
  'linkTextDensity', // 31: share of the text inside links
  'sponsorWord', // 32: "Reklam", "Sponsorlu", "Advertisement", "Promoted"...
  'sponsorLabel', // 33: short text that is little more than such a word
  'textBag0', // 34-39: hashed bag of words, share of words per bucket
  'textBag1',
  'textBag2',
  'textBag3',
  'textBag4',
  'textBag5',
  // DOM
  'adAttribute', // 40: data-ad-*, data-google-query-id and similar attributes
  'ancestorAdToken', // 41: an ancestor up to 3 levels named like an ad slot
  'domDepth', // 42: depth / 30
  'childCount', // 43: children / 20
  'shadowDom', // 44: inside or hosting a shadow root
  'insTag', // 45: <ins> or an ad custom element
  // Behaviour
  'clickCover', // 46: large floating pointer-cursor layer
  'countdown', // 47: "5 sn", "skip in 5" style countdown text
] as const;

export const RICH_FEATURE_COUNT = RICH_FEATURE_NAMES.length;
const TEXT_BUCKETS = 6;

const SPONSOR_WORD =
  /\b(reklam|sponsorlu|sponsored|sponsor|advertisement|advert|promoted|anzeige|publicité|publicidad|pubblicità|ilan)\b/i;
const TRACKING_PARAM = /[?&](?:utm_[a-z]+|gclid|fbclid|msclkid|dclid|clickid|aff_?id|subid)=/i;
const COUNTDOWN = /\b\d{1,2}\s*(?:sn|saniye|sec|secs|seconds|s)\b|\bskip(?: ad)? in\b/i;
const AD_ATTRIBUTE = /^data-(?:ad|ads|adslot|ad-slot|ad-client|google-query-id|ad-unit)/i;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** FNV-1a, stable across runs and builds; only buckets leave this function. */
function bucket(word: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % TEXT_BUCKETS;
}

export interface RichContext extends FeatureContext {
  /** Read from the element's computed style when absent. */
  cursor?: string;
}

/** 48-element feature vector; see RICH_FEATURE_NAMES for the order. */
export function extractRichFeatures(el: Element, ctx: RichContext = {}): number[] {
  const style = ctx.computedStyle ?? getComputedStyle(el);
  const rect = ctx.rect ?? el.getBoundingClientRect();
  const f = extractFeatures(el, { ...ctx, computedStyle: style, rect });
  f.length = RICH_FEATURE_COUNT;
  f.fill(0, FEATURE_COUNT);
  const vw = ctx.viewport?.width ?? (globalThis.innerWidth || 1200);
  const vh = ctx.viewport?.height ?? (globalThis.innerHeight || 800);
  const w = rect.width || 0;
  const h = rect.height || 0;
  const floating = style.position === 'fixed' || style.position === 'absolute';

  f[12] = clamp01(w / vw);
  f[13] = clamp01(h / vh);
  f[14] = w > 0 && h > 0 ? Math.max(-1, Math.min(1, Math.log2(w / h) / 4)) : 0;
  f[15] = clamp01((w * h) / (vw * vh));
  f[16] = rect.top < vh ? 1 : 0;
  f[17] = style.position === 'absolute' ? 1 : 0;
  f[18] = rect.top <= 40 ? 1 : 0;
  f[19] = rect.bottom >= vh - 40 ? 1 : 0;
  f[20] =
    floating &&
    rect.left <= vw / 2 &&
    rect.right >= vw / 2 &&
    rect.top <= vh / 2 &&
    rect.bottom >= vh / 2
      ? 1
      : 0;

  const root = rootDomain(ctx.currentHost ?? '');
  const links = [...el.querySelectorAll<HTMLAnchorElement>('a[href]')];
  if (el.tagName === 'A' && el.hasAttribute('href')) links.push(el as HTMLAnchorElement);
  let cross = 0;
  let linkText = 0;
  for (const a of links) {
    const href = a.href || '';
    try {
      const target = rootDomain(new URL(href, 'http://localhost').hostname);
      if (root && target && target !== root) cross++;
    } catch {
      // Unparseable href: not evidence either way.
    }
    if (TRACKING_PARAM.test(href) || AD_LINK_PARAMS.test(href)) f[23] = 1;
    if (/\b(sponsored|nofollow)\b/i.test(a.rel || '')) f[24] = 1;
    linkText += (a.textContent ?? '').trim().length;
  }
  f[21] = clamp01(links.length / 10);
  f[22] = links.length ? cross / links.length : 0;

  const frames = [...el.querySelectorAll('iframe')];
  f[25] = clamp01(frames.length / 3);
  for (const fr of frames) {
    const src = (fr.getAttribute('src') ?? '').toLowerCase();
    if (!src) continue;
    try {
      const target = rootDomain(new URL(src, 'http://localhost').hostname);
      if (root && target && target !== 'localhost' && target !== root) f[26] = 1;
    } catch {
      // Unparseable src.
    }
    if (AD_IFRAME_HINTS.some((hint) => src.includes(hint))) f[27] = 1;
  }
  f[28] = clamp01(el.querySelectorAll('img').length / 5);
  const inline = el.getAttribute('style') ?? '';
  f[29] = /url\(/i.test(inline) || el.querySelector('[style*="url("]') ? 1 : 0;

  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  f[30] = clamp01(text.length / 200);
  f[31] = text.length ? clamp01(linkText / text.length) : 0;
  f[32] = SPONSOR_WORD.test(text) ? 1 : 0;
  f[33] = f[32] && text.length <= 40 ? 1 : 0;
  const words =
    text
      .toLowerCase()
      .match(/[\p{L}]{3,}/gu)
      ?.slice(0, 200) ?? [];
  for (const word of words) {
    const at = 34 + bucket(word);
    f[at] = (f[at] ?? 0) + 1 / words.length;
  }

  f[40] = [...el.attributes].some((a) => AD_ATTRIBUTE.test(a.name)) ? 1 : 0;
  let up = el.parentElement;
  for (let i = 0; up && i < 3; i++, up = up.parentElement) {
    const cls = typeof up.className === 'string' ? up.className : '';
    const tokens = `${up.id} ${cls}`.toLowerCase();
    if (AD_WORD.test(tokens) && !AD_WORD_FALSE_POSITIVE.test(tokens)) {
      f[41] = 1;
      break;
    }
  }
  let depth = 0;
  for (let p = el.parentElement; p; p = p.parentElement) depth++;
  f[42] = clamp01(depth / 30);
  f[43] = clamp01(el.children.length / 20);
  const inShadow = typeof ShadowRoot !== 'undefined' && el.getRootNode() instanceof ShadowRoot;
  f[44] = inShadow || (el as HTMLElement).shadowRoot ? 1 : 0;
  f[45] = el.tagName === 'INS' || /^(?:amp-ad|amp-embed|.*-ad)$/i.test(el.tagName) ? 1 : 0;

  const cursor = ctx.cursor ?? (style as Partial<CSSStyleDeclaration>).cursor ?? '';
  f[46] = floating && cursor === 'pointer' && f[15] >= 0.25 ? 1 : 0;
  f[47] = COUNTDOWN.test(text.slice(0, 200)) ? 1 : 0;
  return f;
}

export interface Mlp {
  /** 32 rows of 48 input weights. */
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
}

/** The shipped network, or null when the build carries no trained weights. */
export function parseMlp(value: unknown): Mlp | null {
  const m = value as Partial<Mlp> | null;
  const finite = (a: unknown, n: number) =>
    Array.isArray(a) && a.length === n && a.every((v) => Number.isFinite(v));
  if (
    !m ||
    !Array.isArray(m.w1) ||
    m.w1.length === 0 ||
    !m.w1.every((row) => finite(row, RICH_FEATURE_COUNT)) ||
    !finite(m.b1, m.w1.length) ||
    !finite(m.w2, m.w1.length) ||
    !Number.isFinite(m.b2)
  ) {
    return null;
  }
  return m as Mlp;
}

export const SHIPPED_MLP = parseMlp(shipped);

/** The network's log-odds for one vector (ReLU hidden layer). */
export function mlpLogit(f: readonly number[], m: Mlp): number {
  let z = m.b2;
  for (let j = 0; j < m.w1.length; j++) {
    const row = m.w1[j] ?? [];
    let a = m.b1[j] ?? 0;
    for (let i = 0; i < row.length; i++) a += (row[i] ?? 0) * (f[i] ?? 0);
    if (a > 0) z += (m.w2[j] ?? 0) * a;
  }
  return z;
}

const BASE = createDefaultModel();

/**
 * Ad probability for a 48-feature vector. With shipped weights: the MLP's log-odds, moved by how
 * far the user's corrections have moved their 12-feature model from the shipped one. Without
 * weights: the v4 logistic model alone.
 */
export function richProbability(
  f: readonly number[],
  personal: BrainModel,
  mlp: Mlp | null = SHIPPED_MLP,
): number {
  const own = predict(f.slice(0, FEATURE_COUNT), personal).rawScore;
  if (!mlp) return sigmoid(own);
  const shift = own - predict(f.slice(0, FEATURE_COUNT), BASE).rawScore;
  return sigmoid(mlpLogit(f, mlp) + shift);
}
