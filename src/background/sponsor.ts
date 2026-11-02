import { segmentsFor, segmentsUrl } from '../engines/video/sponsorblock.ts';
import type { Segment } from '../shared/types.ts';

const MAX_CACHED = 100;
/** In memory only: gone when the service worker stops. Nothing about viewing is stored. */
const cache = new Map<string, Segment[]>();

/** Asks SponsorBlock for a hash-prefix bucket; the video ID itself never leaves the browser. */
export async function sponsorSegments(videoId: string): Promise<Segment[]> {
  const hit = cache.get(videoId);
  if (hit) return hit;
  const res = await fetch(await segmentsUrl(videoId), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  let segments: Segment[];
  if (res.status === 404) segments = [];
  else if (res.ok) segments = segmentsFor(await res.json(), videoId);
  else throw new Error(`SponsorBlock: HTTP ${res.status}`);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
  cache.set(videoId, segments);
  return segments;
}
