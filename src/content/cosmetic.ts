import { DOMMonitor } from '@ghostery/adblocker-content';
import {
  handlePseudoDirective,
  querySelectorAll,
  type AST,
} from '@ghostery/adblocker-extended-selectors';
import { decodeTokens, knownFeatures } from '../engines/adblock/generic-tokens.ts';
import { domKey, startKey, type CachedStyle } from '../shared/cosmetic-cache.ts';
import { send } from '../shared/messages.ts';
import type { ExtendedRule } from '../shared/types.ts';

declare global {
  /** Absent when custom rules or user lists exist: their words are not in the built table. */
  var __nexusTokens: string | undefined;
}

// Hiding CSS is injected by the background with `insertCSS`; this script only reports page
// features and evaluates procedural selectors (`:has-text`, `:upward`, `:remove`...).
const extended = new Map<number, ExtendedRule>();
let scheduled = false;

function applyExtended(): void {
  scheduled = false;
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
  requestAnimationFrame(applyExtended);
}

function addExtended(rules: ExtendedRule[]): void {
  for (const r of rules) extended.set(r.id, r);
  schedule();
}

/** The packaged word table, plus words from list updates that came after the package. */
async function cached(key: string): Promise<CachedStyle<ExtendedRule> | undefined> {
  return (await chrome.storage.local.get(key))[key] as CachedStyle<ExtendedRule> | undefined;
}

/** Stored hiding CSS, applied from here. Constructed sheets are exempt from the page's style CSP. */
function applyStored(css: string): void {
  if (!css) return;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // Firefox can refuse a sheet built in a content script.
    const style = document.createElement('style');
    style.textContent = css;
    (document.head ?? document.documentElement).append(style);
  }
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
          applyStored(stored.css);
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
    applyStored(stored.css);
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
