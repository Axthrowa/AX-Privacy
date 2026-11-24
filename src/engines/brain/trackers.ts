// AX-Brain layer 2: learns third-party trackers from what they do across sites (Privacy Badger's
// idea). Pure functions; the background feeds it request signals and turns the result into rules.

import { CDN_COOKIE_HOSTS } from '../core/cdn-cookies.ts';
import { PROTECTED_HOSTS } from '../core/protected-hosts.ts';
import { looksLikeId } from './id-value.ts';
import { isSafePlatform } from './scorer.ts';

export { looksLikeId };

/** How a third party showed it can tell a visitor apart. */
export type TrackerSignal = 'cookie' | 'id-param' | 'storage' | 'fingerprint';
export const TRACKER_SIGNALS: readonly TrackerSignal[] = [
  'cookie',
  'id-param',
  'storage',
  'fingerprint',
];

export interface TrackerRecord {
  /** Registrable domain of the third party. */
  domain: string;
  /** First-party sites it tracked on, oldest first. */
  sites: string[];
  signals: TrackerSignal[];
  firstSeen: number;
  lastSeen: number;
}

/** watch: seen, not acted on; cookie: its cookies are dropped; block: its requests are blocked. */
export type TrackerState = 'watch' | 'cookie' | 'block';

/** What the AX-Brain panel shows per learned domain. */
export interface TrackerView {
  domain: string;
  state: TrackerState;
  sites: number;
  signals: TrackerSignal[];
  lastSeen: number;
}

export const MAX_TRACKERS = 2000;
export const TRACKER_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** Tracking on this many different sites drops the domain's cookies. */
export const COOKIE_SITES = 3;
/** It keeps going: this many sites with two kinds of signal blocks it. */
export const BLOCK_SITES = 6;
/** Sites kept per record; enough to decide, small enough for 2,000 records. */
const MAX_SITES = 12;

const under = (host: string, d: string) => host === d || host.endsWith(`.${d}`);

/** Never learned: sign-in, payment, bank and big platform domains, whose loss breaks pages. */
export function neverLearn(domain: string): boolean {
  return (
    PROTECTED_HOSTS.some((h) => under(h, domain) || under(domain, h)) || isSafePlatform(domain)
  );
}

/** Pages need these files; at most their cookies go (Privacy Badger's "cookieblock" list). */
export function cookieOnly(domain: string): boolean {
  return CDN_COOKIE_HOSTS.some((h) => under(h, domain));
}

export function stateOf(r: TrackerRecord): TrackerState {
  if (r.sites.length >= BLOCK_SITES && r.signals.length >= 2 && !cookieOnly(r.domain)) {
    return 'block';
  }
  return r.sites.length >= COOKIE_SITES ? 'cookie' : 'watch';
}

/**
 * Notes one signal from `domain` on `site`. Returns true when the record's state changed, which is
 * when the rules need rebuilding.
 */
export function observe(
  records: Map<string, TrackerRecord>,
  domain: string,
  site: string,
  signal: TrackerSignal,
  now: number,
): boolean {
  if (!domain || !site || domain === site || neverLearn(domain)) return false;
  const r = records.get(domain);
  if (!r) {
    records.set(domain, {
      domain,
      sites: [site],
      signals: [signal],
      firstSeen: now,
      lastSeen: now,
    });
    return false;
  }
  const before = stateOf(r);
  r.lastSeen = now;
  if (!r.sites.includes(site)) {
    r.sites.push(site);
    if (r.sites.length > MAX_SITES) r.sites.shift();
  }
  if (!r.signals.includes(signal)) r.signals.push(signal);
  return stateOf(r) !== before;
}

/** Drops records unseen for 60 days, then the least recently seen past 2,000. */
export function prune(records: Map<string, TrackerRecord>, now: number): TrackerRecord[] {
  const dropped: TrackerRecord[] = [];
  for (const r of records.values()) {
    if (now - r.lastSeen > TRACKER_TTL_MS) dropped.push(r);
  }
  const live = [...records.values()].filter((r) => now - r.lastSeen <= TRACKER_TTL_MS);
  if (live.length > MAX_TRACKERS) {
    live.sort((a, b) => a.lastSeen - b.lastSeen);
    dropped.push(...live.slice(0, live.length - MAX_TRACKERS));
  }
  for (const r of dropped) records.delete(r.domain);
  return dropped;
}

/** Domains per action, sorted so the same knowledge makes the same rules. */
export function learnedDomains(records: Iterable<TrackerRecord>): {
  cookie: string[];
  block: string[];
} {
  const cookie: string[] = [];
  const block: string[] = [];
  for (const r of records) {
    const st = stateOf(r);
    if (st === 'block') block.push(r.domain);
    else if (st === 'cookie') cookie.push(r.domain);
  }
  return { cookie: cookie.sort(), block: block.sort() };
}

export function hasIdParam(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  for (const v of u.searchParams.values()) {
    if (looksLikeId(v)) return true;
  }
  return false;
}
