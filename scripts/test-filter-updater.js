/**
 * AX-Privacy Filter Updater & Multi-Format Parser Test Suite (v2.5.0)
 * Validates:
 *   1. Multi-format parsing (ABP, Hosts, plain domain) and exclusion of @@, ##, $document, $popup
 *   2. URL validation (rejection of http, javascript, duplicates, >10 limit) and short name derivation
 *   3. Dynamic DNR quota priority (custom lists prioritized over EasyList/EasyPrivacy) & ID isolation (10000+)
 *   4. Partial failure resilience (single list failure does not block other lists)
 */

import assert from 'node:assert';

// Mock chrome environment for Service Worker imports in Node.js
const mockDynamicRules = [];
const mockStorageData = {
  customFilterLists: [],
  filterUpdateStatus: null,
  whitelist: []
};

globalThis.chrome = {
  declarativeNetRequest: {
    MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
    setExtensionActionOptions: async () => {},
    updateEnabledRulesets: async () => {},
    getDynamicRules: async () => [...mockDynamicRules],
    updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
      // Remove
      for (const id of removeRuleIds) {
        const idx = mockDynamicRules.findIndex((r) => r.id === id);
        if (idx !== -1) mockDynamicRules.splice(idx, 1);
      }
      // Add
      for (const rule of addRules) {
        mockDynamicRules.push(rule);
      }
    }
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {}
  },
  storage: {
    local: {
      get: async (keys) => {
        if (!keys) return { ...mockStorageData };
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) res[k] = mockStorageData[k];
          return res;
        }
        if (typeof keys === 'object') {
          const res = {};
          for (const [k, v] of Object.entries(keys)) {
            res[k] = mockStorageData[k] !== undefined ? mockStorageData[k] : v;
          }
          return res;
        }
        return { [keys]: mockStorageData[keys] };
      },
      set: async (obj) => {
        Object.assign(mockStorageData, obj);
      }
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {}
    }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getURL: (path) => path
  },
  tabs: {
    onCreated: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    get: async () => ({ url: '' }),
    sendMessage: async () => {}
  }
};

// Import background module functions
const {
  parseFilterLine,
  parseFilterContent,
  validateCustomFilterUrl,
  deriveFilterListName,
  allocateDynamicRules,
  getStaticDomains,
  syncWhitelistRules
} = await import('../background.js');

console.log('=== AX-Privacy Filter Updater & Parser Test Suite (v2.5.0) ===\n');

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

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 1. Multi-Format Parser Tests
// ---------------------------------------------------------------------------
console.log('[Group 1: Multi-Format Parser]');

runTest('Parses Adblock Plus / uBO filter format (||ad.test^)', () => {
  assert.strictEqual(parseFilterLine('||ad.test^'), 'ad.test');
  assert.strictEqual(parseFilterLine('||tracker.example.com^$third-party,image'), 'tracker.example.com');
  assert.strictEqual(parseFilterLine('||badsite.org/ads/banner/*'), 'badsite.org');
});

runTest('Skips ABP exception rules (@@)', () => {
  assert.strictEqual(parseFilterLine('@@||allowed.com^'), null);
  assert.strictEqual(parseFilterLine('@@||whitelisted.net^$document'), null);
});

runTest('Skips ABP cosmetic and element hiding rules (##, #@#, #?#)', () => {
  assert.strictEqual(parseFilterLine('example.com##.ad-banner'), null);
  assert.strictEqual(parseFilterLine('example.com#@#.ad-banner'), null);
  assert.strictEqual(parseFilterLine('example.com#?#.ad-banner:has(> img)'), null);
  assert.strictEqual(parseFilterLine('##.sponsor-post'), null);
});

runTest('Skips page-breaking directives ($document, $popup, $csp, $badfilter)', () => {
  assert.strictEqual(parseFilterLine('||breaker.com^$document'), null);
  assert.strictEqual(parseFilterLine('||popup.com^$popup'), null);
  assert.strictEqual(parseFilterLine('||csp.com^$csp=script-src'), null);
  assert.strictEqual(parseFilterLine('||rule.com^$badfilter'), null);
});

runTest('Parses Hosts file format (0.0.0.0 and 127.0.0.1)', () => {
  assert.strictEqual(parseFilterLine('0.0.0.0 track.test'), 'track.test');
  assert.strictEqual(parseFilterLine('127.0.0.1 adserver.test # inline comment'), 'adserver.test');
  assert.strictEqual(parseFilterLine('0.0.0.0 sub.domain.ads.com'), 'sub.domain.ads.com');
});

runTest('Excludes loopback and broadcast entries in Hosts format', () => {
  assert.strictEqual(parseFilterLine('0.0.0.0 0.0.0.0'), null);
  assert.strictEqual(parseFilterLine('127.0.0.1 localhost'), null);
  assert.strictEqual(parseFilterLine('127.0.0.1 localhost.localdomain'), null);
  assert.strictEqual(parseFilterLine('0.0.0.0 broadcasthost'), null);
  assert.strictEqual(parseFilterLine('127.0.0.1 local'), null);
});

runTest('Parses Plain Domain lists (OISD / HaGeZi format)', () => {
  assert.strictEqual(parseFilterLine('pixel.test'), 'pixel.test');
  assert.strictEqual(parseFilterLine('analytics.example.org'), 'analytics.example.org');
});

runTest('Skips comments and blank lines', () => {
  assert.strictEqual(parseFilterLine('# This is a comment'), null);
  assert.strictEqual(parseFilterLine('! Title: EasyList'), null);
  assert.strictEqual(parseFilterLine('[Adblock Plus 2.0]'), null);
  assert.strictEqual(parseFilterLine('; comment'), null);
  assert.strictEqual(parseFilterLine('   '), null);
  assert.strictEqual(parseFilterLine(null), null);
});

runTest('parseFilterContent parses multi-line mixed filter block', () => {
  const content = `
! Title: Combined Test Filter
# Hosts header
0.0.0.0 host-tracker.net
127.0.0.1 host-ads.org # comment
0.0.0.0 localhost

# ABP Rules
||abp-ad.com^
||abp-tracker.com^$third-party
@@||whitelist-exception.com^
sample.com##.sponsor-frame
||site.com^$popup

# Plain Domains
plain-analytics.io
sub.plain-telemetry.org
`;
  const parsed = parseFilterContent(content);
  assert.strictEqual(parsed.has('host-tracker.net'), true);
  assert.strictEqual(parsed.has('host-ads.org'), true);
  assert.strictEqual(parsed.has('abp-ad.com'), true);
  assert.strictEqual(parsed.has('abp-tracker.com'), true);
  assert.strictEqual(parsed.has('plain-analytics.io'), true);
  assert.strictEqual(parsed.has('sub.plain-telemetry.org'), true);

  // Excluded entries
  assert.strictEqual(parsed.has('localhost'), false);
  assert.strictEqual(parsed.has('whitelist-exception.com'), false);
  assert.strictEqual(parsed.has('site.com'), false);
  assert.strictEqual(parsed.size, 6);
});

// ---------------------------------------------------------------------------
// 2. URL Validation & Name Derivation Tests
// ---------------------------------------------------------------------------
console.log('\n[Group 2: URL Security & Name Derivation]');

runTest('Accepts valid https:// URLs', () => {
  const res = validateCustomFilterUrl('https://filters.example.com/adblock.txt');
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.url, 'https://filters.example.com/adblock.txt');
});

runTest('Rejects insecure http:// URLs with Turkish error message', () => {
  const res = validateCustomFilterUrl('http://insecure.example.com/adblock.txt');
  assert.strictEqual(res.valid, false);
  assert.match(res.error, /yalnızca https:\/\/ protokolüne sahip/i);
});

runTest('Rejects javascript:, file:, data: and invalid schemes', () => {
  assert.strictEqual(validateCustomFilterUrl('javascript:alert(1)').valid, false);
  assert.strictEqual(validateCustomFilterUrl('file:///C:/Windows/System32/drivers/etc/hosts').valid, false);
  assert.strictEqual(validateCustomFilterUrl('data:text/plain;base64,MTI3LjAuMC4x').valid, false);
  assert.strictEqual(validateCustomFilterUrl('not-a-url').valid, false);
  assert.strictEqual(validateCustomFilterUrl('').valid, false);
});

runTest('Rejects duplicate URLs with normalization', () => {
  const existing = [
    { url: 'https://example.com/list.txt', enabled: true }
  ];
  // Exact match
  assert.strictEqual(validateCustomFilterUrl('https://example.com/list.txt', existing).valid, false);
  // Case difference
  assert.strictEqual(validateCustomFilterUrl('https://EXAMPLE.com/list.txt', existing).valid, false);
  // Trailing slash
  assert.strictEqual(validateCustomFilterUrl('https://example.com/list.txt/', existing).valid, false);
});

runTest('Enforces maximum 10 custom filter lists limit', () => {
  const tenLists = Array.from({ length: 10 }, (_, i) => ({
    url: `https://example.com/list${i}.txt`
  }));
  const res = validateCustomFilterUrl('https://example.com/list11.txt', tenLists);
  assert.strictEqual(res.valid, false);
  assert.match(res.error, /en fazla 10 adet/i);
});

runTest('Derives clean short names from URL filename or hostname', () => {
  assert.strictEqual(
    deriveFilterListName('https://easylist-downloads.adblockplus.org/turkish-filters.txt'),
    'turkish-filters'
  );
  assert.strictEqual(
    deriveFilterListName('https://hagezi.gitlab.io/dns-blocklists/hosts/pro.plus.hosts'),
    'pro.plus'
  );
  assert.strictEqual(
    deriveFilterListName('https://blocklist.site/app/dl/tracking'),
    'tracking'
  );
  assert.strictEqual(
    deriveFilterListName('https://adguardteam.github.io/'),
    'adguardteam.github.io'
  );
});

// ---------------------------------------------------------------------------
// 3. Dynamic DNR Quota Priority & ID Isolation Tests
// ---------------------------------------------------------------------------
console.log('\n[Group 3: DNR Dynamic Quota Priority & ID Isolation]');

runTest('Delta deduplication against static 25,000 rules', () => {
  const staticDomains = new Set(['doubleclick.net', 'googletagmanager.com', 'criteo.com']);
  const customLists = [
    { id: 'custom_1', name: 'Custom List', enabled: true }
  ];
  const customMap = new Map([
    ['custom_1', ['doubleclick.net', 'new-tracker.com', 'criteo.com', 'regional-ad.tr']]
  ]);

  const plan = allocateDynamicRules({
    customLists,
    customListParsedMap: customMap,
    defaultSourcesParsed: ['googletagmanager.com', 'fallback-ad.com'],
    staticDomains,
    maxQuota: 100
  });

  // static domains (doubleclick, criteo, googletagmanager) must be removed!
  const ruleUrls = plan.rules.map((r) => r.condition.urlFilter);
  assert.strictEqual(ruleUrls.includes('||doubleclick.net^'), false);
  assert.strictEqual(ruleUrls.includes('||criteo.com^'), false);
  assert.strictEqual(ruleUrls.includes('||googletagmanager.com^'), false);

  // Delta domains must be present
  assert.strictEqual(ruleUrls.includes('||new-tracker.com^'), true);
  assert.strictEqual(ruleUrls.includes('||regional-ad.tr^'), true);
  assert.strictEqual(ruleUrls.includes('||fallback-ad.com^'), true);
});

runTest('Custom active lists take absolute priority over EasyList when quota is constrained', () => {
  const staticDomains = new Set();
  const customLists = [
    { id: 'custom_tr', name: 'Turkish Filters', enabled: true },
    { id: 'custom_p2', name: 'Custom Adblock', enabled: true }
  ];
  const customMap = new Map([
    ['custom_tr', ['reklam1.tr', 'reklam2.tr', 'reklam3.tr']],
    ['custom_p2', ['trackerA.org', 'trackerB.org']]
  ]);
  const defaultSources = ['easylist1.com', 'easylist2.com', 'easylist3.com', 'easylist4.com'];

  // Total domains = 5 custom + 4 easylist = 9. Set maxQuota = 4!
  const plan = allocateDynamicRules({
    customLists,
    customListParsedMap: customMap,
    defaultSourcesParsed: defaultSources,
    staticDomains,
    maxQuota: 4
  });

  // Quota is 4, custom list has 5 domains. All 4 slots must go to custom lists!
  assert.strictEqual(plan.totalRules, 4);
  const ruleUrls = plan.rules.map((r) => r.condition.urlFilter);
  assert.strictEqual(ruleUrls.includes('||reklam1.tr^'), true);
  assert.strictEqual(ruleUrls.includes('||reklam2.tr^'), true);
  assert.strictEqual(ruleUrls.includes('||reklam3.tr^'), true);
  assert.strictEqual(ruleUrls.includes('||trackerA.org^'), true);

  // Zero easylist domains should displace custom domains
  assert.strictEqual(ruleUrls.includes('||easylist1.com^'), false);
});

runTest('Dynamic rule IDs strictly stay in >= 10000 range', () => {
  const customLists = [
    { id: 'custom_1', name: 'List 1', enabled: true }
  ];
  const customMap = new Map([
    ['custom_1', ['a.com', 'b.com', 'c.com']]
  ]);

  const plan = allocateDynamicRules({
    customLists,
    customListParsedMap: customMap,
    defaultSourcesParsed: ['d.com'],
    staticDomains: new Set(),
    maxQuota: 1000
  });

  assert.strictEqual(plan.rules.length, 4);
  assert.strictEqual(plan.rules[0].id, 10000);
  assert.strictEqual(plan.rules[1].id, 10001);
  assert.strictEqual(plan.rules[2].id, 10002);
  assert.strictEqual(plan.rules[3].id, 10003);

  // Ensure no rule is in the 5000..9999 whitelist range
  for (const r of plan.rules) {
    assert.strictEqual(r.id >= 10000, true);
    assert.strictEqual(r.id < 5000 || r.id >= 10000, true);
  }
});

await runAsyncTest('Whitelist ID isolation: dynamic whitelist only touches 5000..9999 and preserves 10000+ rules', async () => {
  // Pre-populate mockDynamicRules with both whitelist and filter rules
  mockDynamicRules.length = 0;
  mockDynamicRules.push(
    { id: 5000, priority: 1000, action: { type: 'allowAllRequests' } }, // existing whitelist
    { id: 10000, priority: 1, action: { type: 'block' } }, // live filter rule
    { id: 10001, priority: 1, action: { type: 'block' } }  // live filter rule
  );

  // Sync new whitelist with 2 domains
  await syncWhitelistRules(['example.com', 'trusted.org']);

  // Dynamic filter rules (10000, 10001) MUST NOT have been removed!
  const hasFilter10000 = mockDynamicRules.some((r) => r.id === 10000);
  const hasFilter10001 = mockDynamicRules.some((r) => r.id === 10001);
  assert.strictEqual(hasFilter10000, true, 'Rule 10000 must be preserved');
  assert.strictEqual(hasFilter10001, true, 'Rule 10001 must be preserved');

  // Whitelist rules should be in 5000..9999
  const whitelistRules = mockDynamicRules.filter((r) => r.id >= 5000 && r.id < 10000);
  assert.strictEqual(whitelistRules.length, 2);
  assert.strictEqual(whitelistRules[0].id, 5000);
  assert.strictEqual(whitelistRules[1].id, 5001);
});

// ---------------------------------------------------------------------------
// 4. Partial Failure Resilience Tests
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Partial Failure Resilience]');

runTest('Failed custom list does not abort remaining lists or default sources', () => {
  const customLists = [
    { id: 'failing_list', name: 'Dead List', enabled: true, lastStatus: 'error', lastError: 'HTTP 404' },
    { id: 'working_list', name: 'Alive List', enabled: true, lastStatus: 'ok', lastError: null }
  ];
  const customMap = new Map([
    ['failing_list', []], // failed fetch returned empty
    ['working_list', ['working-ad-blocker.org', 'alive-tracker.net']]
  ]);
  const defaultSources = ['easylist-backup.com'];

  const plan = allocateDynamicRules({
    customLists,
    customListParsedMap: customMap,
    defaultSourcesParsed: defaultSources,
    staticDomains: new Set(),
    maxQuota: 100
  });

  // Working list rules and default sources are applied!
  const ruleUrls = plan.rules.map((r) => r.condition.urlFilter);
  assert.strictEqual(ruleUrls.includes('||working-ad-blocker.org^'), true);
  assert.strictEqual(ruleUrls.includes('||alive-tracker.net^'), true);
  assert.strictEqual(ruleUrls.includes('||easylist-backup.com^'), true);
  assert.strictEqual(plan.totalRules, 3);
  assert.strictEqual(plan.listRuleCounts.get('failing_list'), 0);
  assert.strictEqual(plan.listRuleCounts.get('working_list'), 2);
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===\n`);
if (passedTests === totalTests) {
  console.log('✓ All Filter Updater & Parser tests passed successfully!');
} else {
  process.exit(1);
}
