/**
 * Ad handling for common web video players outside YouTube and Twitch. Only switched on where a
 * known player shows up (see content/video-generic.ts), and every step leaves the content alone
 * when unsure: a playlist that would lose all its segments, or a config that is not an object,
 * passes through unchanged.
 */

/** Globals the players set; the layer wakes up only when one of them appears. */
export const PLAYER_GLOBALS = ['jwplayer', 'Hls', 'shaka', 'dashjs', 'videojs'] as const;

/**
 * Ad (VAST) requests of the two server-side ad networks most web players use besides Google's:
 * FreeWheel and SpotX. Google IMA already gets a stand-in script from the lists.
 */
export const VAST_REQUEST_REGEX =
  '^https?://[a-z0-9.-]*\\.(?:fwmrm\\.net/ad/g/1|spotxchange\\.com/vast/)';

/** Containers players put their ad <video> in, while the ad plays. */
export const AD_VIDEO_SELECTOR = [
  '.jw-flag-ads video',
  '.vjs-ad-playing video',
  '.ima-ad-container video',
  '.fp-ad video',
].join(', ');

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JW Player: the ad schedule lives in `advertising` (whole player) and `adschedule` (per item). */
export function pruneJwConfig(config: unknown): boolean {
  if (!isObj(config)) return false;
  let changed = false;
  if ('advertising' in config) changed = Reflect.deleteProperty(config, 'advertising');
  const items = Array.isArray(config.playlist) ? config.playlist : [];
  for (const item of items) {
    if (isObj(item) && 'adschedule' in item) {
      Reflect.deleteProperty(item, 'adschedule');
      changed = true;
    }
  }
  return changed;
}

const isAdDaterange = (row: string) =>
  row.startsWith('#EXT-X-DATERANGE') &&
  (row.includes('com.apple.hls.interstitial') || /SCTE35-OUT=/.test(row));

/**
 * HLS media playlist: drops the segments of a marked ad break (`#EXT-X-CUE-OUT` until
 * `#EXT-X-CUE-IN`) and interstitial ads (`#EXT-X-DATERANGE`). A master playlist, a playlist with no
 * marks, or one that would be left with no segment at all is returned as it was.
 */
export function stripAdBreaks(m3u8: string): string {
  if (!m3u8.startsWith('#EXTM3U') || !m3u8.includes('#EXTINF')) return m3u8;
  const rows = m3u8.replaceAll('\r', '').split('\n');
  const out: string[] = [];
  let inBreak = false;
  let changed = false;
  let segments = 0;
  for (const row of rows) {
    if (row.startsWith('#EXT-X-CUE-OUT') && !row.startsWith('#EXT-X-CUE-OUT-CONT')) {
      inBreak = true;
      changed = true;
      continue;
    }
    if (row.startsWith('#EXT-X-CUE-IN')) {
      inBreak = false;
      continue;
    }
    if (isAdDaterange(row)) {
      changed = true;
      continue;
    }
    if (inBreak) {
      // Segment tags and URIs of the break go; playlist-wide tags stay.
      if (row.startsWith('#EXT-X-ENDLIST') || row.startsWith('#EXT-X-KEY')) out.push(row);
      continue;
    }
    if (row.startsWith('#EXTINF')) segments++;
    out.push(row);
  }
  return changed && segments > 0 ? out.join('\n') : m3u8;
}
