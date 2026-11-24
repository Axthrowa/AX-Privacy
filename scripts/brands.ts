/**
 * Builds the lookalike-domain brand set (src/engines/security/brands.json) from the cached cookie
 * notice lists: sites that show a cookie banner are mainstream businesses (shops, banks, news,
 * services), and how many rules name a site says how widely used it is. Offline: reads
 * filters-cache/ only. Excluded sites are dropped before anything is counted.
 *
 * Usage: node scripts/brands.ts
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'tldts';
import { BRANDS } from '../src/engines/security/heuristics.ts';
import { mentionsExcluded } from './excluded.ts';

const root = resolve(import.meta.dirname, '..');
const SOURCES = [
  'secure.fanboy.co.nz_fanboy-cookiemonster.txt',
  'secure.fanboy.co.nz_easylist_cookie_specific_uBO.txt',
];
const MAX_BRANDS = 5000;
/** Shorter names are real words or other brands' typos too often. */
const MIN_LABEL = 6;
const MAX_DOMAINS = 8;
/** Adult sites are no brand a phishing page imitates, and their names stay out of the build. */
const ADULT =
  /porn|sex|xxx|adult|nude|escort|hentai|fetish|erotic|nsfw|milf|amateur|shemale|gay|tube\d/i;
/** Adult sites whose names hold none of those words; SHA-256 of the name without trailing digits. */
const ADULT_HASHES: ReadonlySet<string> = new Set([
  'a84dee6258e6f990d2d9dff3f662507b787c4b36ab7d8f6843affa6a0374ed13',
  '3d5cad55386ba3f1bc699b49d0ebe7a2815c2a2d15ced68c4ce3ac29dfc621c8',
  '110e53f01476b1946b6202e98d5e4bcd675efec1db53642819f0d8d60cf1cdb8',
  '2860200a6dfd75ca4272dc8fcfd45876138a1eee3459055f95150363f890cde2',
  'cdbedf168fca8450f59fb893988fc417de8cf42aaea1dd9ad254e914f228ef38',
  'e56ac6f7a2ff3b8bde7508a0ac1b96e6db99325a0982a2114325099064ff39a6',
]);
const adult = (label: string) =>
  ADULT.test(label) ||
  ADULT_HASHES.has(createHash('sha256').update(label.replace(/\d+$/, '')).digest('hex'));

const count = new Map<string, number>();
const domains = new Map<string, Set<string>>();

for (const file of SOURCES) {
  const text = await readFile(resolve(root, 'filters-cache', file), 'utf8');
  for (const line of text.split('\n')) {
    if (line.startsWith('!') || mentionsExcluded(line)) continue;
    // "a.com,b.co.uk##..." and "||a.com^$..." both name the site first.
    const head = /^([^#$|]+)#[@?$%]?#/.exec(line)?.[1] ?? /^\|\|([^/^$*]+)/.exec(line)?.[1];
    if (!head) continue;
    for (const raw of head.split(',')) {
      const host = raw.trim().toLowerCase();
      if (!host || host.startsWith('~') || host.includes('*')) continue;
      const p = parse(host, { allowPrivateDomains: true });
      const label = p.domainWithoutSuffix;
      if (!p.domain || !label || !p.isIcann || label.length < MIN_LABEL) continue;
      if (!/^[a-z0-9-]+$/.test(label) || label in BRANDS || adult(label)) continue;
      count.set(label, (count.get(label) ?? 0) + 1);
      const set = domains.get(label) ?? new Set<string>();
      set.add(p.domain);
      domains.set(label, set);
    }
  }
}

const top = [...count.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, MAX_BRANDS)
  .map(([label]) => [label, [...(domains.get(label) ?? [])].sort().slice(0, MAX_DOMAINS)])
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

await writeFile(resolve(root, 'src/engines/security/brands.json'), `${JSON.stringify(top)}\n`);
console.log(`${top.length} brands from ${count.size} names`);
