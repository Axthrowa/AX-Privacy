import { parse } from 'tldts';

/** Registrable domain (eTLD+1) of an http(s) URL, the hostname for IPs and single-label hosts. */
export function siteKey(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const p = parse(u.hostname, { allowPrivateDomains: true });
  if (p.isIp) return u.hostname;
  return p.domain ?? u.hostname;
}

export function isIp(site: string): boolean {
  return parse(site).isIp === true;
}
