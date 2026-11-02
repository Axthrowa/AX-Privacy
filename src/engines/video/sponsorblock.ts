import { isVideoId } from '../../shared/messages.ts';
import type { Segment } from '../../shared/types.ts';

/** SponsorBlock's public API (https://wiki.sponsor.ajay.app/w/API_Docs); data is CC BY-NC-SA 4.0. */
export const SPONSORBLOCK_API = 'https://sponsor.ajay.app';
/** 4 hex characters: the server sees one of 65,536 buckets, each shared by many videos. */
const PREFIX_LENGTH = 4;
/** Stop this short of the segment end, so a seek that lands just before it does not loop. */
const END_MARGIN = 0.5;

export async function hashPrefix(videoId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, PREFIX_LENGTH);
}

export async function segmentsUrl(videoId: string): Promise<string> {
  const categories = encodeURIComponent(JSON.stringify(['sponsor']));
  return `${SPONSORBLOCK_API}/api/skipSegments/${await hashPrefix(videoId)}?categories=${categories}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Picks this video's skippable segments out of a hash-prefix response; anything malformed is dropped. */
export function segmentsFor(body: unknown, videoId: string): Segment[] {
  if (!Array.isArray(body)) return [];
  const entry: unknown = body.find((e) => isObj(e) && e.videoID === videoId);
  if (!isObj(entry) || !Array.isArray(entry.segments)) return [];
  const out: Segment[] = [];
  for (const s of entry.segments) {
    if (!isObj(s) || s.category !== 'sponsor' || (s.actionType ?? 'skip') !== 'skip') continue;
    const range = s.segment;
    if (!Array.isArray(range) || !isTime(range[0]) || !isTime(range[1])) continue;
    if (range[1] - range[0] > END_MARGIN) out.push([range[0], range[1]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Where to seek to, if `time` is inside a segment not skipped yet; marks it as skipped. */
export function skipTarget(time: number, segments: Segment[], skipped: Set<number>): number | null {
  for (const [i, [start, end]] of segments.entries()) {
    if (!skipped.has(i) && time >= start && time < end - END_MARGIN) {
      skipped.add(i);
      return end;
    }
  }
  return null;
}

/** The YouTube video a page shows: watch, Shorts excluded (no sponsor segments), embeds. */
export function videoIdFrom(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const id =
    url.pathname === '/watch'
      ? url.searchParams.get('v')
      : /^\/embed\/([^/]+)/.exec(url.pathname)?.[1];
  return isVideoId(id) ? id : null;
}
