/**
 * AX-Privacy Filter Rule Compiler (Chrome MV3 DNR) - v2.6.0
 * Multi-tier priority selection model:
 *   Tier 1: Core Guaranteed List (most common ad/tracker networks)
 *   Tier 1.5: AdGuard Turkish Filter (network domains) + Pop-up/Redirect Ad Networks
 *   Tier 2: Intersection of EasyList & OISD (highest confidence overlap)
 *   Tier 3: AdGuard Base Filter & EasyPrivacy
 *   Tier 4: Remaining quota from OISD
 *   Tier 5: Final alphabetical sorting with sequential IDs 1..N.
 *
 * Dedicated Rulesets:
 *   - rules/ads_trackers.json: 25,000 static DNR block rules (IDs 1..25000)
 *   - rules/popups_redirects.json: Dedicated pop-under and click-hijacking block rules (IDs 30001..30500)
 *   - rules/cosmetic_rules.json: Two-layer cosmetic ad-hiding selectors ({ generic: [...], domains: { ... } })
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const OUTPUT_FILE = path.join(ROOT_DIR, 'rules', 'ads_trackers.json');
const TMP_FILE = path.join(ROOT_DIR, 'rules', 'ads_trackers.json.tmp');

const POPUPS_OUTPUT_FILE = path.join(ROOT_DIR, 'rules', 'popups_redirects.json');
const POPUPS_TMP_FILE = path.join(ROOT_DIR, 'rules', 'popups_redirects.json.tmp');

const COSMETIC_OUTPUT_FILE = path.join(ROOT_DIR, 'rules', 'cosmetic_rules.json');
const COSMETIC_TMP_FILE = path.join(ROOT_DIR, 'rules', 'cosmetic_rules.json.tmp');

const MIN_RULE_THRESHOLD = 5000;
const MAX_RULE_LIMIT = 25000; // Chrome static ruleset target is 25,000

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

// Dedicated Pop-up, Pop-under & Click-hijacking ad networks
const POPUP_REDIRECT_DOMAINS = [
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'exoclick.com',
  'adsterra.com',
  'onclickalgo.com',
  'monetag.com',
  'tsyndicate.com',
  'trafficstars.com',
  'hilltopads.net',
  'clickadu.com',
  'adcash.com',
  'adxprts.com',
  'bidvertiser.com',
  'yllix.com',
  'popmyads.com',
  'ad-maven.com',
  'richads.com',
  'rollerads.com',
  'trafficfactory.biz',
  'juicyads.com',
  'ero-advertising.com',
  'plugrush.com',
  'clickraine.com',
  'rtmark.net',
  'doublepimp.com',
  'galaksion.com',
  'clickaine.com',
  'clicksor.com',
  'adversal.com',
  'buzzcity.com',
  'infolinks.com',
  'chitika.com',
  'revenuehits.com',
  'popunder.net',
  'adbuffs.com',
  'clicky.com',
  'wigetmedia.com',
  'zeroredirect1.com',
  'zeroredirect2.com',
  'trafficholder.com',
  'fidelity-media.com',
  'cpmleader.com',
  'clicksor.net',
  'adbooth.com',
  'popmytraffic.com',
  'twinred.com',
  'adfox.ru',
  'advertises.ru',
  'popcorn-vod.tv',
  'directrev.com',
  'trafficjunky.net',
  'syndication.exoclick.com',
  'syndication.realsrv.com',
  'delivery.adrecover.com',
  'servenobid.com',
  'engine.phn.doublepimp.com',
  'serve.popads.net',
  'xml.popcash.net',
  's.mngts.net',
  'as.propellerads.com',
  'onclickads.net',
  'adxpansion.com',
  'adxpansion.net'
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
  },
  adguard_base: {
    name: 'AdGuard Base Filter',
    url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_2_Base/filter.txt'
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

  // Strip comments and metadata
  if (d.startsWith('#') || d.startsWith('!') || d.startsWith('[') || d.startsWith(';')) return null;

  // Skip exception rules (@@)
  if (d.startsWith('@@')) return null;

  // Skip cosmetic and element hiding rules (##, #@#, #?#)
  if (d.includes('##') || d.includes('#@#') || d.includes('#?#')) return null;

  // Skip page-breaking directives ($document, $popup, $csp, $badfilter)
  if (/\$(?:document|popup|csp|badfilter)\b/i.test(d)) return null;

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

  // Critical YouTube infrastructure exemption: Never block YouTube or its streaming/API endpoints
  if (
    d === 'youtube.com' ||
    d.endsWith('.youtube.com') ||
    d === 'googlevideo.com' ||
    d.endsWith('.googlevideo.com') ||
    d === 'ytimg.com' ||
    d.endsWith('.ytimg.com') ||
    d === 'ggpht.com' ||
    d.endsWith('.ggpht.com') ||
    d === 'youtubei.googleapis.com' ||
    d.endsWith('.youtubei.googleapis.com')
  ) {
    return null;
  }

  return d;
}

async function fetchSource(source) {
  console.log(`[build-rules] Fetching ${source.name}...`);
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AX-Privacy/2.6.0'
      },
      signal: AbortSignal.timeout(25000)
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
 * Generates dedicated pop-under and ad-redirect blocking rules
 * Range: IDs 30001..30500 (max 500 rules)
 */
function generatePopupsRedirectsRules(extraDomains = []) {
  const domainsSet = new Set();

  for (const d of POPUP_REDIRECT_DOMAINS) {
    const cleaned = cleanDomain(d);
    if (cleaned) domainsSet.add(cleaned);
  }

  if (Array.isArray(extraDomains)) {
    for (const d of extraDomains) {
      const cleaned = cleanDomain(d);
      if (cleaned) domainsSet.add(cleaned);
    }
  }

  const sorted = Array.from(domainsSet).sort().slice(0, 500);

  return sorted.map((domain, index) => ({
    id: 30001 + index,
    priority: 1,
    action: {
      type: 'block'
    },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest']
    }
  }));
}

/**
 * Parses two-layer CSS cosmetic rules:
 *   1. generic: Array of universal, safe ad container selectors (max 400)
 *   2. domains: Mapping of domain -> site-specific selectors
 */
function parseCosmeticRules(turkishText, baseText = '') {
  // Baseline curated universal selectors (safe, low-false-positive, high impact)
  const CURATED_GENERIC_SELECTORS = [
    'ins.adsbygoogle',
    '[data-ad-slot]',
    '[data-ad-client]',
    '[data-adunit]',
    '[data-ad-unit]',
    '[data-google-query-id]',
    'div[id^="google_ads_iframe"]',
    'div[id^="div-gpt-ad"]',
    'div[id^="ad-div-"]',
    'div[id^="ad_div_"]',
    'div[id^="dfp-ad-"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="adservice.google."]',
    '.ad-placement',
    '.ad-container',
    '.ad-banner',
    '.advertisement-container',
    '.adsbygoogle',
    '.ad-zone',
    '.ad-wrap',
    '.ad-wrapper',
    '.ad-slot',
    '.ad-box',
    '.ad-space',
    '.banner-ad',
    '.banner_ad',
    '.top-banner-ad',
    '.bottom-banner-ad',
    '.pageskin',
    '.page-skin',
    '.sticky-ad',
    '#sticky-ad',
    '.floating-ad',
    '.floating-banner',
    '.floating_banner',
    '.video-ad-overlay',
    '.click-overlay',
    '#click-overlay',
    '#pop-overlay',
    '.pop-overlay',
    '[id*="reklam"]:not(main):not(body):not(header):not(nav)',
    '[class*="reklam-"]:not(main):not(body):not(header):not(nav)',
    '[id*="sponsor-ad"]',
    '[class*="sponsor-ad"]',
    'a[target="_blank"] > img[src*=".gif"]',
    'a[target="_blank"] > img[src*=".webp"][src*="banner"]',
    'a[target="_blank"] > img[src*="reklam"]',
    'a[target="_blank"] > img[src*="bahis"]'
  ];

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

  const genericSet = new Set(CURATED_GENERIC_SELECTORS);
  const domainMap = {};

  for (const [domain, selectors] of Object.entries(CURATED_SITE_RULES)) {
    domainMap[domain] = new Set(selectors);
  }

  const rawSources = [turkishText, baseText].filter(Boolean);

  for (const text of rawSources) {
    if (typeof text !== 'string') continue;
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('!') || (line.startsWith('#') && !line.startsWith('##'))) continue;

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

      if (!selector) continue;

      // Discard scriptlets, procedural selectors and inline CSS style blocks
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

      // 1. Generic Selector (No domain specified, e.g. ##.ad-banner)
      if (!domainPart) {
        // Discard generic selectors that would match standard semantic HTML elements directly
        if (/^(body|html|main|article|section|nav|header|footer|div|span|p|a)$/i.test(selector)) {
          continue;
        }
        // Only accept safe class/id/attribute selectors for generic rules
        if (
          selector.startsWith('.') ||
          selector.startsWith('#') ||
          selector.startsWith('[') ||
          selector.startsWith('ins.')
        ) {
          if (genericSet.size < 350) {
            genericSet.add(selector);
          }
        }
        continue;
      }

      // 2. Domain-Specific Selector
      const domains = domainPart
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d && !d.startsWith('~') && /^[a-z0-9.-]+$/.test(d));

      if (domains.length === 0) continue;

      for (const d of domains) {
        if (!domainMap[d]) domainMap[d] = new Set();
        domainMap[d].add(selector);
      }
    }
  }

  // Sort generic selectors alphabetically
  const sortedGeneric = Array.from(genericSet).sort();

  // Sort domains alphabetically and selectors within each domain
  const sortedDomains = {};
  for (const domain of Object.keys(domainMap).sort()) {
    sortedDomains[domain] = Array.from(domainMap[domain]).sort();
  }

  return {
    generic: sortedGeneric,
    domains: sortedDomains
  };
}

async function main() {
  console.log('=== AX-Privacy Rule Compiler Starting (v2.6.0) ===');

  const [easylistText, oisdText, easyprivacyText, turkishText, baseText] = await Promise.all([
    fetchSource(SOURCES.easylist),
    fetchSource(SOURCES.oisd),
    fetchSource(SOURCES.easyprivacy),
    fetchSource(SOURCES.adguard_turkish),
    fetchSource(SOURCES.adguard_base)
  ]);

  const easylistSet = parseDomains(easylistText);
  const oisdSet = parseDomains(oisdText);
  const easyprivacySet = parseDomains(easyprivacyText);
  const turkishNetSet = parseDomains(turkishText);
  const baseNetSet = parseDomains(baseText);

  console.log(`[build-rules] Parsed EasyList: ${easylistSet.size} domains`);
  console.log(`[build-rules] Parsed OISD: ${oisdSet.size} domains`);
  console.log(`[build-rules] Parsed EasyPrivacy: ${easyprivacySet.size} domains`);
  console.log(`[build-rules] Parsed AdGuard Turkish: ${turkishNetSet.size} network domains`);
  console.log(`[build-rules] Parsed AdGuard Base: ${baseNetSet.size} network domains`);

  const totalRawCount =
    easylistSet.size + oisdSet.size + easyprivacySet.size + turkishNetSet.size + baseNetSet.size;
  if (totalRawCount < MIN_RULE_THRESHOLD) {
    console.error(
      `[build-rules] ERROR: Total parsed domains (${totalRawCount}) is below minimum threshold (${MIN_RULE_THRESHOLD}). Aborting.`
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

  // Tier 1.5: AdGuard Turkish Network Rules + Pop-up/Betting Networks
  let turkishCount = 0;
  for (const domain of turkishNetSet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      turkishCount++;
    }
  }
  for (const domain of POPUP_REDIRECT_DOMAINS) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    const cleaned = cleanDomain(domain);
    if (cleaned && !selectedDomains.has(cleaned)) {
      selectedDomains.add(cleaned);
      turkishCount++;
    }
  }
  console.log(`[build-rules] Tier 1.5 - AdGuard Turkish & Pop-up domains added: ${turkishCount}`);

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
  console.log(
    `[build-rules] Tier 2 - EasyList & OISD intersection domains added: ${intersectionCount}`
  );

  // Tier 3: AdGuard Base Filter & EasyPrivacy domains
  let baseCount = 0;
  for (const domain of baseNetSet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      baseCount++;
    }
  }
  for (const domain of easyprivacySet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      baseCount++;
    }
  }
  console.log(`[build-rules] Tier 3 - AdGuard Base & EasyPrivacy domains added: ${baseCount}`);

  // Tier 4: Remaining EasyList & OISD domains (if quota remains)
  let remainingCount = 0;
  for (const domain of easylistSet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      remainingCount++;
    }
  }
  for (const domain of oisdSet) {
    if (selectedDomains.size >= MAX_RULE_LIMIT) break;
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      remainingCount++;
    }
  }
  console.log(`[build-rules] Tier 4 - Remaining EasyList / OISD domains added: ${remainingCount}`);
  console.log(`[build-rules] Total selected domains: ${selectedDomains.size} (Target: ${MAX_RULE_LIMIT})`);

  // Tier 5: Final Alphabetical Sorting with sequential IDs 1..N
  const sortedFinalDomains = Array.from(selectedDomains).sort();
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

  // Atomic file write for rules/ads_trackers.json
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  const jsonContent = JSON.stringify(rules, null, 2);
  await fs.writeFile(TMP_FILE, jsonContent, 'utf8');

  const verifyAds = JSON.parse(await fs.readFile(TMP_FILE, 'utf8'));
  if (!Array.isArray(verifyAds) || verifyAds.length !== rules.length) {
    throw new Error('Verification failed: ads_trackers temp file corrupted.');
  }
  await fs.rename(TMP_FILE, OUTPUT_FILE);
  console.log(`[build-rules] Successfully wrote ${rules.length} rules to ${OUTPUT_FILE}`);

  // Generate and atomic write rules/popups_redirects.json
  const popupRules = generatePopupsRedirectsRules();
  const popupJson = JSON.stringify(popupRules, null, 2);
  await fs.writeFile(POPUPS_TMP_FILE, popupJson, 'utf8');

  const verifyPopups = JSON.parse(await fs.readFile(POPUPS_TMP_FILE, 'utf8'));
  if (!Array.isArray(verifyPopups) || verifyPopups.length !== popupRules.length) {
    throw new Error('Verification failed: popups_redirects temp file corrupted.');
  }
  await fs.rename(POPUPS_TMP_FILE, POPUPS_OUTPUT_FILE);
  console.log(`[build-rules] Successfully wrote ${popupRules.length} popup rules to ${POPUPS_OUTPUT_FILE}`);

  // Compile and atomic write rules/cosmetic_rules.json
  const cosmeticResult = parseCosmeticRules(turkishText, baseText);
  const cosmeticJson = JSON.stringify(cosmeticResult, null, 2);
  await fs.writeFile(COSMETIC_TMP_FILE, cosmeticJson, 'utf8');

  const verifyCosmetic = JSON.parse(await fs.readFile(COSMETIC_TMP_FILE, 'utf8'));
  if (
    typeof verifyCosmetic !== 'object' ||
    !Array.isArray(verifyCosmetic.generic) ||
    typeof verifyCosmetic.domains !== 'object'
  ) {
    throw new Error('Verification failed: cosmetic_rules temp file corrupted.');
  }
  await fs.rename(COSMETIC_TMP_FILE, COSMETIC_OUTPUT_FILE);
  console.log(
    `[build-rules] Successfully wrote ${verifyCosmetic.generic.length} generic and ${Object.keys(verifyCosmetic.domains).length} domain cosmetic rules to ${COSMETIC_OUTPUT_FILE}`
  );

  console.log('=== AX-Privacy Rule Compiler Finished (v2.6.0) ===');
}

export {
  parseCosmeticRules,
  parseDomains,
  cleanDomain,
  generatePopupsRedirectsRules,
  POPUP_REDIRECT_DOMAINS
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[build-rules] Fatal error:', err);
    process.exit(1);
  });
}
