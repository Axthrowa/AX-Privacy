import { parse } from 'tldts';

/**
 * Registry zones only a government can register in: the `.gov` and `.mil` top-level domains and a
 * country's government second level (gov.tr, gov.uk, gouv.fr, gob.mx, go.jp, govt.nz, gv.at ...).
 * Checked against the public suffix list, so a private "go.co" or "gov.tr.example.com" never counts.
 */
const GOV_ZONE = /^(?:gov|mil|(?:gov|gob|gouv|govt|go|gv|gub|mil)\.[a-z]{2})$/;
/** Turkish municipalities, police and armed forces; India's and Canada's government zones. */
const GOV_ZONES_EXTRA = new Set(['bel.tr', 'pol.tr', 'tsk.tr', 'nic.in', 'gc.ca']);
/** Official government sites outside such zones. */
const GOV_DOMAINS = new Set([
  'admin.ch',
  'europa.eu',
  'canada.ca',
  'bund.de',
  'bundesregierung.de',
  'service-public.fr',
]);

/**
 * The government zone or domain `host` belongs to ("gov.tr", "europa.eu"), or null. Address only:
 * a page on an official zone can still be hacked, but the address itself cannot be faked.
 */
export function officialGov(host: string): string | null {
  const p = parse(host, { allowPrivateDomains: true });
  if (!p.isIcann || !p.publicSuffix) return null;
  if (GOV_ZONE.test(p.publicSuffix) || GOV_ZONES_EXTRA.has(p.publicSuffix)) return p.publicSuffix;
  return p.domain && GOV_DOMAINS.has(p.domain) ? p.domain : null;
}

/** Address words that claim a government: whole labels or label parts. */
const GOV_WORDS = new Set([
  'gov',
  'gob',
  'gouv',
  'govt',
  'egov',
  'edevlet',
  'devlet',
  'government',
]);
/** Inside one label ("turkiyegov", "edevletgiris"): only words too long to occur by chance. */
const GOV_PARTS = ['edevlet', 'government', 'turkiyegov', 'govtr'];

/**
 * The government word a non-government address uses ("turkiye-gov-tr.com",
 * "www.turkiye.gov.tr.login.example"), or null. Only call for hosts officialGov() rejected.
 */
export function govClaim(host: string): string | null {
  const labels = host.toLowerCase().split('.');
  for (const part of labels.flatMap((l) => l.split('-'))) {
    if (GOV_WORDS.has(part)) return part;
  }
  for (const label of labels) {
    const flat = label.replace(/-/g, '');
    const hit = GOV_PARTS.find((w) => flat.includes(w));
    if (hit) return hit;
  }
  return null;
}
