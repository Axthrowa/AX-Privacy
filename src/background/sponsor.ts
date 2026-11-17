import { segmentsFor, segmentsUrl } from '../engines/video/sponsorblock.ts';
import type { Segment } from '../shared/types.ts';

const MAX_CACHED = 100;
const CACHE_KEY = 'sponsorCache';
/** After a failed lookup the API is left alone this long; videos just play. */
const RETRY_AFTER_MS = 5 * 60_000;

/**
 * Session storage: kept while the service worker sleeps, never written to disk, gone when the
 * browser closes. Holds at most the last 100 looked-up videos.
 */
type Cache = Record<string, Segment[]>;
let pausedUntil = 0;

async function readCache(): Promise<Cache> {
  try {
    return ((await chrome.storage.session.get(CACHE_KEY))[CACHE_KEY] as Cache | undefined) ?? {};
  } catch {
    return {};
  }
}

async function remember(videoId: string, segments: Segment[]): Promise<void> {
  const entries = Object.entries(await readCache()).filter(([k]) => k !== videoId);
  entries.push([videoId, segments]);
  const cache = Object.fromEntries(entries.slice(-MAX_CACHED));
  await chrome.storage.session.set({ [CACHE_KEY]: cache }).catch(() => undefined);
}

/** Asks SponsorBlock for a hash-prefix bucket; the video ID itself never leaves the browser. */
export async function sponsorSegments(videoId: string): Promise<Segment[]> {
  const hit = (await readCache())[videoId];
  if (hit) return hit;
  if (Date.now() < pausedUntil) return [];
  let segments: Segment[];
  try {
    const res = await fetch(await segmentsUrl(videoId), {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (res.status === 404) segments = [];
    else if (res.ok) segments = segmentsFor(await res.json(), videoId);
    else throw new Error(`SponsorBlock: HTTP ${res.status}`);
  } catch {
    pausedUntil = Date.now() + RETRY_AFTER_MS;
    return [];
  }
  await remember(videoId, segments);
  return segments;
}
