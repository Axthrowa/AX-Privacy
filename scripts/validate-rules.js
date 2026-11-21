/**
 * AX-Privacy DNR Rules Validator (v2.6.0)
 * Validates syntax, integrity, unique IDs, resource types, and MV3 limits
 * for:
 *   - manifest.json (3 declared static rulesets)
 *   - rules/ads_trackers.json (25,000 rules, IDs 1..25000)
 *   - rules/url_clean.json (redirect rules)
 *   - rules/popups_redirects.json (dedicated pop-up/redirect rules, IDs 30001..30500)
 *   - rules/cosmetic_rules.json (two-layer: generic + domains)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const ADS_RULES_PATH = path.join(ROOT_DIR, 'rules', 'ads_trackers.json');
const URL_CLEAN_PATH = path.join(ROOT_DIR, 'rules', 'url_clean.json');
const POPUPS_RULES_PATH = path.join(ROOT_DIR, 'rules', 'popups_redirects.json');
const COSMETIC_RULES_PATH = path.join(ROOT_DIR, 'rules', 'cosmetic_rules.json');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');

const MANDATORY_AD_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'taboola.com',
  'outbrain.com'
];

const VALID_RESOURCE_TYPES = new Set([
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other'
]);

async function validateManifest() {
  console.log('[validate-rules] Validating manifest.json...');
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw);

  if (manifest.manifest_version !== 3) {
    throw new Error(`manifest_version must be 3, found ${manifest.manifest_version}`);
  }

  const dnr = manifest.declarative_net_request;
  if (!dnr || !Array.isArray(dnr.rule_resources)) {
    throw new Error('manifest.json is missing declarative_net_request.rule_resources');
  }

  const expectedRulesets = ['ruleset_ads', 'ruleset_url_clean', 'ruleset_popups'];
  const ids = new Set();
  for (const rr of dnr.rule_resources) {
    if (!rr.id || !rr.path) {
      throw new Error(`Invalid rule_resource: ${JSON.stringify(rr)}`);
    }
    if (ids.has(rr.id)) {
      throw new Error(`Duplicate ruleset id in manifest: ${rr.id}`);
    }
    ids.add(rr.id);

    const fullPath = path.join(ROOT_DIR, rr.path);
    try {
      await fs.access(fullPath);
    } catch {
      throw new Error(`Ruleset path declared in manifest does not exist: ${rr.path}`);
    }
  }

  for (const exp of expectedRulesets) {
    if (!ids.has(exp)) {
      throw new Error(`manifest.json missing required ruleset: ${exp}`);
    }
  }

  console.log(`[validate-rules] manifest.json OK (${dnr.rule_resources.length} rulesets declared)`);
}

async function validateAdsRules() {
  console.log('[validate-rules] Validating rules/ads_trackers.json...');
  const raw = await fs.readFile(ADS_RULES_PATH, 'utf8');
  const rules = JSON.parse(raw);

  if (!Array.isArray(rules)) {
    throw new Error('rules/ads_trackers.json must be a JSON array');
  }

  if (rules.length < 100) {
    throw new Error(`rules/ads_trackers.json has too few rules (${rules.length})`);
  }

  if (rules.length > 30000) {
    throw new Error(
      `rules/ads_trackers.json exceeds Chrome MV3 limit of 30,000 rules (has ${rules.length})`
    );
  }

  const ids = new Set();
  const domainFilters = new Set();

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (typeof r.id !== 'number' || r.id <= 0 || !Number.isInteger(r.id)) {
      throw new Error(`Rule at index ${i} has invalid id: ${r.id}`);
    }
    if (ids.has(r.id)) {
      throw new Error(`Duplicate rule id found: ${r.id}`);
    }
    ids.add(r.id);

    if (r.action?.type !== 'block') {
      throw new Error(`Rule ${r.id} action type must be "block"`);
    }

    if (!r.condition?.urlFilter || typeof r.condition.urlFilter !== 'string') {
      throw new Error(`Rule ${r.id} missing valid condition.urlFilter`);
    }

    domainFilters.add(r.condition.urlFilter);

    const types = r.condition.resourceTypes;
    if (!Array.isArray(types) || types.length === 0) {
      throw new Error(`Rule ${r.id} missing condition.resourceTypes array`);
    }

    for (const t of types) {
      if (!VALID_RESOURCE_TYPES.has(t)) {
        throw new Error(`Rule ${r.id} has invalid resourceType: ${t}`);
      }
    }
  }

  // Verify that all mandatory core ad networks are present
  for (const mDomain of MANDATORY_AD_DOMAINS) {
    const expectedFilter = `||${mDomain}^`;
    if (!domainFilters.has(expectedFilter)) {
      throw new Error(`MANDATORY ad domain missing from rules/ads_trackers.json: ${mDomain}`);
    }
  }

  // Verify that YouTube critical infrastructure is NEVER blocked in rules/ads_trackers.json
  const FORBIDDEN_YOUTUBE_FILTERS = [
    '||youtube.com^',
    '||www.youtube.com^',
    '||m.youtube.com^',
    '||music.youtube.com^',
    '||googlevideo.com^',
    '||ytimg.com^',
    '||ggpht.com^',
    '||youtubei.googleapis.com^'
  ];
  for (const forbidden of FORBIDDEN_YOUTUBE_FILTERS) {
    if (domainFilters.has(forbidden)) {
      throw new Error(`CRITICAL ERROR: YouTube domain must never be blocked in static rules: ${forbidden}`);
    }
  }

  console.log(
    `[validate-rules] rules/ads_trackers.json OK (${rules.length} valid rules, IDs 1..${rules.length})`
  );
  console.log(
    `[validate-rules] Mandatory networks verified: ${MANDATORY_AD_DOMAINS.join(', ')}`
  );
}

async function validatePopupsRules() {
  console.log('[validate-rules] Validating rules/popups_redirects.json...');
  const raw = await fs.readFile(POPUPS_RULES_PATH, 'utf8');
  const rules = JSON.parse(raw);

  if (!Array.isArray(rules)) {
    throw new Error('rules/popups_redirects.json must be a JSON array');
  }

  if (rules.length === 0 || rules.length > 500) {
    throw new Error(`rules/popups_redirects.json rule count invalid (${rules.length}, max 500)`);
  }

  const ids = new Set();
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (typeof r.id !== 'number' || r.id < 30001 || r.id > 30500) {
      throw new Error(`Rule at index ${i} has out-of-range id: ${r.id} (expected 30001..30500)`);
    }
    if (ids.has(r.id)) {
      throw new Error(`Duplicate rule id found in popups_redirects: ${r.id}`);
    }
    ids.add(r.id);

    if (r.action?.type !== 'block') {
      throw new Error(`Rule ${r.id} action type must be "block"`);
    }

    if (!r.condition?.urlFilter || !r.condition.urlFilter.startsWith('||') || !r.condition.urlFilter.endsWith('^')) {
      throw new Error(`Rule ${r.id} has invalid urlFilter: ${r.condition?.urlFilter}`);
    }

    const types = r.condition.resourceTypes;
    if (!Array.isArray(types) || !types.includes('main_frame')) {
      throw new Error(`Rule ${r.id} must include "main_frame" in resourceTypes`);
    }

    for (const t of types) {
      if (!VALID_RESOURCE_TYPES.has(t)) {
        throw new Error(`Rule ${r.id} has invalid resourceType: ${t}`);
      }
    }
  }

  console.log(
    `[validate-rules] rules/popups_redirects.json OK (${rules.length} rules, IDs 30001..${30000 + rules.length})`
  );
}

async function validateUrlCleanRules() {
  console.log('[validate-rules] Validating rules/url_clean.json...');
  const raw = await fs.readFile(URL_CLEAN_PATH, 'utf8');
  const rules = JSON.parse(raw);

  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error('rules/url_clean.json must be a non-empty JSON array');
  }

  const ids = new Set();
  for (const r of rules) {
    if (typeof r.id !== 'number' || r.id <= 0) {
      throw new Error(`Invalid rule id in url_clean: ${r.id}`);
    }
    if (ids.has(r.id)) {
      throw new Error(`Duplicate rule id in url_clean: ${r.id}`);
    }
    ids.add(r.id);

    if (r.action?.type !== 'redirect') {
      throw new Error(`url_clean rule ${r.id} action type must be "redirect"`);
    }

    const removeParams = r.action?.redirect?.transform?.queryTransform?.removeParams;
    if (!Array.isArray(removeParams) || removeParams.length === 0) {
      throw new Error(`url_clean rule ${r.id} missing removeParams list`);
    }

    if (!r.condition?.resourceTypes?.includes('main_frame')) {
      throw new Error(`url_clean rule ${r.id} must target main_frame`);
    }
  }

  console.log(`[validate-rules] rules/url_clean.json OK (${rules.length} valid rules)`);
}

async function validateCosmeticRules() {
  console.log('[validate-rules] Validating rules/cosmetic_rules.json...');
  const raw = await fs.readFile(COSMETIC_RULES_PATH, 'utf8');
  const cosmeticData = JSON.parse(raw);

  if (typeof cosmeticData !== 'object' || Array.isArray(cosmeticData) || cosmeticData === null) {
    throw new Error('rules/cosmetic_rules.json must be a JSON object with { generic, domains }');
  }

  // Validate Generic layer
  if (!Array.isArray(cosmeticData.generic) || cosmeticData.generic.length < 10) {
    throw new Error(`rules/cosmetic_rules.json generic array missing or too small (${cosmeticData.generic?.length})`);
  }

  for (const sel of cosmeticData.generic) {
    if (typeof sel !== 'string' || !sel.trim()) {
      throw new Error(`rules/cosmetic_rules.json generic layer has invalid selector: ${sel}`);
    }
    if (sel.includes('{') || sel.includes('}') || sel.includes(':has(') || sel.includes(':xpath(')) {
      throw new Error(`rules/cosmetic_rules.json generic layer has non-standard selector: ${sel}`);
    }
  }

  // Validate Domains layer
  const domainMap = cosmeticData.domains;
  if (typeof domainMap !== 'object' || Array.isArray(domainMap) || domainMap === null) {
    throw new Error('rules/cosmetic_rules.json domains must be an object');
  }

  const domainCount = Object.keys(domainMap).length;
  if (domainCount < 50) {
    throw new Error(`rules/cosmetic_rules.json has too few domains (${domainCount})`);
  }

  if (!domainMap['netprime.me'] || !Array.isArray(domainMap['netprime.me'])) {
    throw new Error('rules/cosmetic_rules.json missing required netprime.me rules');
  }

  for (const [domain, selectors] of Object.entries(domainMap)) {
    if (!Array.isArray(selectors) || selectors.length === 0) {
      throw new Error(`rules/cosmetic_rules.json domain "${domain}" has empty selectors array`);
    }
    for (const sel of selectors) {
      if (typeof sel !== 'string' || !sel.trim()) {
        throw new Error(`rules/cosmetic_rules.json domain "${domain}" contains invalid selector: ${sel}`);
      }
      if (sel.includes('{') || sel.includes('}') || sel.includes(':has(') || sel.includes(':xpath(')) {
        throw new Error(`rules/cosmetic_rules.json domain "${domain}" contains non-standard selector: ${sel}`);
      }
    }
  }

  console.log(
    `[validate-rules] rules/cosmetic_rules.json OK (${cosmeticData.generic.length} generic, ${domainCount} domains validated)`
  );
}

async function main() {
  console.log('=== AX-Privacy Rule Validation Starting ===');
  await validateManifest();
  await validateUrlCleanRules();
  await validateAdsRules();
  await validatePopupsRules();
  await validateCosmeticRules();
  console.log('=== AX-Privacy Rule Validation Passed with ZERO errors! ===');
}

main().catch((err) => {
  console.error('[validate-rules] Validation FAILED:', err.message);
  process.exit(1);
});
