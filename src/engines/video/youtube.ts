import YT from './youtube-ads.json' with { type: 'json' };

/**
 * What YouTube calls its ad fields and elements. Data only (names and CSS selectors, never code),
 * kept in a JSON file so a renamed field is fixed by editing data and shipped with the next build.
 * - playerKeys: player response fields that schedule ads; the video never depends on them.
 * - xhrPaths: API paths whose XMLHttpRequest responses carry a player response.
 * - skipButtons, blockerWarning: the player's "Skip" button and the ad blocker warning.
 * - cardContainers / cardAdMarkers / cardNested: feed cards that hold an ad component.
 */
export const YT_DATA: Readonly<typeof YT> = YT;

/** sessionStorage key set in a tab where YouTube warned about the ad blocker; that tab backs off. */
export const YT_BACKOFF_KEY = 'ax-youtube-backoff';

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
    for (const k of YT_DATA.playerKeys) {
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

/** Responses may start with a guard line YouTube adds against JSON hijacking. */
const XSSI = ")]}'";

/**
 * The same pruning for a response read as text (XMLHttpRequest). Returns the text unchanged when it
 * is not JSON or holds no ad fields, so anything unexpected passes through untouched.
 */
export function pruneAdsText(text: string, parse: (t: string) => unknown = JSON.parse): string {
  const guarded = text.startsWith(XSSI);
  const body = guarded ? text.slice(XSSI.length) : text;
  let value: unknown;
  try {
    value = parse(body);
  } catch {
    return text;
  }
  if (!pruneAds(value)) return text;
  return (guarded ? `${XSSI}\n` : '') + JSON.stringify(value);
}

/** Feed cards that carry one of YouTube's ad components (innermost card only). */
export function sponsoredCardSelector(): string {
  const any = (list: readonly string[]) => `:is(${list.join(', ')})`;
  return `${any(YT_DATA.cardContainers)}:has(${YT_DATA.cardAdMarkers.join(', ')}):not(:has(${any(YT_DATA.cardNested)}))`;
}

/** The stylesheet for sponsored cards: outlined with a label, or hidden. Written by the build. */
export function sponsoredCss(mode: 'mark' | 'hide'): string {
  const sel = sponsoredCardSelector();
  if (mode === 'hide')
    return `/* AX Privacy: hides YouTube ad cards. */
${sel} { display: none !important; }
`;
  return `/* AX Privacy: marks YouTube ad cards the lists leave visible. */
${sel} { outline: 2px dashed #f5b041 !important; outline-offset: 2px !important; position: relative !important; }
${sel}::before { content: 'Sponsorlu · AX'; position: absolute; top: 4px; left: 4px; z-index: 10; padding: 2px 6px; border-radius: 4px; background: #f5b041; color: #1a1200; font: 600 11px/1.4 system-ui, sans-serif; pointer-events: none; }
`;
}
