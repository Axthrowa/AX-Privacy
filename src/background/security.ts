import { ALL_TYPES } from '../engines/adblock/network.ts';
import { moduleOn } from '../engines/core/control.ts';
import type { Settings } from '../shared/types.ts';
import { hostMatches } from '../shared/site.ts';
import { siteKey } from '../shared/url.ts';

export const BLOCKED_PAGE = 'blocked.html';
/** Above every filter rule (block 1, allow 2, important +10), below the control rules. */
export const PROCEED_PRIORITY = 50;

export const blockedPageUrl = (url: string, list: string) =>
  chrome.runtime.getURL(`${BLOCKED_PAGE}?${new URLSearchParams({ url, list }).toString()}`);

function httpHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

/** Hosts the user chose to open despite a warning; session rules end with the browser session. */
async function proceededHosts(): Promise<string[]> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.flatMap((r) =>
    r.priority === PROCEED_PRIORITY ? (r.condition.requestDomains ?? []) : [],
  );
}

export async function wasProceeded(url: string | null): Promise<boolean> {
  const host = url ? httpHost(url) : null;
  return host !== null && (await proceededHosts()).some((h) => hostMatches(host, h));
}

/** Lets one host load for the rest of the browser session, after an explicit click on the warning. */
export async function proceed(url: string): Promise<void> {
  const host = httpHost(url);
  if (!host) throw new Error('Geçersiz adres');
  if ((await proceededHosts()).includes(host)) return;
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const id = rules.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id,
        priority: PROCEED_PRIORITY,
        action: { type: 'allow' },
        condition: {
          requestDomains: [host],
          resourceTypes: [...ALL_TYPES] as chrome.declarativeNetRequest.ResourceType[],
        },
      },
    ],
  });
}

/**
 * A top-level navigation our page-blocking rules stopped shows the warning page instead of the
 * browser's bare error. DNR already blocked the request; this only explains it.
 */
export function installSecurityGuard(
  load: () => Promise<Settings>,
  blockingList: (s: Settings, url: string) => Promise<string | null>,
  onPage?: (url: string, list: string) => void,
): void {
  chrome.webNavigation.onErrorOccurred.addListener((d) => {
    if (d.frameId !== 0 || d.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
    void (async () => {
      const s = await load();
      if (!moduleOn(s, siteKey(d.url), 'security')) return;
      const list = await blockingList(s, d.url);
      if (list) {
        onPage?.(d.url, list);
        await chrome.tabs.update(d.tabId, { url: blockedPageUrl(d.url, list) });
      }
    })().catch(() => undefined);
  });
}
