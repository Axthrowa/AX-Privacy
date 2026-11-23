/**
 * Pop-under and ad-redirect signatures (ported from the v4 JS line). They catch ad-network
 * landing URLs that no `$popup` filter names yet.
 */

const AD_NAV_SIGNATURE =
  /\/afu\.php|\/ntfc\.php|in-page-push|\/pfe\/current\/|popunder|monetag|propellerads|adsterra|hilltopads|clickadu|exoclick|popads|popcash|tsyndicate|onclickalgo|highperformanceformat/i;

/** A URL that only an ad network's click or pop-under redirect produces. */
export function isPopunderUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  // Host and path only: a search for "popunder" is not an ad.
  if (AD_NAV_SIGNATURE.test(u.hostname + u.pathname)) return true;
  const q = u.search.toLowerCase();
  return (
    (/[?&]zone_?id=/.test(q) && /[?&]click_?id=/.test(q)) ||
    (/[?&]sub_?id=/.test(q) && /[?&]offer_?id=/.test(q))
  );
}

export interface CommitDetails {
  transitionType?: string;
  transitionQualifiers?: string[];
}

const USER_TRANSITIONS = new Set([
  'typed',
  'auto_bookmark',
  'generated',
  'keyword',
  'keyword_generated',
  'reload',
  'start_page',
  'auto_toplevel',
]);

/**
 * True only for a navigation the page started by itself (a script or meta refresh). Bookmarks,
 * typed URLs, reload, back/forward and the user's own link clicks are never page redirects.
 */
export function isPageRedirect(d: CommitDetails): boolean {
  const q = d.transitionQualifiers ?? [];
  if (q.includes('from_address_bar') || q.includes('forward_back')) return false;
  if (d.transitionType && USER_TRANSITIONS.has(d.transitionType)) return false;
  return q.includes('client_redirect');
}
