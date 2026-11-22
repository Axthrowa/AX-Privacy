/**
 * AX-Privacy AX-Brain Online Learning Engine & Threat Promotion Test Suite (v4.0.0)
 * Validates:
 *   1. 12 Sensory Features & Baseline Calibration
 *   2. Online SGD Convergence (Label 1 increases probability, Label 0 decreases)
 *   3. Mathematical Stability & Weight Clipping ([-4.0, +4.0], bias [-5.0, +2.0], 0 NaN/Inf)
 *   4. Autonomous Threat Promotion to DNR (Dedicated ID band 2001..2300, 2 strikes threshold)
 *   5. IMMUNE_ROOTS & Whitelist Absolute Protection (Zero false-positive network blocks)
 *   6. Performance Budget (< 15ms for 1,000 predictions)
 *   7. State Reset & 60-day TTL Self-Pruning
 */

import assert from 'node:assert';
import { performance } from 'node:perf_hooks';

// Setup mock chrome API
const mockDynamicRules = [];
const mockStorage = {
  axBrainModel: null,
  learnedDomains: [],
  learnedCosmetics: [],
  whitelist: ['my-trusted-site.com']
};

globalThis.chrome = {
  declarativeNetRequest: {
    MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
    getDynamicRules: async () => [...mockDynamicRules],
    updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
      for (const id of removeRuleIds) {
        const idx = mockDynamicRules.findIndex((r) => r.id === id);
        if (idx !== -1) mockDynamicRules.splice(idx, 1);
      }
      for (const r of addRules) {
        mockDynamicRules.push(r);
      }
    }
  },
  storage: {
    local: {
      get: async (keys) => {
        if (!keys) return { ...mockStorage };
        if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) res[k] = mockStorage[k];
          return res;
        }
        return { ...mockStorage };
      },
      set: async (items) => {
        Object.assign(mockStorage, items);
      }
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {}
    }
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {}
  },
  alarms: {
    create: () => {},
    onAlarm: { addListener: () => {} }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} }
  },
  tabs: {
    onCreated: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    onRemoved: { addListener: () => {} }
  }
};

// Import modules under test
const AxBrain = (await import('../ax-brain.js')).default || globalThis.AxBrain;
const {
  LEARNED_DNR_START_ID,
  LEARNED_DNR_MAX_RULES,
  LEARNED_DOMAINS_MAX,
  getAxBrainState,
  syncLearnedDNRRules,
  reportBrainThreat,
  trainBrainModel,
  resetBrainState,
  pruneExpiredBrainData
} = await import('../background.js');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n=== AX-Brain Autonomous Learning Engine Test Suite (v4.0.0) ===\n');

// Group 1: 12 Sensory Features & Architecture
console.log('[Group 1: Sensory Feature Vector & Defaults]');
runTest('FEATURE_NAMES contains exactly 12 sensory features', () => {
  assert.strictEqual(AxBrain.FEATURE_NAMES.length, 12);
  assert.ok(AxBrain.FEATURE_NAMES.includes('isFixedOrSticky'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('highZIndex'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('hasCrossSiteLink'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('hasBlankTarget'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('isIabSize'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('hasGifOrWebp'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('isEdgeOrCorner'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('isTransparentCover'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('hasBaitLanguage'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('hasCloseNoForm'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('hasAdTokens'));
  assert.ok(AxBrain.FEATURE_NAMES.includes('isLateInjected'));
});

runTest('createDefaultModel initializes 12 calibrated weights and negative bias', () => {
  const model = AxBrain.createDefaultModel();
  assert.strictEqual(model.weights.length, 12);
  assert.strictEqual(typeof model.bias, 'number');
  assert.ok(model.bias < 0, 'Initial bias should be negative for safety');
  assert.strictEqual(model.sampleCount, 0);
  assert.ok(Date.now() - model.lastUpdated < 1000);
});

runTest('extractFeatures correctly detects ad patterns from DOM element', () => {
  const mockEl = {
    id: 'ad-slot-header',
    className: 'banner-container',
    tagName: 'DIV',
    getAttribute: (attr) => (attr === 'data-ad' ? '12345' : null),
    querySelectorAll: (sel) => {
      if (sel === 'a[href]') {
        return [{ href: 'https://cross-site-tracker.com/click', getAttribute: () => '_blank' }];
      }
      return [];
    },
    querySelector: () => null,
    textContent: 'Tap to continue / Reklam'
  };

  const mockStyle = {
    position: 'fixed',
    zIndex: '9999',
    opacity: '1'
  };

  const mockRect = {
    width: 728,
    height: 90,
    top: 0,
    left: 200,
    right: 928,
    bottom: 90
  };

  const features = AxBrain.extractFeatures(mockEl, {
    computedStyle: mockStyle,
    rect: mockRect,
    currentHost: 'my-publisher.com',
    isLateInjected: true
  });

  assert.strictEqual(features.length, 12);
  assert.strictEqual(features[0], 1, 'isFixedOrSticky should be 1');
  assert.strictEqual(features[1], 0.5, 'highZIndex 9999 should be 0.5');
  assert.strictEqual(features[2], 1, 'hasCrossSiteLink should be 1');
  assert.strictEqual(features[3], 1, 'hasBlankTarget should be 1');
  assert.strictEqual(features[4], 1, 'isIabSize (728x90) should be 1');
  assert.strictEqual(features[10], 1, 'hasAdTokens should be 1');
  assert.strictEqual(features[11], 1, 'isLateInjected should be 1');
});

// Group 2: Online SGD Convergence
console.log('\n[Group 2: Online SGD Learning Convergence]');
runTest('Neutral clean feature vector produces low probability (< 0.25)', () => {
  const model = AxBrain.createDefaultModel();
  const cleanFeatures = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const pred = AxBrain.predict(cleanFeatures, model);
  assert.ok(pred.probability < 0.25, `Expected < 0.25, got ${pred.probability}`);
  assert.strictEqual(pred.isAd, false);
});

runTest('Training with label: 1 increases ad probability significantly', () => {
  const model = AxBrain.createDefaultModel();
  const adVector = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0];

  const pBefore = AxBrain.predict(adVector, model).probability;
  const updatedModel = AxBrain.train(adVector, 1, model, 0.25);
  const pAfter = AxBrain.predict(adVector, updatedModel).probability;

  assert.ok(pAfter > pBefore, `pAfter (${pAfter}) should be greater than pBefore (${pBefore})`);
  assert.strictEqual(updatedModel.sampleCount, 1);
});

runTest('Training with label: 0 reduces ad probability on user undo', () => {
  let model = AxBrain.createDefaultModel();
  const sampleVector = [1, 0.5, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0];

  // Train with 1
  model = AxBrain.train(sampleVector, 1, model, 0.25);
  const pHigh = AxBrain.predict(sampleVector, model).probability;

  // Undo by training with 0
  model = AxBrain.train(sampleVector, 0, model, 0.35);
  const pLow = AxBrain.predict(sampleVector, model).probability;

  assert.ok(pLow < pHigh, `pLow (${pLow}) should be less than pHigh (${pHigh})`);
});

// Group 3: Mathematical Stability & Bounded Weights
console.log('\n[Group 3: Mathematical Stability & Bounded Weights]');
runTest('100 consecutive training steps keep weights strictly within [-4.0, +4.0]', () => {
  let model = AxBrain.createDefaultModel();
  const aggressiveVector = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

  for (let i = 0; i < 100; i++) {
    model = AxBrain.train(aggressiveVector, 1, model, 0.5);
  }

  for (let i = 0; i < model.weights.length; i++) {
    const w = model.weights[i];
    assert.ok(!Number.isNaN(w), `Weight ${i} is NaN`);
    assert.ok(Number.isFinite(w), `Weight ${i} is not finite`);
    assert.ok(w <= 4.0, `Weight ${i} (${w}) exceeded +4.0 upper bound`);
    assert.ok(w >= -4.0, `Weight ${i} (${w}) subceeded -4.0 lower bound`);
  }

  assert.ok(!Number.isNaN(model.bias), 'Bias is NaN');
  assert.ok(Number.isFinite(model.bias), 'Bias is not finite');
  assert.ok(model.bias <= 2.0, `Bias (${model.bias}) exceeded +2.0 bound`);
  assert.ok(model.bias >= -5.0, `Bias (${model.bias}) subceeded -5.0 bound`);
});

// Group 4: Autonomous Threat Promotion to DNR (2001..2300)
console.log('\n[Group 4: Autonomous Threat Promotion to DNR (2001..2300)]');
await runAsyncTest('Strike 1 on bad domain records threat but does not promote yet', async () => {
  mockDynamicRules.length = 0;
  mockStorage.learnedDomains = [];

  const res = await reportBrainThreat({
    domain: 'tracker-threat-alpha.xyz',
    sourceHost: 'some-publisher.com',
    reason: 'vignette_popup'
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.strikes, 1);
  assert.strictEqual(res.promoted, false);
  assert.strictEqual(mockDynamicRules.length, 0, 'Should not promote to DNR after only 1 strike');
});

await runAsyncTest('Strike 2 on bad domain automatically promotes to DNR rule in 2001..2300', async () => {
  const res = await reportBrainThreat({
    domain: 'tracker-threat-alpha.xyz',
    sourceHost: 'some-publisher.com',
    reason: 'popup_shield_blocked'
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.strikes, 2);
  assert.strictEqual(res.promoted, true);

  assert.strictEqual(mockDynamicRules.length, 1);
  const rule = mockDynamicRules[0];
  assert.strictEqual(rule.id, LEARNED_DNR_START_ID);
  assert.strictEqual(rule.priority, 2);
  assert.strictEqual(rule.action.type, 'block');
  assert.strictEqual(rule.condition.urlFilter, '||tracker-threat-alpha.xyz^');
  assert.strictEqual(rule.condition.domainType, 'thirdParty');
});

await runAsyncTest('LRU eviction caps learned domains at 300', async () => {
  const state = await getAxBrainState();
  const list = state.learnedDomains;

  // Add 310 fake domains
  for (let i = 0; i < 310; i++) {
    list.push({
      domain: `bad-domain-${i}.info`,
      rootDomain: `bad-domain-${i}.info`,
      strikes: 2,
      lastSeen: Date.now() - (350 - i) * 1000,
      reasons: ['test']
    });
  }

  // Trigger reportBrainThreat to enforce LRU
  await reportBrainThreat({
    domain: 'newest-bad-domain.net',
    sourceHost: 'publisher.com',
    reason: 'test'
  });

  const updatedState = await getAxBrainState();
  assert.ok(
    updatedState.learnedDomains.length <= LEARNED_DOMAINS_MAX,
    `Learned domains count (${updatedState.learnedDomains.length}) exceeded MAX (${LEARNED_DOMAINS_MAX})`
  );
});

// Group 5: IMMUNE_ROOTS & Whitelist Absolute Safety
console.log('\n[Group 5: IMMUNE_ROOTS & Whitelist Absolute Safety]');
await runAsyncTest('IMMUNE_ROOTS are completely protected from auto-strikes and promotion', async () => {
  const immuneSamples = [
    'google.com',
    'youtube.com',
    'googlevideo.com',
    'ytimg.com',
    'twitch.tv',
    'github.com',
    'cloudflare.com',
    'accounts.google.com',
    'stripe.com',
    'paypal.com',
    'discord.com'
  ];

  for (const domain of immuneSamples) {
    const res = await reportBrainThreat({
      domain,
      sourceHost: 'random-site.com',
      reason: 'fake_alert'
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'immune_root');
  }

  // Ensure no DNR rules were created for any immune domain
  for (const r of mockDynamicRules) {
    for (const immune of immuneSamples) {
      assert.ok(!r.condition.urlFilter.includes(immune), `Found immune root in DNR: ${r.condition.urlFilter}`);
    }
  }
});

await runAsyncTest('Whitelisted domain is strictly protected from threat promotion', async () => {
  const res = await reportBrainThreat({
    domain: 'my-trusted-site.com',
    sourceHost: 'test.com',
    reason: 'blocked_nav'
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'whitelisted');
});

// Group 6: Performance Budget (< 15ms for 1,000 predictions)
console.log('\n[Group 6: Performance Budget]');
runTest('1,000 predictions complete in < 15ms (< 15 microseconds each)', () => {
  const model = AxBrain.createDefaultModel();
  const testVector = [1, 0.5, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1];

  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) {
    AxBrain.predict(testVector, model);
  }
  const t1 = performance.now();
  const elapsed = t1 - t0;

  console.log(`    (Actual time for 1,000 predictions: ${elapsed.toFixed(3)} ms)`);
  assert.ok(elapsed < 15.0, `1,000 predictions took ${elapsed.toFixed(3)}ms, exceeding 15ms budget`);
});

// Group 7: State Reset & TTL Pruning
console.log('\n[Group 7: State Reset & TTL Self-Pruning]');
await runAsyncTest('resetBrainState purges all learned models, domains and DNR rules', async () => {
  const resetRes = await resetBrainState();
  assert.strictEqual(resetRes.ok, true);

  const state = await getAxBrainState();
  assert.strictEqual(state.learnedDomains.length, 0);
  assert.strictEqual(state.learnedCosmetics.length, 0);
  assert.strictEqual(state.model.sampleCount, 0);

  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const learnedRules = rules.filter(
    (r) => r.id >= LEARNED_DNR_START_ID && r.id < LEARNED_DNR_START_ID + LEARNED_DNR_MAX_RULES
  );
  assert.strictEqual(learnedRules.length, 0, 'All learned DNR rules should be cleared');
});

await runAsyncTest('pruneExpiredBrainData removes items older than 60 days', async () => {
  const sixtyOneDaysAgo = Date.now() - 61 * 24 * 60 * 60 * 1000;
  mockStorage.learnedDomains = [
    { domain: 'old-threat.xyz', rootDomain: 'old-threat.xyz', strikes: 3, lastSeen: sixtyOneDaysAgo },
    { domain: 'recent-threat.xyz', rootDomain: 'recent-threat.xyz', strikes: 2, lastSeen: Date.now() - 1000 }
  ];

  await pruneExpiredBrainData();

  const state = await getAxBrainState();
  assert.strictEqual(state.learnedDomains.length, 1);
  assert.strictEqual(state.learnedDomains[0].domain, 'recent-threat.xyz');
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===\n`);
if (passedTests === totalTests) {
  console.log('✓ All AX-Brain tests passed successfully!\n');
} else {
  process.exit(1);
}
