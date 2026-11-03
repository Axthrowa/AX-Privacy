import type { ConsentReport, HostReport, TabReport } from '../shared/types.ts';
import { siteKey } from '../shared/url.ts';

const BLOCKED = 'net::ERR_BLOCKED_BY_CLIENT';
const MAX_HOSTS = 500;
const SAVE_DELAY_MS = 500;
const key = (tabId: number) => `tab:${tabId}`;

interface Entry {
  site: string | null;
  url?: string | null;
  hosts: Record<string, HostReport>;
  consent: ConsentReport | null;
  insecurePassword?: boolean;
  /** The page the password field was on: without navigation events, this is what expires it. */
  insecureUrl?: string;
}

export type PageReport = Omit<TabReport, 'risk'> & { insecurePassword: boolean };

/** Per-tab state, mirrored to session storage so it survives service worker restarts. */
export class TabReports {
  private tabs = new Map<number, Entry>();
  private dirty = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private store: {
      get(k: string): Promise<Entry | undefined>;
      set(k: string, v: Entry): Promise<void>;
      remove(k: string): Promise<void>;
    },
    private onBlocked?: (host: string) => void,
  ) {}

  private async entry(tabId: number): Promise<Entry> {
    let e = this.tabs.get(tabId);
    if (!e) {
      e = (await this.store.get(key(tabId))) ?? { site: null, hosts: {}, consent: null };
      // Another event for this tab may have loaded it while we awaited.
      e = this.tabs.get(tabId) ?? e;
      this.tabs.set(tabId, e);
    }
    return e;
  }

  private touch(tabId: number): void {
    this.dirty.add(tabId);
    this.timer ??= setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    this.timer = null;
    const ids = [...this.dirty];
    this.dirty.clear();
    await Promise.all(
      ids.map((id) => {
        const e = this.tabs.get(id);
        return e ? this.store.set(key(id), e) : Promise.resolve();
      }),
    );
  }

  /** A new top-level document: forget the previous page. */
  navigated(tabId: number, url: string): void {
    this.tabs.set(tabId, {
      site: siteKey(url),
      url,
      hosts: {},
      consent: null,
      insecurePassword: false,
    });
    this.touch(tabId);
  }

  async request(tabId: number, url: string, error?: string): Promise<void> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    const e = await this.entry(tabId);
    let h = e.hosts[host];
    if (!h) {
      if (Object.keys(e.hosts).length >= MAX_HOSTS) return;
      const site = siteKey(url);
      h = { host, thirdParty: e.site !== null && site !== e.site, loaded: 0, blocked: 0 };
      e.hosts[host] = h;
    }
    if (error === undefined) h.loaded++;
    else if (error === BLOCKED) {
      h.blocked++;
      this.onBlocked?.(host);
    } else return;
    this.touch(tabId);
  }

  async consent(tabId: number, report: ConsentReport): Promise<void> {
    const e = await this.entry(tabId);
    // A failed attempt in one frame must not hide a success in another.
    if (e.consent?.result === true && report.result !== true) return;
    e.consent = report;
    this.touch(tabId);
  }

  async insecurePassword(tabId: number, url?: string): Promise<void> {
    const e = await this.entry(tabId);
    e.insecurePassword = true;
    if (url !== undefined) e.insecureUrl = url;
    this.touch(tabId);
  }

  async report(tabId: number, currentUrl?: string): Promise<PageReport> {
    const e = await this.entry(tabId);
    const hosts = Object.values(e.hosts).sort(
      (a, b) =>
        Number(b.thirdParty) - Number(a.thirdParty) ||
        b.blocked - a.blocked ||
        b.loaded - a.loaded ||
        a.host.localeCompare(b.host),
    );
    return {
      site: e.site,
      url: e.url ?? null,
      hosts,
      consent: e.consent,
      insecurePassword:
        (e.insecurePassword ?? false) &&
        (e.insecureUrl === undefined || e.insecureUrl === currentUrl),
    };
  }

  async closed(tabId: number): Promise<void> {
    this.tabs.delete(tabId);
    this.dirty.delete(tabId);
    await this.store.remove(key(tabId));
  }
}

const REQUEST_FILTER = { urls: ['http://*/*', 'https://*/*'] };
let stopReports: (() => void) | null = null;

/** These listeners wake the worker for every request of every page, so they run only on request. */
export function setTabReports(reports: TabReports, on: boolean): void {
  if (!on) {
    stopReports?.();
    stopReports = null;
    return;
  }
  if (stopReports) return;
  const completed = (d: chrome.webRequest.OnCompletedDetails) => {
    if (d.tabId >= 0 && d.type !== 'main_frame') void reports.request(d.tabId, d.url);
  };
  const failed = (d: chrome.webRequest.OnErrorOccurredDetails) => {
    if (d.tabId >= 0 && d.type !== 'main_frame') {
      void reports.request(d.tabId, d.url, d.error);
    }
  };
  const committed = (d: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
    if (d.frameId === 0) reports.navigated(d.tabId, d.url);
  };
  const removed = (tabId: number) => void reports.closed(tabId);
  chrome.webRequest.onCompleted.addListener(completed, REQUEST_FILTER);
  chrome.webRequest.onErrorOccurred.addListener(failed, REQUEST_FILTER);
  chrome.webNavigation.onCommitted.addListener(committed);
  chrome.tabs.onRemoved.addListener(removed);
  stopReports = () => {
    chrome.webRequest.onCompleted.removeListener(completed);
    chrome.webRequest.onErrorOccurred.removeListener(failed);
    chrome.webNavigation.onCommitted.removeListener(committed);
    chrome.tabs.onRemoved.removeListener(removed);
  };
}

export const sessionStore = {
  async get(k: string) {
    return (await chrome.storage.session.get(k))[k] as Entry | undefined;
  },
  set: (k: string, v: Entry) => chrome.storage.session.set({ [k]: v }),
  remove: (k: string) => chrome.storage.session.remove(k),
};
