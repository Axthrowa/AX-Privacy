const SITE_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSite(site: unknown): site is string {
  return typeof site === 'string' && site.length <= 253 && SITE_RE.test(site);
}

export const MAX_KEPT_SITES = 500;

/** Valid sites only, lower-cased, without repeats, at most MAX_KEPT_SITES. */
export function siteList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const sites = raw
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v))
    .filter(isValidSite);
  return [...new Set(sites)].slice(0, MAX_KEPT_SITES);
}

export function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
