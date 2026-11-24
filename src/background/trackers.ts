import {
  hasIdParam,
  learnedDomains,
  observe,
  prune,
  stateOf,
  type TrackerRecord,
  type TrackerSignal,
  type TrackerView,
} from '../engines/brain/trackers.ts';
import { siteKey } from '../shared/url.ts';
import { allTrackers, clearTrackers, saveTrackers } from '../storage/db.ts';
import { db } from './filters.ts';

let records: Promise<Map<string, TrackerRecord>> | null = null;
const load = () =>
  (records ??= db().then(async (d) => {
    const m = new Map((await allTrackers(d)).map((r) => [r.domain, r]));
    const dropped = prune(m, Date.now());
    if (dropped.length) {
      await saveTrackers(
        d,
        [],
        dropped.map((r) => r.domain),
      );
    }
    return m;
  }));

const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** Writes are batched: a page makes dozens of third-party requests at once. */
const FLUSH_MS = 5000;

async function flush(): Promise<void> {
  flushTimer = undefined;
  const m = await load();
  const dropped = prune(m, Date.now()).map((r) => r.domain);
  const put = [...dirty].flatMap((d) => m.get(d) ?? []);
  dirty.clear();
  await saveTrackers(await db(), put, dropped);
}

export async function learnedTrackers(): Promise<{ cookie: string[]; block: string[] }> {
  return learnedDomains((await load()).values());
}

/** Newest first; the panel shows what AX-Brain acts on before what it only watches. */
export async function trackerView(limit = 200): Promise<TrackerView[]> {
  const rank = { block: 0, cookie: 1, watch: 2 } as const;
  return [...(await load()).values()]
    .map((r) => ({
      domain: r.domain,
      state: stateOf(r),
      sites: r.sites.length,
      signals: r.signals,
      lastSeen: r.lastSeen,
    }))
    .sort((a, b) => rank[a.state] - rank[b.state] || b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

export async function forgetTracker(domain: string): Promise<void> {
  (await load()).delete(domain);
  dirty.delete(domain);
  await saveTrackers(await db(), [], [domain]);
}

export async function forgetAllTrackers(): Promise<void> {
  (await load()).clear();
  dirty.clear();
  await clearTrackers(await db());
}

/** Whether learning runs, and on which sites it may not; set by the settings pass. */
export interface LearnGate {
  on: boolean;
  skip: ReadonlySet<string>;
}

const incognitoTabs = new Map<number, boolean>();
async function isIncognito(d: chrome.webRequest.OnHeadersReceivedDetails): Promise<boolean> {
  // Firefox says so on the event; Chromium only on the tab.
  const flag = (d as { incognito?: boolean }).incognito;
  if (flag !== undefined) return flag;
  if (d.tabId < 0) return false;
  let known = incognitoTabs.get(d.tabId);
  if (known === undefined) {
    known = await chrome.tabs.get(d.tabId).then(
      (t) => t.incognito,
      () => false,
    );
    incognitoTabs.set(d.tabId, known);
  }
  return known;
}

let hooks: { gate: () => Promise<LearnGate>; changed: () => void } | null = null;

/** `known`: count only for a domain already on record (the page-side notes can be faked). */
async function record(
  domain: string,
  site: string,
  signals: TrackerSignal[],
  known: boolean,
): Promise<void> {
  if (!hooks) return;
  const g = await hooks.gate();
  if (!g.on || g.skip.has(site)) return;
  const m = await load();
  if (known && !m.has(domain)) return;
  const now = Date.now();
  let moved = false;
  for (const sig of signals) moved = observe(m, domain, site, sig, now) || moved;
  if (m.has(domain)) dirty.add(domain);
  flushTimer ??= setTimeout(() => void flush(), FLUSH_MS);
  if (moved) hooks.changed();
}

/** A script that fingerprinted or stored an ID on the page (see content/brain-signals.ts). */
export async function notePageSignal(
  pageUrl: string,
  source: string,
  signal: 'storage' | 'fingerprint',
  incognito: boolean,
): Promise<void> {
  const site = siteKey(pageUrl);
  const domain = siteKey(source);
  if (incognito || !site || !domain || site === domain) return;
  await record(domain, site, [signal], true);
}

/**
 * Third-party responses: a Set-Cookie or a visitor ID in the URL counts as tracking on the page's
 * site. Private windows teach nothing. `changed` runs when a domain moves to cookie or block, so the
 * rules can be rebuilt.
 */
let listening = false;
export function installTrackerLearning(gate: () => Promise<LearnGate>, changed: () => void): void {
  hooks = { gate, changed };
  // webRequest is optional: without it nothing is learned from the network (page notes need a
  // record from the network first). Called again when the permission is granted.
  if (listening || !(chrome.webRequest as typeof chrome.webRequest | undefined)) return;
  listening = true;
  chrome.webRequest.onHeadersReceived.addListener(
    (d) => {
      if (d.type === 'main_frame') return;
      // Firefox names the page as documentUrl instead of initiator.
      const site = siteKey(d.initiator ?? (d as { documentUrl?: string }).documentUrl);
      const domain = siteKey(d.url);
      if (!site || !domain || site === domain) return;
      const signals: TrackerSignal[] = [];
      if (d.responseHeaders?.some((h) => h.name.toLowerCase() === 'set-cookie')) {
        signals.push('cookie');
      }
      if (hasIdParam(d.url)) signals.push('id-param');
      if (!signals.length) return;
      void (async () => {
        if (await isIncognito(d)) return;
        await record(domain, site, signals, false);
      })().catch(() => undefined);
    },
    { urls: ['http://*/*', 'https://*/*'] },
    // Chromium hides Set-Cookie without extraHeaders; Firefox has no such option and refuses it.
    (chrome.webRequest as { OnHeadersReceivedOptions?: { EXTRA_HEADERS?: string } })
      .OnHeadersReceivedOptions?.EXTRA_HEADERS
      ? ['responseHeaders', 'extraHeaders']
      : ['responseHeaders'],
  );
  chrome.tabs.onRemoved.addListener((tabId) => incognitoTabs.delete(tabId));
}

/** The permission was taken back: its listeners are gone with the API. */
export function trackerLearningStopped(): void {
  listening = false;
}
