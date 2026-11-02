import { parse } from 'tldts';
import type { DomFeatures } from '../shared/messages.ts';
import type { ExtendedRule, Settings } from '../shared/types.ts';
import { cosmeticEngine } from './filters.ts';
import type { SenderContext } from './router.ts';

function page(url: string) {
  const p = parse(url, { allowPrivateDomains: true });
  return { url, hostname: p.hostname ?? '', domain: p.domain ?? '' };
}

const CACHE_PREFIX = 'cosmetic/';
const CACHE_MAX_BYTES = 5_000_000;

/** Forgets cached page styles; the filters behind them changed. */
export async function clearCosmeticCache(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX)));
}

/** USER origin so page `!important` rules cannot override hiding. */
async function inject(ctx: SenderContext, css: string): Promise<void> {
  if (!css || ctx.tabId === undefined) return;
  const target: chrome.scripting.InjectionTarget = ctx.documentId
    ? { tabId: ctx.tabId, documentIds: [ctx.documentId] }
    : { tabId: ctx.tabId, frameIds: [ctx.frameId ?? 0] };
  // The frame may be gone by now.
  await chrome.scripting.insertCSS({ target, css, origin: 'USER' }).catch(() => undefined);
}

/**
 * Generic and hostname-specific hiding for a frame at document_start. Repeat visits to a host are
 * answered from session storage, so the worker does not load the engine for them.
 */
export async function cosmeticStart(s: Settings, ctx: SenderContext): Promise<ExtendedRule[]> {
  const key = CACHE_PREFIX + page(ctx.url).hostname;
  const cached = (await chrome.storage.session.get(key))[key] as
    { css: string; extended: ExtendedRule[] } | undefined;
  if (cached) {
    await inject(ctx, cached.css);
    return cached.extended;
  }
  const engine = await cosmeticEngine(s);
  if (!engine) return [];
  const { active, styles, extended } = engine.getCosmeticsFilters({
    ...page(ctx.url),
    getBaseRules: true,
    getInjectionRules: false,
    getExtendedRules: true,
    getRulesFromHostname: true,
    getRulesFromDOM: false,
  });
  const entry = active ? { css: styles, extended } : { css: '', extended: [] };
  await inject(ctx, entry.css);
  if ((await chrome.storage.session.getBytesInUse()) > CACHE_MAX_BYTES) await clearCosmeticCache();
  await chrome.storage.session.set({ [key]: entry });
  return entry.extended;
}

/** Generic rules keyed by classes, ids and links the content script found in the page. */
export async function cosmeticDom(
  s: Settings,
  ctx: SenderContext,
  features: DomFeatures,
): Promise<ExtendedRule[]> {
  const engine = await cosmeticEngine(s);
  if (!engine) return [];
  const { active, styles, extended } = engine.getCosmeticsFilters({
    ...page(ctx.url),
    classes: features.classes,
    ids: features.ids,
    hrefs: features.hrefs,
    getBaseRules: false,
    getInjectionRules: false,
    getExtendedRules: true,
    getRulesFromHostname: false,
    getRulesFromDOM: true,
  });
  if (!active) return [];
  await inject(ctx, styles);
  return extended;
}
