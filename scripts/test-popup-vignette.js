/**
 * AX-Privacy Anti-Vignette & Pop-under Classifier Test Suite (v2.7.0)
 * Validates:
 *   1. Background tab-level pop-under URL classifier:
 *      - Accurately identifies malvertising patterns (/afu.php, /4/zone, zoneid+click_id, known pop-under networks)
 *      - Strictly preserves legitimate navigations (GitHub, Google, same-site links, manual tabs)
 *   2. Vignette / Interstitial detection heuristics (both in background.js and popup-shield.js):
 *      - Detects fake loading / tap-to-continue traps (e.g. "87% Yükleniyor... Devam etmek için dokunun / TAMAM")
 *      - Strictly preserves legitimate login dialogs (<input type="password">), video players (<video>), and forms
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Setup mock chrome API for Service Worker import in Node.js
globalThis.chrome = {
  declarativeNetRequest: {
    MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
    setExtensionActionOptions: async () => {},
    updateEnabledRulesets: async () => {},
    getDynamicRules: async () => []
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {}
  },
  storage: {
    local: {
      get: async () => ({ popupShield: true, whitelist: [] }),
      set: async () => {}
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
    getURL: (p) => p
  },
  tabs: {
    onCreated: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    get: async () => ({ url: '' }),
    update: async () => {},
    remove: async () => {}
  }
};

const { isPopunderAdUrl, getRootDomain, isVignetteCandidate } = await import('../background.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const popupShieldPath = path.resolve(__dirname, '../popup-shield.js');

console.log('=== AX-Privacy Anti-Vignette & Pop-under Classifier Test Suite ===\n');

// Verify popup-shield.js has the identical isVignetteCandidate logic
const popupShieldSource = fs.readFileSync(popupShieldPath, 'utf8');
const vignetteFnMatch = popupShieldSource.match(/function\s+isVignetteCandidate\s*\([\s\S]*?return\s+false;\s*\}/);
assert.ok(vignetteFnMatch, 'isVignetteCandidate must be present in popup-shield.js');

const vmContext = {};
vm.runInNewContext(`${vignetteFnMatch[0]}; extractedVignette = isVignetteCandidate;`, vmContext);
const shieldVignetteCandidate = vmContext.extractedVignette;
assert.strictEqual(typeof shieldVignetteCandidate, 'function');

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
// 1. Root Domain Helper
// ---------------------------------------------------------------------------
console.log('[Group 1: Root Domain Helper]');

runTest('Extracts root domain for common ccTLDs and standard domains', () => {
  assert.strictEqual(getRootDomain('netprime.me'), 'netprime.me');
  assert.strictEqual(getRootDomain('sub.netprime.me'), 'netprime.me');
  assert.strictEqual(getRootDomain('player.cdn.sub.netprime.me'), 'netprime.me');
  assert.strictEqual(getRootDomain('haberturk.com.tr'), 'haberturk.com.tr');
  assert.strictEqual(getRootDomain('bbc.co.uk'), 'bbc.co.uk');
  assert.strictEqual(getRootDomain('google.com'), 'google.com');
});

// ---------------------------------------------------------------------------
// 2. Background Tab-Level Pop-under URL Classifier
// ---------------------------------------------------------------------------
console.log('\n[Group 2: Pop-under URL Classifier]');

runTest('Detects Monetag / PropellerAds /afu.php pattern', () => {
  const url = 'https://untrusted-host.xyz/afu.php?zoneid=8847291&click_id=987654';
  assert.strictEqual(isPopunderAdUrl(url, 'movie-stream.com'), true);
});

runTest('Detects /4/ + 7+ digit zone ID pattern', () => {
  const url = 'https://direct-net.com/4/8847291?subid=abc';
  assert.strictEqual(isPopunderAdUrl(url, 'movie-stream.com'), true);
});

runTest('Detects push notification subscription traps (/ntfc.php, in-page-push)', () => {
  const url1 = 'https://alert-delivery.biz/ntfc.php?zone=5544';
  const url2 = 'https://some-network.com/in-page-push/show';
  assert.strictEqual(isPopunderAdUrl(url1, 'movie-stream.com'), true);
  assert.strictEqual(isPopunderAdUrl(url2, 'movie-stream.com'), true);
});

runTest('Detects known pop-under networks (popads, propellerads, adsterra, exoclick, etc.)', () => {
  assert.strictEqual(isPopunderAdUrl('https://popads.net/serve?ad=123', 'site.com'), true);
  assert.strictEqual(isPopunderAdUrl('https://adsterra.com/direct/link', 'site.com'), true);
  assert.strictEqual(isPopunderAdUrl('https://onclickalgo.com/landing', 'site.com'), true);
  assert.strictEqual(isPopunderAdUrl('https://monetag.com/push/view', 'site.com'), true);
  assert.strictEqual(isPopunderAdUrl('https://exoclick.com/tag', 'site.com'), true);
});

runTest('Detects query parameter signatures (zoneid + click_id / subid + offer_id)', () => {
  const url1 = 'https://random-traffic.net/track?zoneid=999999&click_id=xyz';
  const url2 = 'https://offer-rotator.com/out?subid=user1&offer_id=456';
  assert.strictEqual(isPopunderAdUrl(url1, 'site.com'), true);
  assert.strictEqual(isPopunderAdUrl(url2, 'site.com'), true);
});

runTest('Strictly PRESERVES legitimate websites and same-site navigations', () => {
  // Same root domain navigation is always preserved
  assert.strictEqual(
    isPopunderAdUrl('https://sub.movie-stream.com/watch/episode-1', 'movie-stream.com'),
    false
  );
  assert.strictEqual(
    isPopunderAdUrl('https://movie-stream.com/login', 'movie-stream.com'),
    false
  );

  // Common legitimate sites are never classified as pop-under
  assert.strictEqual(isPopunderAdUrl('https://github.com/Axthrowa', 'site.com'), false);
  assert.strictEqual(isPopunderAdUrl('https://www.google.com/search?q=test', 'site.com'), false);
  assert.strictEqual(isPopunderAdUrl('https://youtube.com/watch?v=dQw4w9WgXcQ', 'site.com'), false);
  assert.strictEqual(isPopunderAdUrl('https://wikipedia.org/wiki/Internet', 'site.com'), false);
  assert.strictEqual(isPopunderAdUrl('about:blank', 'site.com'), false);
  assert.strictEqual(isPopunderAdUrl('chrome://extensions', 'site.com'), false);
});

// ---------------------------------------------------------------------------
// 3. Vignette / Interstitial Detection Heuristics
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Vignette / Fake Loading Modal Detection]');

runTest('Detects fake loading / tap-to-continue bait modal', () => {
  const fakeModal = {
    tagName: 'DIV',
    style: { position: 'fixed', zIndex: '999999' },
    rect: { width: 1000, height: 800 },
    text: '87% Yükleniyor... Devam etmek için dokunun / TAMAM',
    hasPasswordInput: false,
    hasVideo: false,
    hasRealInputs: false,
    hasAuthKeywords: false
  };
  assert.strictEqual(isVignetteCandidate(fakeModal), true);
  assert.strictEqual(shieldVignetteCandidate(fakeModal), true);
});

runTest('Detects English tap to continue / press allow bait text', () => {
  const fakeModal1 = {
    tagName: 'DIV',
    style: { position: 'fixed', zIndex: '100000' },
    rect: { width: 900, height: 700 },
    text: 'Tap to continue. Press Allow to verify you are not a robot. OK',
    hasPasswordInput: false,
    hasVideo: false,
    hasRealInputs: false,
    hasAuthKeywords: false
  };
  assert.strictEqual(isVignetteCandidate(fakeModal1), true);
  assert.strictEqual(shieldVignetteCandidate(fakeModal1), true);

  const fakeModal2 = {
    tagName: 'DIV',
    style: { position: 'fixed', zIndex: '999999' },
    rect: { width: 900, height: 700 },
    text: 'Click to continue. Loading... 95%',
    hasPasswordInput: false,
    hasVideo: false,
    hasRealInputs: false,
    hasAuthKeywords: false
  };
  assert.strictEqual(isVignetteCandidate(fakeModal2), true);
  assert.strictEqual(shieldVignetteCandidate(fakeModal2), true);
});

runTest('Detects Max-Z-Index fullscreen ad iframe or transparent click curtain', () => {
  const adIframe = {
    tagName: 'IFRAME',
    style: { position: 'fixed', zIndex: '2147483647' },
    rect: { width: 1200, height: 900 },
    src: 'about:blank',
    hasPasswordInput: false,
    hasVideo: false,
    hasRealInputs: false,
    hasAuthKeywords: false
  };
  assert.strictEqual(isVignetteCandidate(adIframe), true);
  assert.strictEqual(shieldVignetteCandidate(adIframe), true);

  const clickCurtain = {
    tagName: 'DIV',
    style: { position: 'fixed', zIndex: '100000' },
    rect: { width: 1200, height: 900 },
    text: '',
    hasPasswordInput: false,
    hasVideo: false,
    hasRealInputs: false,
    hasAuthKeywords: false
  };
  assert.strictEqual(isVignetteCandidate(clickCurtain), true);
  assert.strictEqual(shieldVignetteCandidate(clickCurtain), true);
});

runTest('Strictly PRESERVES login forms (<input type="password">)', () => {
  const loginModal = {
    tagName: 'DIV',
    style: { position: 'fixed', zIndex: '999999' },
    rect: { width: 500, height: 600 },
    text: 'Giriş Yapın. Devam etmek için şifrenizi girin.',
    hasPasswordInput: true, // Login form!
    hasVideo: false,
    hasRealInputs: true,
    hasAuthKeywords: true
  };
  assert.strictEqual(isVignetteCandidate(loginModal), false);
  assert.strictEqual(shieldVignetteCandidate(loginModal), false);
});

runTest('Strictly PRESERVES legitimate video players and embeds', () => {
  const videoContainer = {
    tagName: 'DIV',
    style: { position: 'fixed', zIndex: '999999' },
    rect: { width: 1280, height: 720 },
    text: 'Yükleniyor...',
    hasPasswordInput: false,
    hasVideo: true, // Video element inside!
    hasRealInputs: false,
    hasAuthKeywords: false
  };
  assert.strictEqual(isVignetteCandidate(videoContainer), false);
  assert.strictEqual(shieldVignetteCandidate(videoContainer), false);
});

runTest('Strictly PRESERVES legitimate cookie consent or terms dialogs with real content', () => {
  const cookieBanner = {
    tagName: 'DIV',
    style: { position: 'fixed', zIndex: '99999' },
    rect: { width: 600, height: 300 },
    text: 'Bu web sitesi çerezleri kullanır. Gizlilik Politikamızı ve Kullanım Şartlarımızı okuyun.',
    hasPasswordInput: false,
    hasVideo: false,
    hasRealInputs: false,
    hasAuthKeywords: false
  };
  assert.strictEqual(isVignetteCandidate(cookieBanner), false);
  assert.strictEqual(shieldVignetteCandidate(cookieBanner), false);
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===\n`);
if (passedTests === totalTests) {
  console.log('✓ All Anti-Vignette & Pop-under Classifier tests passed successfully!');
} else {
  process.exit(1);
}
