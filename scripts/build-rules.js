/**
 * AX-Privacy Filter Rule Compiler (Chrome MV3 DNR)
 * Multi-tier priority selection model:
 *   1. Core Guaranteed List (most common ad/tracker networks)
 *   2. Intersection of EasyList & OISD (highest confidence overlap)
 *   3. Remaining quota from EasyList & EasyPrivacy
 *   4. Remaining quota from OISD
 *   5. Final alphabetical sorting of selected domains with sequential 1..N IDs.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'rules', 'ads_trackers.json');
const TMP_FILE = path.join(ROOT_DIR, 'rules', 'ads_trackers.json.tmp');
const COSMETIC_OUTPUT_FILE = path.join(ROOT_DIR, 'rules', 'cosmetic_rules.json');
const COSMETIC_TMP_FILE = path.join(ROOT_DIR, 'rules', 'cosmetic_rules.json.tmp');

const MIN_RULE_THRESHOLD = 5000;
const MAX_RULE_LIMIT = 25000; // Chrome static ruleset limit is 30,000

// 1. Core Guaranteed List: Must ALWAYS be in the ruleset regardless of alphabetical slice
const CORE_GUARANTEED_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'taboola.com',
  'outbrain.com',
  'pubmatic.com',
  'criteo.com',
  'criteo.net',
  'rubiconproject.com',
  'openx.net',
  'adnxs.com',
  'amazon-adsystem.com',
  'scorecardresearch.com',
  'popads.net',
  'propellerads.com',
  'adservice.google.com',
  'an.yandex.ru',
  'yandexadexchange.net',
  'smartadserver.com',
  'adroll.com',
  'applovin.com',
  'unityads.unity3d.com',
  'vungle.com',
  'inmobi.com',
  'mgid.com',
  'revcontent.com',
  'trafficjunky.com',
  'exoclick.com',
  'hotjar.com',
  'clarity.ms',
  'quantserve.com',
  'chartbeat.com',
  'casalemedia.com',
  'advertising.com',
  'moatads.com',
  'zedo.com',
  'adcolony.com'
];

const SOURCES = {
  easylist: {
    name: 'EasyList (Firebog mirror)',
    url: 'https://v.firebog.net/hosts/Easylist.txt'
  },
  oisd: {
    name: 'OISD (small)',
    url: 'https://small.oisd.nl/'
  },
  easyprivacy: {
    name: 'EasyPrivacy (Firebog mirror)',
    url: 'https://v.firebog.net/hosts/Easyprivacy.txt'
  },
  adguard_turkish: {
    name: 'AdGuard Turkish Filter',
    url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_13_Turkish/filter.txt'
  }
};

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IP_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const EXCLUDED_HOSTS = new Set([
  'localhost',
  'local',
  'broadcasthost',
  'localdomain',
  'lan',
  'home.arpa',
  'example.com',
  'example.org',
  'example.net'
]);

function cleanDomain(raw) {
  if (!raw) return null;
  let d = raw.trim().toLowerCase();

  // Strip comments
  if (d.startsWith('#') || d.startsWith('!') || d.startsWith('[')) return null;

  // Handle hosts format: "0.0.0.0 domain" or "127.0.0.1 domain"
  const hostsMatch = d.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)/);
  if (hostsMatch) {
    d = hostsMatch[1];
  }

  // Handle ABP filter format: "||domain.com^" or "||domain.com^$third-party"
  if (d.startsWith('||')) {
    d = d.slice(2);
    const caretIdx = d.indexOf('^');
    if (caretIdx !== -1) {
      d = d.slice(0, caretIdx);
    }
    const slashIdx = d.indexOf('/');
    if (slashIdx !== -1) {
      d = d.slice(0, slashIdx);
    }
  }

  // Strip trailing periods or paths
  d = d.replace(/[/:^$].*$/, '').replace(/\.+$/, '').trim();

  // Strip port
  d = d.replace(/:\d+$/, '');

  if (d.length < 3 || d.length > 253) return null;
  if (IP_REGEX.test(d)) return null;
  if (EXCLUDED_HOSTS.has(d)) return null;
  if (!DOMAIN_REGEX.test(d)) return null;

  return d;
}

async function fetchSource(source) {
  console.log(`[build-rules] Fetching ${source.name}...`);
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AX-Privacy/2.1'
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      console.warn(`[build-rules] Warning: ${source.name} returned HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();
    console.log(`[build-rules] Successfully fetched ${source.name} (${text.length} bytes)`);
    return text;
  } catch (err) {
    console.warn(`[build-rules] Warning: Failed to fetch ${source.name}: ${err.message}`);
    return null;
  }
}

function parseDomains(text) {
  const set = new Set();
  if (!text) return set;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const d = cleanDomain(line);
    if (d) set.add(d);
  }
  return set;
}

/**
 * Parses domain-specific standard CSS cosmetic rules from AdGuard Turkish Filter.
 * Discards scriptlets (##+js), cosmetic exceptions (#@#), inline CSS injections (#$#),
 * and non-standard pseudo-classes (:has, :xpath, :-abp-).
 * Produces a deterministic sorted mapping: { "domain.com": ["selector1", "selector2"] }
 */
function parseCosmeticRules(text) {
  const map = {};

  // Curated baseline selectors for netprime.me and Turkish movie/streaming platforms
  const CURATED_SITE_RULES = {
    'netprime.me': [
      '.ad-banner',
      '.click-overlay',
      '.fixed-gif-banner',
      '.floating-ad',
      '.sticky-ad',
      '.video-ad-overlay',
      '[class*="reklam-"]',
      '[id*="reklam"]',
      'a[target="_blank"] > img[src*=".gif"]',
      'a[target="_blank"] > img[src*=".webp"]'
    ]
  };

  for (const [domain, selectors] of Object.entries(CURATED_SITE_RULES)) {
    map[domain] = new Set(selectors);
  }

  if (!text || typeof text !== 'string') {
    const finalMap = {};
    for (const d of Object.keys(map).sort()) {
      finalMap[d] = Array.from(map[d]).sort();
    }
    return finalMap;
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('!') || line.startsWith('#')) continue;

    // Discard non-standard cosmetic directives
    if (
      line.includes('#@#') ||
      line.includes('#$#') ||
      line.includes('#$?#') ||
      line.includes('#%#')
    ) {
      continue;
    }

    if (!line.includes('##')) continue;

    const idx = line.indexOf('##');
    const domainPart = line.slice(0, idx).trim();
    const selector = line.slice(idx + 2).trim();

    if (!domainPart || !selector) continue;

    // Discard scriptlets, procedural selectors and CSS rule bodies
    if (
      selector.startsWith('+js(') ||
      selector.includes(':has(') ||
      selector.includes(':xpath(') ||
      selector.includes(':-abp-') ||
      selector.includes('{') ||
      selector.includes('}')
    ) {
      continue;
    }

    // Extract valid domain list (discard negated domains starting with ~)
    const domains = domainPart
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d && !d.startsWith('~') && /^[a-z0-9.-]+$/.test(d));

    if (domains.length === 0) continue;

    for (const d of domains) {
      if (!map[d]) map[d] = new Set();
      map[d].add(selector);
    }
  }

  // Sort domains alphabetically and selectors alphabetically
  const sortedMap = {};
  for (const domain of Object.keys(map).sort()) {
    sortedMap[domain] = Array.from(map[domain]).sort();
  }

  return sortedMap;
}

async function main() {
  console.log('=== AX-Privacy Rule Compiler Starting ===');

  const [easylistText, oisdText, easyprivacyText, turkishText] = await Promise.all([
    fetchSource(SOURCES.easylist),
    fetchSource(SOURCES.oisd),
    fetchSource(SOURCES.easyprivacy),
    fetchSource(SOURCES.adguard_turkish)
  ]);

  const easylistSet = parseDomains(easylistText);
  const oisdSet = parseDomains(oisdText);
  const easyprivacySet = parseDomains(easyprivacyText);
  const turkishNetSet = parseDomains(turkishText);

  console.log(`[build-rules] Parsed EasyList: ${easylistSet.size} domains`);
  console.log(`[build-rules] Parsed OISD: ${oisdSet.size} domains`);
  console.log(`[build-rules] Parsed EasyPrivacy: ${easyprivacySet.size} domains`);
  console.log(`[build-rules] Parsed AdGuard Turkish: ${turkishNetSet.size} network domains`);

  const totalRawCount = easylistSet.size + oisdSet.size + easyprivacySet.size + turkishNetSet.size;
  if (totalRawCount < MIN_RULE_THRESHOLD) {
    console.error(
      `[build-rules] ERROR: Total parsed domains (${totalRawCount}) is below minimum threshold (${MIN_RULE_THRESHOLD}). Aborting without modifying existing rules.`
    );
    process.exit(1);
  }

  const selectedDomains = new Set();

  // Tier 1: Core Guaranteed List
  let guaranteedCount = 0;
  for (const domain of CORE_GUARANTEED_DOMAINS) {
    const cleaned = cleanDomain(domain);
    if (cleaned) {
      selectedDomains.add(cleaned);
      guaranteedCount++;
    }
  }
  console.log(`[build-rules] Tier 1 - Core guaranteed domains added: ${guaranteedCount}`);

  // Tier 1.5: AdGuard Turkish Network Rules (Priority Turkish ad & betting domains)
  let turkishCount = 0;
  for (const domain of turkishNetSet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      turkishCount++;
    }
  }
  console.log(`[build-rules] Tier 1.5 - AdGuard Turkish network domains added: ${turkishCount}`);

  // Tier 2: Intersection of EasyList and OISD (Highest confidence agreement)
  let intersectionCount = 0;
  for (const domain of easylistSet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (oisdSet.has(domain)) {
      if (!selectedDomains.has(domain)) {
        selectedDomains.add(domain);
        intersectionCount++;
      }
    }
  }
  console.log(`[build-rules] Tier 2 - EasyList & OISD intersection domains added: ${intersectionCount}`);

  // Tier 3: Remaining EasyList & EasyPrivacy domains
  let easylistRemainingCount = 0;
  for (const domain of easylistSet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      easylistRemainingCount++;
    }
  }
  for (const domain of easyprivacySet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      easylistRemainingCount++;
    }
  }
  console.log(`[build-rules] Tier 3 - Remaining EasyList / EasyPrivacy domains added: ${easylistRemainingCount}`);

  // Tier 4: Remaining OISD domains (if quota remains)
  let oisdRemainingCount = 0;
  for (const domain of oisdSet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      oisdRemainingCount++;
    }
  }
  console.log(`[build-rules] Tier 4 - Remaining OISD domains added: ${oisdRemainingCount}`);
  console.log(`[build-rules] Total selected domains: ${selectedDomains.size} (Limit: ${MAX_RULE_LIMIT})`);

  // Tier 5: Final Alphabetical Sorting of the selected domains (produces clean, deterministic git diffs)
  const sortedFinalDomains = Array.from(selectedDomains).sort();

  // Transform into valid Chrome MV3 DeclarativeNetRequest rules with sequential IDs 1..N
  const RESOURCE_TYPES = ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping'];

  const rules = sortedFinalDomains.map((domain, index) => ({
    id: index + 1,
    priority: 1,
    action: {
      type: 'block'
    },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: RESOURCE_TYPES
    }
  }));

  // Atomic file write for ads_trackers.json: write to .tmp then rename
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  const jsonContent = JSON.stringify(rules, null, 2);
  await fs.writeFile(TMP_FILE, jsonContent, 'utf8');

  // Verify the tmp file parses correctly
  const verify = JSON.parse(await fs.readFile(TMP_FILE, 'utf8'));
  if (!Array.isArray(verify) || verify.length !== rules.length) {
    throw new Error('Verification failed: ads_trackers temp file corrupted.');
  }

  await fs.rename(TMP_FILE, OUTPUT_FILE);
  console.log(`[build-rules] Successfully wrote ${rules.length} prioritized rules to ${OUTPUT_FILE}`);

  // Compile and write rules/cosmetic_rules.json
  const cosmeticMap = parseCosmeticRules(turkishText);
  const cosmeticJson = JSON.stringify(cosmeticMap, null, 2);
  await fs.writeFile(COSMETIC_TMP_FILE, cosmeticJson, 'utf8');

  const verifyCosmetic = JSON.parse(await fs.readFile(COSMETIC_TMP_FILE, 'utf8'));
  if (typeof verifyCosmetic !== 'object' || Array.isArray(verifyCosmetic)) {
    throw new Error('Verification failed: cosmetic_rules temp file corrupted.');
  }

  await fs.rename(COSMETIC_TMP_FILE, COSMETIC_OUTPUT_FILE);
  console.log(
    `[build-rules] Successfully wrote ${Object.keys(cosmeticMap).length} cosmetic domain rules to ${COSMETIC_OUTPUT_FILE}`
  );
  console.log('=== AX-Privacy Rule Compiler Finished ===');
}

export {
  parseCosmeticRules,
  parseDomains,
  cleanDomain
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[build-rules] Fatal error:', err);
    process.exit(1);
  });
}
