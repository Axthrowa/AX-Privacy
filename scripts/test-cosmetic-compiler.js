/**
 * AX-Privacy Cosmetic Compiler Unit Tests (v2.6.0)
 * Validates that parseCosmeticRules in scripts/build-rules.js:
 *   1. Extracts standard domain-specific CSS cosmetic rules (e.g. domain##selector)
 *   2. Rejects scriptlets (##+js), cosmetic exceptions (#@#), CSS blocks (#$#), and non-standard (:has, :xpath)
 *   3. Correctly parses multi-domain comma-separated lists and skips negated (~domain) targets
 *   4. Generates baseline curated selectors for netprime.me
 *   5. Guarantees deterministic, alphabetically-sorted output
 */

import assert from 'node:assert';
import { parseCosmeticRules } from './build-rules.js';

console.log('=== AX-Privacy Cosmetic Compiler Test Suite ===\n');

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
// 1. Basic Cosmetic Rule Extraction
// ---------------------------------------------------------------------------
console.log('[Group 1: Standard Cosmetic Extraction]');

runTest('Parses standard domain##selector rules', () => {
  const sample = `
! Title: Turkish Filter Test
dramadunyam.com##.engel-duvar
hisse.net##.detail-mymani-widget
hisse.net##.adv-col
`;
  const result = parseCosmeticRules(sample);
  assert.ok(result['dramadunyam.com']);
  assert.deepStrictEqual(result['dramadunyam.com'], ['.engel-duvar']);
  assert.ok(result['hisse.net']);
  assert.deepStrictEqual(result['hisse.net'], ['.adv-col', '.detail-mymani-widget']);
});

runTest('Handles comma-separated domains and ignores negated (~domain) exclusions', () => {
  const sample = `
sitea.com,siteb.com,~sitec.com##.sponsor-banner
`;
  const result = parseCosmeticRules(sample);
  assert.ok(result['sitea.com']);
  assert.ok(result['siteb.com']);
  assert.strictEqual(result['sitec.com'], undefined);
  assert.deepStrictEqual(result['sitea.com'], ['.sponsor-banner']);
  assert.deepStrictEqual(result['siteb.com'], ['.sponsor-banner']);
});

// ---------------------------------------------------------------------------
// 2. Exclusion of Non-Standard / Harmful Directives
// ---------------------------------------------------------------------------
console.log('\n[Group 2: Exclusion of Non-Standard Directives]');

runTest('Discards scriptlet injection rules (##+js)', () => {
  const sample = `
badsite.com##+js(set-constant, canRunAds, true)
badsite.com##.legit-ad
`;
  const result = parseCosmeticRules(sample);
  assert.deepStrictEqual(result['badsite.com'], ['.legit-ad']);
});

runTest('Discards cosmetic exceptions (#@#)', () => {
  const sample = `
site.com#@#.ad-banner
site.com##.ad-banner
`;
  const result = parseCosmeticRules(sample);
  assert.deepStrictEqual(result['site.com'], ['.ad-banner']);
});

runTest('Discards procedural pseudo-classes (:has, :xpath, :-abp-)', () => {
  const sample = `
site.com##div:has(> img[alt="reklam"])
site.com##div:xpath(//div[@class='ad'])
site.com##div:-abp-has(.ad)
site.com##.clean-ad
`;
  const result = parseCosmeticRules(sample);
  assert.deepStrictEqual(result['site.com'], ['.clean-ad']);
});

runTest('Discards CSS style injection rules (#$#, #$?#, #{})', () => {
  const sample = `
site.com#$##adblockOverlay { display: none !important; }
site.com##.real-banner
`;
  const result = parseCosmeticRules(sample);
  assert.deepStrictEqual(result['site.com'], ['.real-banner']);
});

// ---------------------------------------------------------------------------
// 3. Baseline Curated Rules & Determinism
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Curated Baseline & Sorting]');

runTest('Guarantees netprime.me curated rules are present even with empty input', () => {
  const result = parseCosmeticRules('');
  assert.ok(result['netprime.me']);
  assert.ok(result['netprime.me'].includes('.fixed-gif-banner'));
  assert.ok(result['netprime.me'].includes('.ad-banner'));
  assert.ok(result['netprime.me'].includes('[id*="reklam"]'));
  assert.ok(result['netprime.me'].includes('.click-overlay'));
});

runTest('Output domains and selectors are deterministically sorted alphabetically', () => {
  const sample = `
zulu.com##.z-ad
alpha.com##.b-ad
alpha.com##.a-ad
beta.com##.first-ad
`;
  const result = parseCosmeticRules(sample);
  const domains = Object.keys(result);
  const alphaIdx = domains.indexOf('alpha.com');
  const betaIdx = domains.indexOf('beta.com');
  const zuluIdx = domains.indexOf('zulu.com');

  assert.ok(alphaIdx < betaIdx);
  assert.ok(betaIdx < zuluIdx);
  assert.deepStrictEqual(result['alpha.com'], ['.a-ad', '.b-ad']);
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===\n`);
if (passedTests === totalTests) {
  console.log('✓ All Cosmetic Compiler tests passed successfully!');
} else {
  process.exit(1);
}
