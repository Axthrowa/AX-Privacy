/** Click-hijack scripts open the ad in this window after the click. */
export const POPUP_ARM_MS = 1500;

function resolved(base: string, url: string): string | null {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

/**
 * shortcut: last two labels, three under a two-letter country suffix such as `co.uk`. This file runs
 * in every frame, so the 270 KB public suffix list stays out; a wrong answer only skips a popup block
 * on unusual suffixes. Upgrade if real popups get through on such a site.
 */
function baseDomain(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (/^[\d.]+$|:/.test(u.hostname)) return u.hostname;
  const labels = u.hostname.split('.');
  const tail = labels.at(-1) ?? '';
  const second = labels.at(-2) ?? '';
  const take = tail.length === 2 && second.length <= 3 && labels.length > 2 ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** about:blank and a different site. Same-site players and logins stay allowed. */
export function isForeignPopup(pageUrl: string, destUrl: string): boolean {
  const href = resolved(pageUrl, destUrl);
  if (!href) return false;
  const dest = new URL(href);
  if (dest.protocol === 'about:') return true;
  const page = baseDomain(pageUrl);
  const site = baseDomain(href);
  return page !== null && site !== null && page !== site;
}

/** Where people are legitimately sent in a new window: sign-in, payment, sharing. */
const TRUSTED_DESTINATIONS = new Set([
  'google.com',
  'facebook.com',
  'apple.com',
  'microsoft.com',
  'microsoftonline.com',
  'live.com',
  'github.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'reddit.com',
  'pinterest.com',
  'whatsapp.com',
  'telegram.me',
  't.me',
  'discord.com',
  'twitch.tv',
  'paypal.com',
  'stripe.com',
  'amazon.com',
  'yahoo.com',
  'okta.com',
  'auth0.com',
]);

/** Script URLs on a call stack, nearest first. Stack formats differ, URLs in them do not. */
export function callersOf(stack: string | undefined): string[] {
  return [...new Set(stack?.match(/https?:\/\/[^\s)'"]+?(?=:\d+:\d+|[\s)'"]|$)/g) ?? [])];
}

export interface ClickContext {
  /** The click landed on something meant to be clicked: a button, or a pointer-cursor element. */
  onControl: boolean;
  /** Scripts on the stack of the call opening the window. */
  callers: readonly string[];
}

/** A link whose only job is to run a script: `#`, `javascript:`. It says nothing about the target. */
export function isScriptLink(pageUrl: string, href: string): boolean {
  if (href.startsWith('javascript:')) return true;
  const a = resolved(pageUrl, href);
  const b = resolved(pageUrl, pageUrl);
  return a !== null && b !== null && a.split('#')[0] === b.split('#')[0];
}

/** A script from another site, with no part of the page's own code in the call. */
function foreignCaller(pageUrl: string, destUrl: string, callers: readonly string[]): boolean {
  if (callers.length === 0) return false;
  const page = baseDomain(pageUrl);
  const name = page?.split('.')[0] ?? '';
  const dest = baseDomain(destUrl);
  return callers.every((c) => {
    const site = baseDomain(c);
    // A site's own asset host usually carries its name: reddit.com, redditstatic.com.
    if (site === page || (name.length >= 4 && site?.includes(name))) return false;
    return site !== dest;
  });
}

/**
 * A click-time new window is an ad when it leaves the site and is not the link under the cursor.
 * A full-page third-party overlay is an ad even when the opened URL matches that overlay.
 * Without a link to compare, sign-in and share buttons must keep working, while ad scripts that hook
 * every click must not: the difference is what was clicked and whose code asked for the window.
 */
export function shouldBlockOpen(
  pageUrl: string,
  destUrl: string,
  clickedHref: string | null,
  overlay: boolean,
  click: ClickContext = { onControl: false, callers: [] },
): boolean {
  if (!isForeignPopup(pageUrl, destUrl)) return false;
  if (overlay) return true;
  const got = resolved(pageUrl, destUrl);
  if (clickedHref) {
    const want = resolved(pageUrl, clickedHref);
    return want === null || got === null || want !== got;
  }
  const dest = got ? baseDomain(got) : null;
  if (dest && TRUSTED_DESTINATIONS.has(dest)) return false;
  if (!click.onControl) return true;
  return foreignCaller(pageUrl, got ?? destUrl, click.callers);
}
