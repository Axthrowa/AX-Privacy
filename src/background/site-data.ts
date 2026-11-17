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

/** Registered at start-up, so a tab closing wakes the worker; it does nothing unless asked. */
export function installSiteDataCleanup(load: () => Promise<Settings>): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = async () => {
    const s = await load();
    if (!s.enabled || !s.privacy.clearSiteData) return;
    // Firefox has no excludeOrigins; without it this call would clear every site.
    if (chrome.runtime.getURL('').startsWith('moz-extension:')) return;
    const tabs = await chrome.tabs.query({});
    const urls = tabs.flatMap((t) => (t.url ? [t.url] : []));
    await chrome.browsingData.remove({ excludeOrigins: keptOrigins(s, urls) }, DATA_TYPES);
  };
  chrome.tabs.onRemoved.addListener(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void clear().catch(() => undefined), SETTLE_MS);
  });
}
