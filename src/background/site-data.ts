import { sitesOff } from '../engines/core/control.ts';
import type { Settings } from '../shared/types.ts';
import { siteKey } from '../shared/url.ts';

/** What goes: what sites keep about you. History, passwords and downloads are never touched. */
const DATA_TYPES: chrome.browsingData.DataTypeSet = {
  cookies: true,
  localStorage: true,
  indexedDB: true,
  cacheStorage: true,
  serviceWorkers: true,
  fileSystems: true,
};
/** Closing several tabs at once clears once. */
const SETTLE_MS = 1_500;

/**
 * Origins whose data stays: every open tab's, and both forms of each kept site. The browser keeps
 * cookies for an excluded origin's whole registrable domain; storage only for the origin itself.
 * shortcut: storage of a kept site's other subdomains (gist.github.com) is cleared; logins live in
 * cookies and stay. Record visited origins of kept sites if that ever matters.
 */
export function keptOrigins(s: Settings, openUrls: readonly string[]): string[] {
  const out = new Set<string>();
  const sites = new Set([...s.privacy.keepSiteData, ...sitesOff(s, 'privacy')]);
  for (const url of openUrls) {
    const site = siteKey(url);
    if (!site) continue;
    out.add(new URL(url).origin);
    sites.add(site);
  }
  for (const site of sites) {
    for (const scheme of ['https', 'http']) {
      out.add(`${scheme}://${site}`);
      out.add(`${scheme}://www.${site}`);
    }
  }
  return [...out].sort();
}

let timer: ReturnType<typeof setTimeout> | undefined;
let load: (() => Promise<Settings>) | undefined;

async function clear(): Promise<void> {
  const s = await load?.();
  if (!s?.enabled || !s.privacy.clearSiteData) return;
  const tabs = await chrome.tabs.query({});
  const urls = tabs.flatMap((t) => (t.url ? [t.url] : []));
  await chrome.browsingData.remove({ excludeOrigins: keptOrigins(s, urls) }, DATA_TYPES);
}

function onRemoved(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void clear().catch(() => undefined), SETTLE_MS);
}

/**
 * Listens for closed tabs only while asked to: the listener wakes the worker for every tab. Added
 * after start-up, it can miss the close that woke the worker, so each start clears once as well.
 */
export function syncSiteDataCleanup(s: Settings, loadSettings: () => Promise<Settings>): void {
  // Firefox has no excludeOrigins; without it the call would clear every site.
  const on =
    s.enabled && s.privacy.clearSiteData && !chrome.runtime.getURL('').startsWith('moz-extension:');
  if (!on) {
    chrome.tabs.onRemoved.removeListener(onRemoved);
    return;
  }
  load = loadSettings;
  if (!chrome.tabs.onRemoved.hasListener(onRemoved)) {
    chrome.tabs.onRemoved.addListener(onRemoved);
    onRemoved();
  }
}
