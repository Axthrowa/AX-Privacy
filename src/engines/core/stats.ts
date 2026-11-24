import type { DailyStat } from '../../storage/db.ts';
import { BUILTIN_LISTS } from '../../filters/catalog.ts';

export const STAT_KEYS = [
  'ads',
  'trackers',
  'security',
  'other',
  'pages',
  'popups',
  'consent',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const HOST_PREFIX = 'host:';
export const STAT_RETAIN_DAYS = 30;

export interface DayCounts {
  day: string;
  ads: number;
  trackers: number;
  security: number;
  other: number;
  pages: number;
  popups: number;
  consent: number;
}

export interface SecurityEvent {
  at: number;
  kind: 'page' | 'popup';
  url: string;
  list?: string;
}

export interface StatsDump {
  rows: DailyStat[];
  events: SecurityEvent[];
}

export interface StatsView {
  days: DayCounts[];
  totals: Omit<DayCounts, 'day'> & { requests: number };
  topHosts: { host: string; count: number }[];
  events: SecurityEvent[];
}

const empty = (): Omit<DayCounts, 'day'> => ({
  ads: 0,
  trackers: 0,
  security: 0,
  other: 0,
  pages: 0,
  popups: 0,
  consent: 0,
});

/** By id and by name: a blocked page is reported under the name the warning shows. */
const CATEGORY_OF = new Map(
  BUILTIN_LISTS.flatMap((l) => [
    [l.id, l.category],
    [l.name, l.category],
  ]),
);

/**
 * Which bucket a DNR match belongs to. Empty means not this extension (Shields or another blocker).
 * Security lists win, then privacy (trackers), then ads/regional.
 */
export function classifyRulesets(ids: readonly string[]): StatKey | null {
  if (ids.length === 0) return null;
  const cats = ids.map((id) => CATEGORY_OF.get(id));
  if (cats.includes('security')) return 'security';
  if (cats.includes('privacy')) return 'trackers';
  if (cats.includes('ads') || cats.includes('regional') || cats.includes('annoyances'))
    return 'ads';
  return 'other';
}

/** The user's calendar day, as YYYY-MM-DD. */
export function localDay(ms = Date.now()): string {
  return new Date(ms).toLocaleDateString('sv');
}

export function daysAgo(n: number, from = localDay()): string {
  const d = new Date(`${from}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = daysAgo(-1, day)) out.push(day);
  return out;
}

const isKey = (c: string): c is StatKey => (STAT_KEYS as readonly string[]).includes(c);

/** `ads` and `trackers` only exist in rows from older versions; see `StatsRecorder.request`. */
export const blockedRequests = (d: Omit<DayCounts, 'day'>) => d.ads + d.trackers + d.other;

/** Fills every calendar day in the range, even when nothing was recorded. */
export function summarize(
  rows: DailyStat[],
  from: string,
  to: string,
  events: SecurityEvent[] = [],
): StatsView {
  const byDay = new Map<string, DayCounts>();
  const hosts = new Map<string, number>();
  for (const row of rows) {
    if (row.day < from || row.day > to) continue;
    if (row.category.startsWith(HOST_PREFIX)) {
      const host = row.category.slice(HOST_PREFIX.length);
      if (host) hosts.set(host, (hosts.get(host) ?? 0) + row.count);
      continue;
    }
    if (!isKey(row.category)) continue;
    const cur = byDay.get(row.day) ?? { day: row.day, ...empty() };
    cur[row.category] += row.count;
    byDay.set(row.day, cur);
  }
  const days = eachDay(from, to).map((day) => byDay.get(day) ?? { day, ...empty() });
  const totals = days.reduce((acc, d) => {
    for (const k of STAT_KEYS) acc[k] += d[k];
    return acc;
  }, empty());
  const topHosts = [...hosts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .slice(0, 10);
  return {
    days,
    totals: { ...totals, requests: blockedRequests(totals) },
    topHosts,
    events: events.filter((e) => localDay(e.at) >= from).slice(0, 50),
  };
}

/**
 * Rough sizes of what a blocked request would have downloaded, and what a closed pop-up or a
 * rejected cookie notice costs a person. Estimates, not measurements: the browser never fetches a
 * blocked request, so its real size is unknown. Ad requests often pull further scripts and media,
 * trackers are mostly tiny pixels and beacons.
 */
export const SAVING_ESTIMATE = {
  adBytes: 30_000,
  trackerBytes: 5_000,
  otherBytes: 10_000,
  /** 10 Mbit/s, a slow-to-average home line. */
  bytesPerSecond: 1_250_000,
  popupSeconds: 5,
  consentSeconds: 3,
} as const;

/** Estimated bytes and seconds saved by these counts (see `SAVING_ESTIMATE`). */
export function estimateSavings(c: Omit<DayCounts, 'day'>): { bytes: number; seconds: number } {
  const e = SAVING_ESTIMATE;
  const bytes = c.ads * e.adBytes + c.trackers * e.trackerBytes + c.other * e.otherBytes;
  const seconds =
    bytes / e.bytesPerSecond + c.popups * e.popupSeconds + c.consent * e.consentSeconds;
  return { bytes, seconds: Math.round(seconds) };
}
