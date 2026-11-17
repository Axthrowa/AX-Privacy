import { isVideoId } from '../../shared/messages.ts';
import { isSponsorCategory, SPONSOR_CATEGORIES } from '../../shared/sponsor.ts';
import type { SkipMode, SponsorCategory } from '../../shared/sponsor.ts';
import type { PlanSegment, Segment, SegmentAction } from '../../shared/types.ts';

/** SponsorBlock's public API (https://wiki.sponsor.ajay.app/w/API_Docs); data is CC BY-NC-SA 4.0. */
export const SPONSORBLOCK_API = 'https://sponsor.ajay.app';
/** 4 hex characters: the server sees one of 65,536 buckets, each shared by many videos. */
const PREFIX_LENGTH = 4;
/** Stop this short of the segment end, so a seek that lands just before it does not loop. */
const END_MARGIN = 0.5;
/** A segment made for a video this much longer or shorter is for another cut (or has an ad in it). */
const MAX_DURATION_DRIFT = 2;
const ACTIONS: readonly SegmentAction[] = ['skip', 'mute', 'full', 'poi', 'chapter'];

export async function hashPrefix(videoId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, PREFIX_LENGTH);
}

/** Always every category and action: the same URL for every user, whatever they switched on. */
export async function segmentsUrl(videoId: string): Promise<string> {
  const categories = encodeURIComponent(JSON.stringify(SPONSOR_CATEGORIES));
  const actions = encodeURIComponent(JSON.stringify(ACTIONS));
  return `${SPONSORBLOCK_API}/api/skipSegments/${await hashPrefix(videoId)}?categories=${categories}&actionTypes=${actions}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isAction = (v: unknown): v is SegmentAction => ACTIONS.includes(v as SegmentAction);

/** Picks this video's segments out of a hash-prefix response; anything malformed is dropped. */
export function segmentsFor(body: unknown, videoId: string): Segment[] {
  if (!Array.isArray(body)) return [];
  const entry: unknown = body.find((e) => isObj(e) && e.videoID === videoId);
  if (!isObj(entry) || !Array.isArray(entry.segments)) return [];
  const out: Segment[] = [];
  for (const s of entry.segments) {
    if (!isObj(s) || !isSponsorCategory(s.category)) continue;
    const action = s.actionType ?? 'skip';
    const range = s.segment;
    if (!isAction(action) || !Array.isArray(range) || !isTime(range[0]) || !isTime(range[1])) {
      continue;
    }
    const [start, end] = range;
    if (end < start) continue;
    // A skip or mute shorter than the margin would do nothing; a highlight or label has no length.
    if ((action === 'skip' || action === 'mute') && end - start <= END_MARGIN) continue;
    const duration = isTime(s.videoDuration) ? s.videoDuration : 0;
    out.push({ start, end, category: s.category, action, duration });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Segments the user wants to see at all, each with its category's mode. */
export function planFor(
  segments: Segment[],
  modes: Readonly<Record<SponsorCategory, SkipMode>>,
): PlanSegment[] {
  return segments.flatMap((s) =>
    modes[s.category] === 'off' ? [] : [{ ...s, mode: modes[s.category] }],
  );
}

/** Drops segments made for a different length of video; a duration of 0 means unknown. */
export function matchingDuration<T extends Segment>(segments: T[], duration: number): T[] {
  if (!(duration > 0)) return segments;
  return segments.filter(
    (s) => s.duration === 0 || Math.abs(s.duration - duration) <= MAX_DURATION_DRIFT,
  );
}

/** Index of the segment to act on at `time`, not handled yet; the last half second is left alone. */
export function segmentAt(
  time: number,
  segments: readonly Pick<Segment, 'start' | 'end'>[],
  handled: ReadonlySet<number>,
): number | null {
  for (const [i, { start, end }] of segments.entries()) {
    if (!handled.has(i) && time >= start && time < end - END_MARGIN) return i;
  }
  return null;
}

/** The YouTube video a page shows: watch (YouTube Music too) and embeds; Shorts have no segments. */
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
