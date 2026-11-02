/** Fields of a YouTube player response that schedule ads; the video itself never depends on them. */
const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'] as const;

/** Sites (with their subdomains: www, m, music) the YouTube scripts run on. */
export const YOUTUBE_SITES = ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com'] as const;

/** Sites the Twitch playlist filter runs on, subdomains included (www, player, m). */
export const TWITCH_SITES = ['twitch.tv'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

const isAdEntry = (e: unknown) => {
  const cmd = isObj(e) && isObj(e.command) ? e.command : null;
  const reel = cmd && isObj(cmd.reelWatchEndpoint) ? cmd.reelWatchEndpoint : null;
  return !!(reel && isObj(reel.adClientParams) && reel.adClientParams.isAd);
};

function pruneOne(o: Obj): boolean {
  let changed = false;
  for (const target of [o, o.playerResponse]) {
    if (!isObj(target)) continue;
    for (const k of AD_KEYS) {
      if (k in target) {
        Reflect.deleteProperty(target, k);
        changed = true;
      }
    }
  }
  // Shorts: ads are entries of the reel sequence.
  for (const holder of [o, o.reelWatchSequenceResponse]) {
    if (!isObj(holder) || !Array.isArray(holder.entries)) continue;
    const kept = holder.entries.filter((e) => !isAdEntry(e));
    if (kept.length !== holder.entries.length) {
      holder.entries = kept;
      changed = true;
    }
  }
  return changed;
}

/**
 * Removes ad instructions from a parsed YouTube response, in place. Only looks at the top level
 * (and `playerResponse`), so it stays cheap enough to run on every `JSON.parse`.
 * Watch-page navigations return an array of such objects.
 */
export function pruneAds(value: unknown): boolean {
  if (Array.isArray(value)) {
    let changed = false;
    for (const v of value) if (isObj(v) && pruneOne(v)) changed = true;
    return changed;
  }
  return isObj(value) && pruneOne(value);
}
