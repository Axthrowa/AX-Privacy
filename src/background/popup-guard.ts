import { moduleOn } from '../engines/core/control.ts';
import type { Settings } from '../shared/types.ts';
import { siteKey } from '../shared/url.ts';
import { popupMatcher } from './filters.ts';

/** How long a new tab counts as a popup of its opener; covers ad-server redirect chains. */
const WINDOW_MS = 5_000;
/** How long a reported middle/ctrl/context-menu click vouches for a new tab with that URL. */
const USER_OPEN_MS = 3_000;
/** The content script's report can arrive just after the tab is created. */
const USER_OPEN_GRACE_MS = 300;

interface Pending {
  openerUrl: string;
  until: number;
  /** Resolves to true if the user explicitly opened this tab from a link. */
  byUser: Promise<boolean>;
}

const pending = new Map<number, Pending>();
const userOpens = new Map<number, { url: string; until: number }[]>();

export function noteUserOpen(tabId: number, url: string): void {
  const now = Date.now();
  const list = (userOpens.get(tabId) ?? []).filter((o) => o.until > now);
  list.push({ url, until: now + USER_OPEN_MS });
  userOpens.set(tabId, list.slice(-10));
}

function openedByUser(sourceTabId: number, url: string): boolean {
  const now = Date.now();
  return !!userOpens.get(sourceTabId)?.some((o) => o.url === url && o.until > now);
}

async function check(
  load: () => Promise<Settings>,
  tabId: number,
  url: string,
  onPopup?: (url: string) => void,
): Promise<void> {
  const p = pending.get(tabId);
  if (!p) return;
  if (Date.now() > p.until) {
    pending.delete(tabId);
    return;
  }
  if (!/^https?:/.test(url)) return;
  const s = await load();
  if (!moduleOn(s, siteKey(p.openerUrl), 'network')) return;
  if (!(await popupMatcher(s))(url, p.openerUrl)) return;
  if (await p.byUser) return;
  pending.delete(tabId);
  await chrome.tabs.remove(tabId).catch(() => undefined);
  onPopup?.(url);
}

/**
 * Closes new tabs whose URL matches a `$popup` filter, judged against the opener frame's URL.
 * Tabs the user opened on purpose (middle/ctrl-click, "open in new tab") are never closed.
 */
export function installPopupGuard(
  load: () => Promise<Settings>,
  onPopup?: (url: string) => void,
): void {
  const onNav = (d: { tabId: number; frameId: number; url: string }) => {
    if (d.frameId === 0) void check(load, d.tabId, d.url, onPopup);
  };
  // Navigation events fire for every page; they are watched only while a new tab is in question.
  let watching: ReturnType<typeof setTimeout> | null = null;
  const watch = () => {
    if (watching) clearTimeout(watching);
    else {
      chrome.webNavigation.onBeforeNavigate.addListener(onNav);
      chrome.webNavigation.onCommitted.addListener(onNav);
    }
    watching = setTimeout(() => {
      watching = null;
      pending.clear();
      chrome.webNavigation.onBeforeNavigate.removeListener(onNav);
      chrome.webNavigation.onCommitted.removeListener(onNav);
    }, WINDOW_MS);
  };
  chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
    watch();
    void (async () => {
      const byUser = new Promise<boolean>((done) =>
        setTimeout(() => done(openedByUser(d.sourceTabId, d.url)), USER_OPEN_GRACE_MS),
      );
      const frame = await chrome.webNavigation
        .getFrame({ tabId: d.sourceTabId, frameId: d.sourceFrameId })
        .catch(() => null);
      if (!frame?.url) return;
      pending.set(d.tabId, { openerUrl: frame.url, until: Date.now() + WINDOW_MS, byUser });
      await check(load, d.tabId, d.url, onPopup);
    })();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    pending.delete(tabId);
    userOpens.delete(tabId);
  });
}
