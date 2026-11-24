import {
  AD_IFRAME_HINTS,
  AD_LINK_PARAMS,
  AD_LINK_PATHS,
  AD_WORD,
  AD_WORD_FALSE_POSITIVE,
  BAIT_WORDS,
  isIabSize,
  rootDomain,
  type BrainModel,
  type FeatureContext,
} from './brain.ts';
import { extractRichFeatures, richProbability, SHIPPED_MLP, type Mlp } from './rich.ts';

/**
 * Universal ad/overlay scorer (ported from the v4 JS line). Hand-written signals add up to a
 * score; AX-Brain can lift a candidate to the hide line on its own. Score >= 5 hides.
 */

export const HIDE_SCORE = 5;
/** The plan's bar for a hide decided by the model alone. */
export const MODEL_HIDE_PROBABILITY = 0.85;

/** Elements worth scoring; everything else is skipped before any style is read. */
export const CANDIDATE_SELECTOR =
  'div, section, aside, span, a, ins, [id*="overlay"], [class*="overlay"], [id*="banner"], [class*="banner"], [id*="reklam"], [class*="reklam"], [data-ad], [data-adslot]';

export const SKIP_TAGS: ReadonlySet<string> = new Set([
  'SCRIPT',
  'STYLE',
  'SVG',
  'HEAD',
  'META',
  'LINK',
  'BR',
  'HR',
  'NOSCRIPT',
  'HTML',
  'BODY',
  'MAIN',
  'NAV',
  'HEADER',
  'FOOTER',
  'ARTICLE',
  'FORM',
]);

/** YouTube's navigation drawer and this extension's own UI are never scored. */
export const NEVER_TOUCH_SELECTOR =
  'ytd-guide-renderer, tp-yt-app-drawer, #guide, #sections, ytd-mini-guide-renderer, nexus-picker';

const PLAYER_SELECTOR =
  'video, audio, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="vjs-"], [class*="jw-"]';
const PLATFORM_UI_SELECTOR =
  'ytd-app, ytd-masthead, #player, #movie_player, .video-player, [data-a-target="player-overlay-click-handler"], tp-yt-app-drawer, #guide';
const STRUCTURAL_TAGS = new Set(['html', 'body', 'main', 'article', 'header', 'nav', 'footer']);
const PROTECTED_CLASS = /\b(upload|download|header|loading|shadow|radio|badge)\b/i;

/** Big platforms ship their own UI conventions; heuristics there cause more harm than good. */
const SAFE_PLATFORMS = [
  'x.com',
  'twitter.com',
  'instagram.com',
  'facebook.com',
  'youtube.com',
  'twitch.tv',
  'reddit.com',
  'github.com',
  'linkedin.com',
  'google.com',
  'netflix.com',
  'amazon.com',
  'amazon.com.tr',
  'discord.com',
  'spotify.com',
  'whatsapp.com',
  'telegram.org',
  'threads.net',
  'tiktok.com',
  'pinterest.com',
];

export function isSafePlatform(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return SAFE_PLATFORMS.some((p) => h === p || h.endsWith(`.${p}`));
}

export interface ScoreResult {
  score: number;
  reasons: string[];
  shouldHide: boolean;
}

const excluded = (reason: string): ScoreResult => ({
  score: 0,
  reasons: [reason],
  shouldHide: false,
});

export interface ScoreContext extends FeatureContext {
  currentHost: string;
  model: BrainModel | null;
  /** The shipped network by default; null scores with the 12-feature model alone. */
  mlp?: Mlp | null;
}

/** Why an element must never be hidden, or null when it may be scored. */
export function exclusionReason(el: Element, host: string): string | null {
  if (el.closest(NEVER_TOUCH_SELECTOR)) return 'protected-ui';
  const className = typeof el.className === 'string' ? el.className : '';
  if (PROTECTED_CLASS.test(`${el.id} ${className}`)) return 'protected-class';
  if (STRUCTURAL_TAGS.has(el.tagName.toLowerCase())) return 'safe-tag';
  if (el.querySelector('video, audio')) return 'media';
  if (el.querySelector('input[type="password"], input[type="email"], textarea'))
    return 'auth-input';
  if (el.querySelectorAll('input, select, textarea').length >= 3) return 'form-fields';
  const canvas = el.querySelector('canvas');
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    if (r.width >= 300 && r.height >= 150) return 'game-canvas';
  }
  const text = (el.textContent ?? '').trim();
  if (
    text.length > 450 &&
    !el.querySelector(
      'iframe[src*="doubleclick"], iframe[src*="adservice"], iframe[src*="googlesyndication"]',
    )
  ) {
    return 'long-readable-content';
  }
  if (
    (host.includes('youtube.com') || host.includes('twitch.tv')) &&
    el.closest(PLATFORM_UI_SELECTOR)
  ) {
    return 'platform-player';
  }
  if (el.closest(PLAYER_SELECTOR)) return 'player-controls';
  return null;
}

export function scoreElement(el: Element, ctx: ScoreContext): ScoreResult {
  const why = exclusionReason(el, ctx.currentHost);
  if (why) return excluded(why);

  const reasons: string[] = [];
  let score = 0;
  const style = ctx.computedStyle ?? getComputedStyle(el);
  const pos = style.position;
  const isFixed = pos === 'fixed';
  const isSticky = pos === 'sticky';
  const floating = isFixed || pos === 'absolute';
  const z = parseInt(style.zIndex || '0', 10) || 0;
  const r = ctx.rect ?? el.getBoundingClientRect();
  const w = r.width || 0;
  const h = r.height || 0;

  if (isFixed || isSticky || z >= 999) {
    score += 2;
    reasons.push(isFixed || isSticky ? 'fixed-or-sticky' : 'high-z-index');
    if (z >= 99999) {
      score += 1;
      reasons.push('max-z-index');
    }
  }

  const currentRoot = rootDomain(ctx.currentHost);
  let adTarget = false;
  for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.href || '';
    try {
      const u = new URL(href, 'http://localhost');
      if (!u.protocol.startsWith('http')) continue;
      const target = rootDomain(u.hostname);
      if (
        (currentRoot && target && currentRoot !== target) ||
        AD_LINK_PARAMS.test(href) ||
        AD_LINK_PATHS.test(href)
      ) {
        adTarget = true;
        break;
      }
    } catch {
      // Unparseable href: not evidence either way.
    }
  }
  if (!adTarget) {
    const src = el.querySelector('iframe')?.getAttribute('src')?.toLowerCase() ?? '';
    adTarget = Boolean(src) && AD_IFRAME_HINTS.some((hint) => src.includes(hint));
  }
  if (adTarget) {
    score += 3;
    reasons.push('cross-site-or-ad-target');
  }

  const animatedImage = Boolean(
    el.querySelector('img[src*=".gif"], img[src*=".webp"], [style*=".gif"], [style*=".webp"]'),
  );
  const iab = isIabSize(w, h);
  if (iab || (animatedImage && (adTarget || isFixed || isSticky))) {
    score += 3;
    reasons.push(iab ? 'iab-dimension' : 'external-image');
  }

  const vw = ctx.viewport?.width ?? (globalThis.innerWidth || 1200);
  const atSideEdge = r.left <= 30 || r.right >= vw - 30;
  if (floating && w > 0 && w <= 280 && h >= 380 && atSideEdge && (adTarget || animatedImage)) {
    score += 3;
    reasons.push('pageskin-geometry');
  }

  const text = (el.textContent ?? '').trim();
  const lower = text.toLowerCase();
  const bait = BAIT_WORDS.some((b) => lower.includes(b)) || /\b(ok|okay)\b/.test(lower);
  const progress = /\d{1,3}\s*%/.test(lower);
  const closeControl = Boolean(
    el.querySelector('[class*="close" i], [id*="close" i], [aria-label*="close" i], button'),
  );
  if ((bait || progress) && (closeControl || isFixed || z >= 999)) {
    score += 4;
    reasons.push('fake-progress-or-bait');
  } else if (
    floating &&
    z >= 1000 &&
    w > 0 &&
    w <= 420 &&
    h > 0 &&
    h <= 260 &&
    (bait || adTarget)
  ) {
    score += 4;
    reasons.push('corner-push-card');
  }

  const opacity = parseFloat(style.opacity || '1');
  const transparent =
    opacity < 0.15 ||
    style.backgroundColor === 'transparent' ||
    style.backgroundColor === 'rgba(0, 0, 0, 0)';
  if (floating && z >= 999 && w >= 250 && h >= 150 && text.length < 10 && transparent) {
    score += 5;
    reasons.push('invisible-click-curtain');
  }

  const className = typeof el.className === 'string' ? el.className : '';
  const dataAd =
    el.getAttribute('data-ad') ??
    el.getAttribute('data-adslot') ??
    el.getAttribute('data-ad-client') ??
    '';
  const tokens = `${el.id} ${className} ${dataAd}`.toLowerCase();
  if (AD_WORD.test(tokens) && (!AD_WORD_FALSE_POSITIVE.test(tokens) || AD_WORD.test(el.id))) {
    score += 3;
    reasons.push('ad-identifier');
  }

  if (ctx.model) {
    const features = extractRichFeatures(el, { ...ctx, computedStyle: style, rect: r });
    const probability = richProbability(
      features,
      ctx.model,
      ctx.mlp === undefined ? SHIPPED_MLP : ctx.mlp,
    );
    const isAd = probability >= ctx.model.threshold;
    // Staged action: the model alone hides only when it is sure; below that it only adds weight
    // to what the rules above already saw.
    if (probability >= MODEL_HIDE_PROBABILITY) {
      score = Math.max(score, HIDE_SCORE);
      reasons.push('ax-brain-model');
    } else if (isAd) {
      score += 2;
      reasons.push('ax-brain-model');
    }
  }

  return { score, reasons, shouldHide: score >= HIDE_SCORE };
}
