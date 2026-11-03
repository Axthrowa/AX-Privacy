import { DOMMonitor } from '@ghostery/adblocker-content';
import {
  handlePseudoDirective,
  querySelectorAll,
  type AST,
} from '@ghostery/adblocker-extended-selectors';
import { decodeTokens, knownFeatures } from '../engines/adblock/generic-tokens.ts';
import { domKey, startKey, type CachedStyle } from '../shared/cosmetic-cache.ts';
import { send } from '../shared/messages.ts';
import { hostMatches } from '../shared/site.ts';
import type { ExtendedRule, Settings } from '../shared/types.ts';

declare global {
  /** Absent when custom rules or user lists exist: their words are not in the built table. */
  var __nexusTokens: string | undefined;
}

// Hiding CSS comes from the background's `insertCSS` or, on a site seen before, from storage. This
// script also reports page features and evaluates procedural selectors (`:has-text`, `:remove`...).
const extended = new Map<number, ExtendedRule>();
/** These selectors search the whole page, and some pages change on every frame. */
const EXTENDED_GAP_MS = 200;
let scheduled = false;
let lastRun = 0;

function applyExtended(): void {
  scheduled = false;
  lastRun = performance.now();
  for (const rule of extended.values()) {
    for (const el of querySelectorAll(document.documentElement, rule.ast as AST)) {
      if (rule.attribute) el.setAttribute(rule.attribute, '');
      else if (rule.directive) handlePseudoDirective(el, rule.directive as AST);
    }
  }
}

function schedule(): void {
  if (scheduled || extended.size === 0) return;
  scheduled = true;
  setTimeout(applyExtended, Math.max(0, lastRun + EXTENDED_GAP_MS - performance.now()));
}

function addExtended(rules: ExtendedRule[]): void {
  for (const r of rules) extended.set(r.id, r);
  schedule();
}

/** The packaged word table, plus words from list updates that came after the package. */
function topHost(): string | null {
  const origins = location.ancestorOrigins;
  try {
    return origins?.length ? new URL(origins[origins.length - 1] ?? '').hostname : null;
  } catch {
    return null;
  }
}

/** Scripts are excluded by a frame's own address, so a frame inside a paused site still gets here. */
async function insideSiteWithoutHiding(): Promise<boolean> {
  const top = topHost();
  if (top === null) return false;
  const { settings } = (await chrome.storage.local.get('settings')) as {
    settings?: Partial<Settings>;
  };
  const off = Object.entries(settings?.siteProfiles ?? {})
    .filter(([, profile]) => !profile.network)
    .map(([site]) => site);
  return [...(settings?.pausedSites ?? []), ...off].some((site) => hostMatches(top, site));
}

const hidingOff = insideSiteWithoutHiding();

async function cached(key: string): Promise<CachedStyle<ExtendedRule> | undefined> {
  // The worker answers these frames correctly, with nothing.
  if (await hidingOff) return undefined;
  return (await chrome.storage.local.get(key))[key] as CachedStyle<ExtendedRule> | undefined;
}

const storedSheets: CSSStyleSheet[] = [];
/** Asks the worker for what storage supplied: its `insertCSS` outranks the page's own `!important`. */
const askWorker: (() => void)[] = [];
let watching = false;

function pageFights(): boolean {
  for (const sheet of storedSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || rule.style.display !== 'none') continue;
      for (const el of document.querySelectorAll(rule.selectorText)) {
        if (getComputedStyle(el).display !== 'none') return true;
      }
    }
  }
  return false;
}

function checkPage(): void {
  if (askWorker.length > 0 && pageFights()) for (const ask of askWorker.splice(0)) ask();
}

/** shortcut: looks twice after load, so a page undoing the sheet later wins; add a check if seen. */
function watchPage(): void {
  if (watching) return;
  watching = true;
  const later = () => {
    for (const ms of [1000, 4000]) setTimeout(checkPage, ms);
  };
  if (document.readyState === 'complete') later();
  else addEventListener('load', later, { once: true });
}

/** Stored hiding CSS, applied from here. Constructed sheets are exempt from the page's style CSP. */
function applyStored(css: string, ask: () => Promise<unknown>): void {
  if (!css) return;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    storedSheets.push(sheet);
  } catch {
    // Firefox can refuse a sheet built in a content script.
    const style = document.createElement('style');
    style.textContent = css;
    (document.head ?? document.documentElement).append(style);
    if (style.sheet) storedSheets.push(style.sheet);
  }
  askWorker.push(() => void ask().catch(() => undefined));
  watchPage();
}

async function wordTables(): Promise<Uint32Array[] | null> {
  if (!self.__nexusTokens) return null;
  const { genericTokensExtra: extra } = (await chrome.storage.local.get('genericTokensExtra')) as {
    genericTokensExtra?: string;
  };
  return [decodeTokens(self.__nexusTokens), ...(extra ? [decodeTokens(extra)] : [])];
}

async function startMonitor(): Promise<void> {
  const tables = await wordTables();
  const monitor = new DOMMonitor((update) => {
    if (update.type === 'features') {
      const { classes, ids, hrefs } = tables ? knownFeatures(update, tables) : update;
      if (classes.length + ids.length + hrefs.length === 0) return;
      void (async () => {
        const features = { classes, ids, hrefs };
        const stored = location.hostname
          ? await cached(domKey(location.hostname, features))
          : undefined;
        if (stored) {
          applyStored(stored.css, () => send('cosmetic/dom', features));
          addExtended(stored.extended);
        } else {
          addExtended((await send('cosmetic/dom', features)).extended);
        }
      })().catch(() => undefined);
    } else {
      schedule();
    }
  });
  monitor.queryAll(window);
  monitor.start(window);
}

// A plain click stays a popup candidate: ad scripts open popups from ordinary clicks.
function noteUserOpen(e: MouseEvent): void {
  const explicit =
    e.type === 'contextmenu' || e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey;
  const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (explicit && link instanceof HTMLAnchorElement) {
    void send('popup/userOpen', { url: link.href }).catch(() => undefined);
  }
}
for (const type of ['click', 'auxclick', 'contextmenu'] as const) {
  addEventListener(type, noteUserOpen, true);
}

// Password typed over plain http: checked at load and when a later-added field gets focus.
if (location.protocol === 'http:' && window === window.top) {
  let reported = false;
  const check = (el: unknown) => {
    if (reported || !(el instanceof HTMLInputElement) || el.type !== 'password') return;
    reported = true;
    void send('security/insecurePassword', {}).catch(() => undefined);
  };
  addEventListener('load', () => check(document.querySelector('input[type="password"]')), {
    once: true,
  });
  addEventListener('focusin', (e) => check(e.target), true);
}

void (async () => {
  const stored = location.hostname ? await cached(startKey(location.hostname)) : undefined;
  if (stored) {
    applyStored(stored.css, () => send('cosmetic/start', {}));
    return stored.extended;
  }
  return (await send('cosmetic/start', {})).extended;
})()
  .then((rules) => {
    addExtended(rules);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => void startMonitor(), { once: true });
    } else {
      void startMonitor();
    }
  })
  .catch(() => undefined);
