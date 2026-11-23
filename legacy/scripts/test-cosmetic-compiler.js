/**
 * AX-Privacy Cosmetic Compiler & Popup Rules Unit Tests (v2.6.0)
 * Validates:
 *   1. Two-layer cosmetic structure: { generic: [...], domains: { ... } }
 *   2. Extracts standard domain-specific CSS cosmetic rules (e.g. domain##selector)
 *   3. Rejects scriptlets (##+js), cosmetic exceptions (#@#), CSS blocks (#$#), and non-standard (:has, :xpath)
 *   4. Correctly parses multi-domain comma-separated lists and skips negated (~domain) targets
 *   5. Guarantees netprime.me curated rules in domains and universal ad containers in generic
 *   6. Deterministic, alphabetically-sorted output for both generic and domains
 *   7. generatePopupsRedirectsRules schema, IDs 90001..92000, and main_frame resourceTypes
 */

import assert from 'node:assert';
import { parseCosmeticRules, generatePopupsRedirectsRules } from './build-rules.js';

console.log('=== AX-Privacy Cosmetic Compiler & Popup Rules Test Suite ===\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 1. Two-Layer Structure & Standard Cosmetic Extraction
// ---------------------------------------------------------------------------
console.log('[Group 1: Two-Layer Structure & Standard Cosmetic Extraction]');

runTest('Produces two-layer structure with generic array and domains object', () => {
  const sample = `
dramadunyam.com##.engel-duvar
##.banner-ad
`;
  const result = parseCosmeticRules(sample);
  assert.ok(result && typeof result === 'object');
  assert.ok(Array.isArray(result.generic));
  assert.ok(result.domains && typeof result.domains === 'object');
  assert.ok(result.generic.includes('.banner-ad'));
  assert.ok(result.domains['dramadunyam.com']);
  assert.deepStrictEqual(result.domains['dramadunyam.com'], ['.engel-duvar']);
});

runTest('Parses standard domain##selector rules into domains layer', () => {
  const sample = `
! Title: Turkish Filter Test
dramadunyam.com##.engel-duvar
hisse.net##.detail-mymani-widget
hisse.net##.adv-col
`;
  const result = parseCosmeticRules(sample);
  assert.ok(result.domains['dramadunyam.com']);
  assert.deepStrictEqual(result.domains['dramadunyam.com'], ['.engel-duvar']);
  assert.ok(result.domains['hisse.net']);
  assert.deepStrictEqual(result.domains['hisse.net'], ['.adv-col', '.detail-mymani-widget']);
});

runTest('Handles comma-separated domains and ignores negated (~domain) exclusions', () => {
  const sample = `
sitea.com,siteb.com,~sitec.com##.sponsor-banner
`;
  const result = parseCosmeticRules(sample);
  assert.ok(result.domains['sitea.com']);
  assert.ok(result.domains['siteb.com']);
  assert.strictEqual(result.domains['sitec.com'], undefined);
  assert.deepStrictEqual(result.domains['sitea.com'], ['.sponsor-banner']);
  assert.deepStrictEqual(result.domains['siteb.com'], ['.sponsor-banner']);
});

// ---------------------------------------------------------------------------
// 2. Exclusion of Non-Standard / Harmful Directives
// ---------------------------------------------------------------------------
console.log('\n[Group 2: Exclusion of Non-Standard Directives]');

runTest('Discards scriptlet injection rules (##+js)', () => {
  const sample = `
badsite.com##+js(set-constant, canRunAds, true)
badsite.com##.legit-ad
##+js(abort-on-property-read, adblock)
`;
  const result = parseCosmeticRules(sample);
  assert.deepStrictEqual(result.domains['badsite.com'], ['.legit-ad']);
  assert.ok(!result.generic.some((s) => s.includes('+js')));
});

runTest('Discards cosmetic exceptions (#@#)', () => {
  const sample = `
site.com#@#.ad-banner
site.com##.ad-banner
`;
  const result = parseCosmeticRules(sample);
  assert.deepStrictEqual(result.domains['site.com'], ['.ad-banner']);
});

runTest('Discards procedural pseudo-classes (:has, :xpath, :-abp-)', () => {
  const sample = `
site.com##div:has(> img[alt="reklam"])
site.com##div:xpath(//div[@class='ad'])
site.com##div:-abp-has(.ad)
site.com##.clean-ad
##div:has(> .banner)
`;
  const result = parseCosmeticRules(sample);
  assert.deepStrictEqual(result.domains['site.com'], ['.clean-ad']);
  assert.ok(!result.generic.some((s) => s.includes(':has') || s.includes(':xpath')));
});

runTest('Discards CSS style injection rules (#$#, #$?#, #{})', () => {
  const sample = `
site.com#$##adblockOverlay { display: none !important; }
site.com##.real-banner
`;
  const result = parseCosmeticRules(sample);
  assert.deepStrictEqual(result.domains['site.com'], ['.real-banner']);
  assert.ok(!result.generic.some((s) => s.includes('{') || s.includes('}')));
});

// ---------------------------------------------------------------------------
// 3. Baseline Curated Rules & Sorting Determinism
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Curated Baseline & Sorting]');

runTest('Guarantees netprime.me and universal ad selectors are present even with empty input', () => {
  const result = parseCosmeticRules('');
  assert.ok(result.domains['netprime.me']);
  assert.ok(result.domains['netprime.me'].includes('.fixed-gif-banner'));
  assert.ok(result.domains['netprime.me'].includes('.ad-banner'));
  assert.ok(result.domains['netprime.me'].includes('[id*="reklam"]'));
  assert.ok(result.domains['netprime.me'].includes('.click-overlay'));

  assert.ok(result.generic.includes('ins.adsbygoogle'));
  assert.ok(result.generic.includes('.ad-banner'));
  assert.ok(result.generic.includes('.sticky-ad'));
  assert.ok(result.generic.includes('.pageskin'));
});

runTest('Output generic selectors and domain lists are deterministically sorted', () => {
  const sample = `
zulu.com##.z-ad
alpha.com##.b-ad
alpha.com##.a-ad
beta.com##.first-ad
##.z-generic
##.a-generic
`;
  const result = parseCosmeticRules(sample);
  const domains = Object.keys(result.domains);
  const alphaIdx = domains.indexOf('alpha.com');
  const betaIdx = domains.indexOf('beta.com');
  const zuluIdx = domains.indexOf('zulu.com');

  assert.ok(alphaIdx < betaIdx);
  assert.ok(betaIdx < zuluIdx);
  assert.deepStrictEqual(result.domains['alpha.com'], ['.a-ad', '.b-ad']);

  const aIdx = result.generic.indexOf('.a-generic');
  const zIdx = result.generic.indexOf('.z-generic');
  assert.ok(aIdx !== -1 && zIdx !== -1 && aIdx < zIdx);
});

// ---------------------------------------------------------------------------
// 4. Pop-up & Redirect Rules Generation
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Pop-up & Redirect Rules]');

runTest('generatePopupsRedirectsRules creates valid rules in 90001..92000 range', () => {
  const rules = generatePopupsRedirectsRules(['testpopup.com', 'extraredirect.org']);
  assert.ok(Array.isArray(rules));
  assert.ok(rules.length > 0);
  assert.strictEqual(rules[0].id, 90001);
  assert.strictEqual(rules[rules.length - 1].id, 90000 + rules.length);
  assert.ok(rules.length <= 2000);

  for (const r of rules) {
    assert.ok(r.id >= 90001 && r.id <= 92000);
    assert.strictEqual(r.action.type, 'block');
    if (r.condition.domainType === 'thirdParty') {
      assert.ok(r.condition.resourceTypes.includes('script'));
      assert.ok(r.condition.resourceTypes.includes('sub_frame'));
    } else {
      assert.ok(r.condition.urlFilter.startsWith('||') && r.condition.urlFilter.endsWith('^'));
      assert.ok(r.condition.resourceTypes.includes('main_frame'));
      assert.ok(r.condition.resourceTypes.includes('sub_frame'));
    }
  }

  const filters = rules.map((r) => r.condition.urlFilter);
  assert.ok(filters.includes('||popads.net^'));
  assert.ok(filters.includes('||propellerads.com^'));
  assert.ok(filters.includes('||testpopup.com^'));
  assert.ok(filters.includes('||extraredirect.org^'));
  assert.ok(filters.includes('*afu.php*'));
  assert.ok(filters.includes('*ntfc.php*'));
  assert.ok(filters.includes('*monetag*'));
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===\n`);
if (passedTests === totalTests) {
  console.log('✓ All Cosmetic Compiler & Popup Rules tests passed successfully!');
} else {
  process.exit(1);
}
