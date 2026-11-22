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

const {
  isPopunderAdUrl,
  getRootDomain,
  isVignetteCandidate,
  shouldBlockNewTab,
  shouldBlockTabNavigation,
  lastKnownTabUrls,
  recordTrustedIntent,
  hasValidTrustedIntent,
  evaluateUrlThreat,
  lastUserNewTabClicks,
  lastMiddleClickMap,
  lastUserInteractionMap,
  recordUserInteraction,
  hasRecentUserInteraction,
  PROTECTED_INFRASTRUCTURE,
  LEGITIMATE_HOST_WHITELIST,
  isTrustedFeedOpener
} = await import('../background.js');

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

const devToolsFnMatch = popupShieldSource.match(/function\s+isDevToolsKey\s*\([\s\S]*?return\s+false;\s*\}/);
assert.ok(devToolsFnMatch, 'isDevToolsKey must be present in popup-shield.js');
vm.runInNewContext(`${devToolsFnMatch[0]}; extractedDevTools = isDevToolsKey;`, vmContext);
const shieldDevToolsKey = vmContext.extractedDevTools;
assert.strictEqual(typeof shieldDevToolsKey, 'function');

// Run full popup-shield.js with mock environment to test synchronous intent & pre-open hooks
const mockSessionStorage = new Map();
const registeredListeners = new Map();
const mockWindow = {
  location: { href: 'https://mysite.com/page', hostname: 'mysite.com', origin: 'https://mysite.com' },
  sessionStorage: {
    getItem: (k) => mockSessionStorage.get(k) || null,
    setItem: (k, v) => mockSessionStorage.set(k, String(v)),
    removeItem: (k) => mockSessionStorage.delete(k)
  },
  history: { length: 2 },
  name: '',
  open: () => ({}),
  close: () => {},
  addEventListener: (type, listener) => {
    registeredListeners.set(type, listener);
  },
  postMessage: () => {}
};
const fullVmContext = {
  window: mockWindow,
  sessionStorage: mockWindow.sessionStorage,
  document: { documentElement: null },
  Node: class Node {},
  Element: class Element {},
  HTMLAnchorElement: class HTMLAnchorElement {},
  HTMLIFrameElement: class HTMLIFrameElement {},
  EventTarget: class EventTarget {},
  HTMLFormElement: class HTMLFormElement {},
  MutationObserver: class { observe() {} },
  module: { exports: {} },
  console,
  setTimeout,
  clearTimeout,
  Date,
  URL
};
vm.runInNewContext(popupShieldSource, fullVmContext);
const {
  setTrustedIntent: shieldSetTrustedIntent,
  hasTrustedIntent: shieldHasTrustedIntent,
  hasTrustedClick: shieldHasTrustedClick,
  isAllowedDestination: shieldIsAllowedDestination,
  isAllowedNavigation: shieldIsAllowedNavigation,
  getTrustedClickUntil: shieldGetTrustedClickUntil
} = fullVmContext.module.exports;
assert.strictEqual(typeof shieldSetTrustedIntent, 'function');
assert.strictEqual(typeof shieldHasTrustedIntent, 'function');
assert.strictEqual(typeof shieldHasTrustedClick, 'function');
assert.strictEqual(typeof shieldIsAllowedDestination, 'function');
assert.strictEqual(typeof shieldIsAllowedNavigation, 'function');

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

// ---------------------------------------------------------------------------
// 4. Intent-Verified Tab Shield Decision Engine (v2.8.0)
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Intent-Verified Tab Shield Decision Engine]');

runTest('Blocks cross-site random ad domain when no user intent exists', () => {
  const result = shouldBlockNewTab({
    openerTabId: 101,
    openerUrl: 'https://film-dizi-izle.net/izle',
    tabUrl: 'https://random-ad-9921.xyz/go',
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(result.block, true);
  assert.strictEqual(result.reason, 'unsolicited_cross_site_tab');
});

runTest('Allows cross-site tab when verified trusted intent exists in memory', () => {
  const testStore = new Map();
  recordTrustedIntent(102, 'external-partner.com', 'https://external-partner.com/product/123', testStore);

  const result = shouldBlockNewTab({
    openerTabId: 102,
    openerUrl: 'https://film-dizi-izle.net/izle',
    tabUrl: 'https://external-partner.com/product/123',
    intentsStore: testStore,
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'trusted_user_intent');
});

runTest('Allows manual user-initiated tabs without openerTabId (Ctrl+T, bookmarks, omnibox)', () => {
  const result = shouldBlockNewTab({
    openerTabId: null,
    tabUrl: 'https://any-site.com',
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'user_initiated_no_opener');
});

runTest('Allows legitimate same-site links and subdomains', () => {
  const result = shouldBlockNewTab({
    openerTabId: 103,
    openerUrl: 'https://example.com/page1',
    tabUrl: 'https://sub.example.com/page2',
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'same_site');
});

runTest('Allows authentication and payment gateways without prior intent', () => {
  const oauthResult = shouldBlockNewTab({
    openerTabId: 104,
    openerUrl: 'https://mystore.com/checkout',
    tabUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(oauthResult.block, false);
  assert.strictEqual(oauthResult.reason, 'auth_or_payment_gateway');

  const stripeResult = shouldBlockNewTab({
    openerTabId: 104,
    openerUrl: 'https://mystore.com/checkout',
    tabUrl: 'https://checkout.stripe.com/c/pay/cs_live_123',
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(stripeResult.block, false);
  assert.strictEqual(stripeResult.reason, 'auth_or_payment_gateway');

  const iyzicoResult = shouldBlockNewTab({
    openerTabId: 104,
    openerUrl: 'https://mystore.com/checkout',
    tabUrl: 'https://sandbox-api.iyzico.com/payment',
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(iyzicoResult.block, false);
  assert.strictEqual(iyzicoResult.reason, 'auth_or_payment_gateway');
});

runTest('Allows search engine and social media feed openers', () => {
  const googleFeedResult = shouldBlockNewTab({
    openerTabId: 105,
    openerUrl: 'https://www.google.com/search?q=test',
    tabUrl: 'https://destination-result.org/doc',
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(googleFeedResult.block, false);
  assert.strictEqual(googleFeedResult.reason, 'trusted_opener_feed');

  const redditFeedResult = shouldBlockNewTab({
    openerTabId: 105,
    openerUrl: 'https://reddit.com/r/technology',
    tabUrl: 'https://news-outlet.com/article',
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(redditFeedResult.block, false);
  assert.strictEqual(redditFeedResult.reason, 'trusted_opener_feed');
});

runTest('Allows whitelisted opener domains', () => {
  const result = shouldBlockNewTab({
    openerTabId: 106,
    openerUrl: 'https://trusted-site.com/hub',
    tabUrl: 'https://cross-site.com/view',
    whitelist: ['trusted-site.com'],
    popupShield: true
  });
  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'opener_whitelisted');
});

runTest('Allows all tabs when popupShield is disabled in settings', () => {
  const result = shouldBlockNewTab({
    openerTabId: 107,
    openerUrl: 'https://ad-site.com',
    tabUrl: 'https://random-ad.xyz',
    whitelist: [],
    popupShield: false
  });
  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'shield_disabled');
});

// ---------------------------------------------------------------------------
// 5. Anti-DevTools & Right-Click Guard (v2.8.0)
// ---------------------------------------------------------------------------
console.log('\n[Group 5: Anti-DevTools Key Classifier]');

runTest('Correctly classifies F12 key events', () => {
  assert.strictEqual(shieldDevToolsKey({ key: 'F12' }), true);
  assert.strictEqual(shieldDevToolsKey({ keyCode: 123 }), true);
});

runTest('Correctly classifies Ctrl+Shift+I / J / C (DevTools inspector)', () => {
  assert.strictEqual(shieldDevToolsKey({ ctrlKey: true, shiftKey: true, key: 'I' }), true);
  assert.strictEqual(shieldDevToolsKey({ metaKey: true, shiftKey: true, key: 'J' }), true);
  assert.strictEqual(shieldDevToolsKey({ ctrlKey: true, shiftKey: true, key: 'C' }), true);
  assert.strictEqual(shieldDevToolsKey({ ctrlKey: true, shiftKey: true, keyCode: 73 }), true);
});

runTest('Correctly classifies Ctrl+U (View Page Source)', () => {
  assert.strictEqual(shieldDevToolsKey({ ctrlKey: true, shiftKey: false, key: 'u' }), true);
  assert.strictEqual(shieldDevToolsKey({ metaKey: true, shiftKey: false, keyCode: 85 }), true);
});

runTest('Does not classify normal keys or typing events', () => {
  assert.strictEqual(shieldDevToolsKey({ key: 'Enter' }), false);
  assert.strictEqual(shieldDevToolsKey({ key: 'a' }), false);
  assert.strictEqual(shieldDevToolsKey({ ctrlKey: true, key: 'c' }), false); // Normal copy
  assert.strictEqual(shieldDevToolsKey({ ctrlKey: true, key: 'v' }), false); // Normal paste
  assert.strictEqual(shieldDevToolsKey({ key: 'F5' }), false); // Refresh
});

// ---------------------------------------------------------------------------
// 6. Synchronous Intent & Pre-Open Blocking Engine (v2.9.0)
// ---------------------------------------------------------------------------
console.log('\n[Group 6: Synchronous Intent & Pre-Open Blocking Engine (v2.9.0)]');

runTest('hasTrustedIntent initially returns false for random ad destination', () => {
  assert.strictEqual(shieldHasTrustedIntent('https://random-ad-9921.xyz/go'), false);
});

runTest('setTrustedIntent synchronously stores intent in memory, sessionStorage and window.name', () => {
  shieldSetTrustedIntent('https://partner.com/deal');
  assert.strictEqual(shieldHasTrustedIntent('https://partner.com/deal'), true);
  assert.strictEqual(shieldHasTrustedIntent('https://sub.partner.com/deal'), true);
  assert.strictEqual(mockSessionStorage.has('__ax_trusted_intent'), true);
  assert.ok(mockWindow.name.includes('__axIntent'));
});

runTest('isAllowedDestination blocks unauthorized cross-site ad pop-ups', () => {
  assert.strictEqual(shieldIsAllowedDestination('https://random-ad-9921.xyz/go'), false);
  assert.strictEqual(shieldIsAllowedDestination('https://malicious-network.org/out'), false);
});

runTest('isAllowedDestination permits authorized cross-site destination when intent exists', () => {
  assert.strictEqual(shieldIsAllowedDestination('https://partner.com/deal'), true);
});

runTest('isAllowedDestination blocks empty or about:blank URLs without active intent', () => {
  // Clear intent
  shieldSetTrustedIntent(null);
  assert.strictEqual(shieldIsAllowedDestination('about:blank'), false);
  assert.strictEqual(shieldIsAllowedDestination(''), false);
});

runTest('isAllowedDestination permits about:blank when synchronous intent is active', () => {
  shieldSetTrustedIntent('https://any-trusted.org');
  assert.strictEqual(shieldIsAllowedDestination('about:blank'), true);
});

runTest('isAllowedDestination always permits same-site and relative URLs', () => {
  assert.strictEqual(shieldIsAllowedDestination('https://mysite.com/dashboard'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://cdn.mysite.com/asset.js'), true);
  assert.strictEqual(shieldIsAllowedDestination('/internal/relative/path'), true);
});

runTest('isAllowedDestination always permits authentication and payment gateways', () => {
  assert.strictEqual(shieldIsAllowedDestination('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://appleid.apple.com/auth/authorize'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://login.microsoftonline.com/common/oauth2'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://checkout.stripe.com/pay/cs_123'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://sandbox-api.iyzico.com/payment'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://www.paypal.com/cgi-bin/webscr'), true);
});

runTest('isAllowedDestination permits all destinations if popupShield is disabled in sessionStorage', () => {
  mockSessionStorage.set('ax_privacy_popup_shield', 'disabled');
  assert.strictEqual(shieldIsAllowedDestination('https://random-ad-9921.xyz/go'), true);
  mockSessionStorage.delete('ax_privacy_popup_shield');
});

// ---------------------------------------------------------------------------
// 7. Anti-DevTools Redirect & Navigation Shield (v3.0.0)
// ---------------------------------------------------------------------------
console.log('\n[Group 7: Anti-DevTools Redirect & Navigation Shield (v3.0.0)]');

runTest('isAllowedNavigation blocks unsolicited redirect to google.com (Anti-DevTools)', () => {
  shieldSetTrustedIntent(null);
  assert.strictEqual(shieldIsAllowedNavigation('https://www.google.com'), false);
  assert.strictEqual(shieldIsAllowedNavigation('https://google.com/'), false);
});

runTest('isAllowedNavigation blocks unsolicited redirect to bing.com or about:blank', () => {
  shieldSetTrustedIntent(null);
  assert.strictEqual(shieldIsAllowedNavigation('https://bing.com'), false);
  assert.strictEqual(shieldIsAllowedNavigation('about:blank'), false);
});

runTest('isAllowedNavigation permits same-site and relative navigations', () => {
  assert.strictEqual(shieldIsAllowedNavigation('https://mysite.com/login'), true);
  assert.strictEqual(shieldIsAllowedNavigation('https://sub.mysite.com/dashboard'), true);
  assert.strictEqual(shieldIsAllowedNavigation('/relative/path'), true);
  assert.strictEqual(shieldIsAllowedNavigation('#anchor-link'), true);
});

runTest('isAllowedNavigation permits cross-site redirect when explicit trusted intent exists', () => {
  shieldSetTrustedIntent('https://accounts.google.com/oauth');
  assert.strictEqual(shieldIsAllowedNavigation('https://accounts.google.com/oauth'), true);
  shieldSetTrustedIntent(null);
});

runTest('isAllowedNavigation permits navigation when popupShield is disabled in sessionStorage', () => {
  mockSessionStorage.set('ax_privacy_popup_shield', 'disabled');
  assert.strictEqual(shieldIsAllowedNavigation('https://www.google.com'), true);
  mockSessionStorage.delete('ax_privacy_popup_shield');
});

runTest('recordTrustedIntent provides 4000ms validity in background.js', () => {
  const testStore = new Map();
  recordTrustedIntent(101, 'target-service.com', 'https://target-service.com/api', testStore);
  const entries = testStore.get(101);
  assert.ok(entries && entries.length === 1);
  const now = Date.now();
  assert.ok(entries[0].expiresAt >= now + 3900 && entries[0].expiresAt <= now + 4100);
});

// ---------------------------------------------------------------------------
// 8. Middle-Click & Comprehensive Threat Shield Parity (v3.1.0)
// ---------------------------------------------------------------------------
console.log('\n[Group 8: Middle-Click & Threat Shield Parity (v3.1.0)]');

runTest('recordTrustedIntent tracks middle-click intent in lastUserNewTabClicks and validates via fallback', () => {
  const testStore = new Map();
  recordTrustedIntent(201, 'external-blog.com', 'https://external-blog.com/article/1', testStore, {
    isMiddleClick: true,
    button: 1
  });

  // Verify direct intent matching
  assert.strictEqual(hasValidTrustedIntent(201, 'external-blog.com', 'https://external-blog.com/article/1', testStore), true);

  // Verify recent click fallback for redirected URL
  assert.ok(lastUserNewTabClicks.has(201));
  const clickData = lastUserNewTabClicks.get(201);
  assert.strictEqual(clickData.isMiddleClick, true);
  assert.strictEqual(clickData.targetHost, 'external-blog.com');

  // shouldBlockNewTab allows redirected URL when recent user new tab action exists
  const redirectResult = shouldBlockNewTab({
    openerTabId: 201,
    openerUrl: 'https://news-site.org/feed',
    tabUrl: 'https://shortener-target.com/page',
    intentsStore: testStore,
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(redirectResult.block, false);
  assert.strictEqual(redirectResult.reason, 'trusted_user_intent');
});

runTest('isPopunderAdUrl detects newly added ad/redirect networks and affiliate traps', () => {
  assert.strictEqual(isPopunderAdUrl('https://admaven.com/pop/show'), true);
  assert.strictEqual(isPopunderAdUrl('https://sub.vignetteads.com/zone'), true);
  assert.strictEqual(isPopunderAdUrl('https://zeroredirect.com/redirect?to=ad'), true);
  assert.strictEqual(isPopunderAdUrl('https://trafee.com/link'), true);
  assert.strictEqual(isPopunderAdUrl('https://randomsite.org/landing?affid=9921&campaignid=332'), true);
});

runTest('evaluateUrlThreat flags high-risk scam TLDs combined with financial or auth keywords', () => {
  const scam1 = evaluateUrlThreat('https://secure-bank-login.xyz/auth');
  assert.strictEqual(scam1.level, 'danger');
  assert.strictEqual(scam1.type, 'scam_domain_pattern');

  const scam2 = evaluateUrlThreat('https://metamask-crypto-wallet.top/claim');
  assert.strictEqual(scam2.level, 'danger');
  assert.strictEqual(scam2.type, 'scam_domain_pattern');

  const normalSite = evaluateUrlThreat('https://developer.mozilla.org/en-US/docs');
  assert.strictEqual(normalSite.level, 'safe');
});

console.log('\n[Group 9: Safe Infrastructure & Feed Platforms (v3.1.1)]');

runTest('PROTECTED_INFRASTRUCTURE preserves Twitter/X, Instagram, CDNs, WordPress, Cloudflare and E-Commerce Platforms', () => {
  const critical = [
    'video.twimg.com',
    'twimg.com',
    'x.com',
    't.co',
    'instagram.com',
    'cdninstagram.com',
    'cdn.jsdelivr.net',
    'cloudflare.com',
    'storage.googleapis.com',
    'googleusercontent.com',
    'wp.com',
    'i0.wp.com',
    'discord.com',
    'cdn.discordapp.com',
    'akakce.com',
    'st.akakce.com',
    'api6.akakce.com',
    'cimri.com',
    'hepsiburada.com',
    'trendyol.com',
    'amazon.com.tr',
    'donanimhaber.com',
    'turkiye.gov.tr'
  ];
  for (const domain of critical) {
    const isProtected = PROTECTED_INFRASTRUCTURE.some((p) => domain === p || domain.endsWith('.' + p));
    assert.strictEqual(isProtected, true, `${domain} must be protected infrastructure`);
  }
});

runTest('isTrustedFeedOpener permits Instagram, X/Twitter, Facebook, Reddit and YouTube openers', () => {
  assert.strictEqual(isTrustedFeedOpener('instagram.com'), true);
  assert.strictEqual(isTrustedFeedOpener('www.instagram.com'), true);
  assert.strictEqual(isTrustedFeedOpener('x.com'), true);
  assert.strictEqual(isTrustedFeedOpener('twitter.com'), true);
  assert.strictEqual(isTrustedFeedOpener('facebook.com'), true);
  assert.strictEqual(isTrustedFeedOpener('threads.net'), true);
  assert.strictEqual(isTrustedFeedOpener('tiktok.com'), true);
  assert.strictEqual(isTrustedFeedOpener('reddit.com'), true);
  assert.strictEqual(isTrustedFeedOpener('google.com'), true);
  assert.strictEqual(isTrustedFeedOpener('akakce.com'), true);
  assert.strictEqual(isTrustedFeedOpener('www.akakce.com'), true);
  assert.strictEqual(isTrustedFeedOpener('cimri.com'), true);
  assert.strictEqual(isTrustedFeedOpener('randompiratesite.com'), false);
});

runTest('shouldBlockNewTab allows external outbound links originating from Instagram and Twitter feeds', () => {
  const igResult = shouldBlockNewTab({
    openerTabId: 301,
    openerUrl: 'https://www.instagram.com/',
    tabUrl: 'https://someexternalshop.com/product/123',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(igResult.block, false);
  assert.strictEqual(igResult.reason, 'trusted_opener_feed');

  const xResult = shouldBlockNewTab({
    openerTabId: 302,
    openerUrl: 'https://x.com/home',
    tabUrl: 'https://newsoutlet.org/article',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(xResult.block, false);
  assert.strictEqual(xResult.reason, 'trusted_opener_feed');
});

runTest('LEGITIMATE_HOST_WHITELIST protects major platform destinations', () => {
  assert.strictEqual(LEGITIMATE_HOST_WHITELIST.has('instagram.com'), true);
  assert.strictEqual(LEGITIMATE_HOST_WHITELIST.has('x.com'), true);
  assert.strictEqual(LEGITIMATE_HOST_WHITELIST.has('reddit.com'), true);
  assert.strictEqual(LEGITIMATE_HOST_WHITELIST.has('discord.com'), true);
  assert.strictEqual(LEGITIMATE_HOST_WHITELIST.has('akakce.com'), true);
  assert.strictEqual(LEGITIMATE_HOST_WHITELIST.has('hepsiburada.com'), true);
  assert.strictEqual(LEGITIMATE_HOST_WHITELIST.has('trendyol.com'), true);
  assert.strictEqual(LEGITIMATE_HOST_WHITELIST.has('amazon.com.tr'), true);
});

console.log('\n[Group 10: Anti-Adblock Defusers & Surrogates (v3.2.0)]');

runTest('Surrogates exist and do not crash web applications', () => {
  assert.strictEqual(typeof fullVmContext.window.gtag, 'function');
  assert.strictEqual(typeof fullVmContext.window.ga, 'function');
  assert.strictEqual(typeof fullVmContext.window.fbq, 'function');
  assert.ok(Array.isArray(fullVmContext.window.dataLayer));
  assert.ok(Array.isArray(fullVmContext.window.adsbygoogle));

  // Verify calling them does not throw
  assert.doesNotThrow(() => fullVmContext.window.gtag('event', 'test'));
  assert.doesNotThrow(() => fullVmContext.window.ga('send', 'pageview'));
  assert.doesNotThrow(() => fullVmContext.window.fbq('track', 'PageView'));
  assert.doesNotThrow(() => fullVmContext.window.adsbygoogle.push({}));
});

runTest('Anti-Adblock Defusers neutralize FuckAdBlock, BlockAdBlock and canRunAds checks', () => {
  assert.strictEqual(fullVmContext.window.canRunAds, true);
  assert.strictEqual(fullVmContext.window.isAdBlockActive, false);
  assert.strictEqual(fullVmContext.window.adblock, false);
  assert.strictEqual(typeof fullVmContext.window.fuckAdBlock, 'object');
  assert.strictEqual(typeof fullVmContext.window.blockAdBlock, 'object');
  assert.strictEqual(fullVmContext.window.fuckAdBlock.check(), true);
  assert.strictEqual(typeof fullVmContext.window.fuckAdBlock.onDetected, 'function');
});

console.log('\n[Group 11: Publisher Domain & WebP Image Immunity (v3.2.1)]');

runTest('Publisher domains with path-only ad rules are NEVER blocked in ads_trackers.json', () => {
  const adsRules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules', 'ads_trackers.json'), 'utf8'));
  const blockedDomainFilters = new Set(adsRules.map((r) => r.condition.urlFilter));

  const protectedPublishers = [
    'dizibox.live',
    'diziboxx.com',
    'dizipal.org',
    'onedio.com',
    'sozcu.com.tr',
    'milliyet.com.tr',
    'cumhuriyet.com.tr',
    'technopat.net',
    'tamindir.com',
    'haberler.com',
    'bisikletforum.com',
    'airlinehaber.com',
    'airporthaber.com'
  ];

  for (const pub of protectedPublishers) {
    assert.strictEqual(
      blockedDomainFilters.has(`||${pub}^`),
      false,
      `Publisher website ${pub} must not be blocked at the domain level!`
    );
  }
});

console.log('\n[Group 12: Legitimate Tab Protection & Strict Opener Intent (v3.3.2)]');

runTest('Tabs opened without openerTabId (omnibox, bookmarks, new tab button) are NEVER closed', () => {
  const resultNull = shouldBlockNewTab({
    openerTabId: null,
    openerUrl: '',
    tabUrl: 'https://example.com/welcome',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(resultNull.block, false);
  assert.strictEqual(resultNull.reason, 'user_initiated_no_opener');

  const resultUndefined = shouldBlockNewTab({
    openerTabId: undefined,
    openerUrl: '',
    tabUrl: 'https://github.com/trending',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(resultUndefined.block, false);
  assert.strictEqual(resultUndefined.reason, 'user_initiated_no_opener');

  const resultZero = shouldBlockNewTab({
    openerTabId: 0,
    openerUrl: '',
    tabUrl: 'https://reddit.com/r/technology',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true
  });
  assert.strictEqual(resultZero.block, false);
  assert.strictEqual(resultZero.reason, 'user_initiated_no_opener');
});

runTest('Recent trusted user interaction on opener tab keeps new tab open (allow)', () => {
  const interactions = new Map();
  const openerId = 888;
  interactions.set(openerId, Date.now() - 400); // Interacted 400ms ago

  const result = shouldBlockNewTab({
    openerTabId: openerId,
    openerUrl: 'https://blog.tech.org/posts/1',
    tabUrl: 'https://someexternalresource.io/docs',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true,
    interactionsStore: interactions
  });
  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'recent_user_interaction');
});

runTest('Unsolicited pop-under or ad network without user intent or interaction is BLOCKED', () => {
  const interactions = new Map(); // empty
  const intents = new Map(); // empty

  // Known pop-under ad path
  const adPathResult = shouldBlockNewTab({
    openerTabId: 999,
    openerUrl: 'https://pirate-streaming-hub.xyz/watch',
    tabUrl: 'https://propellerads.com/afu.php?zoneid=12345',
    intentsStore: intents,
    whitelist: [],
    popupShield: true,
    interactionsStore: interactions
  });
  assert.strictEqual(adPathResult.block, true);
  assert.ok(
    adPathResult.reason === 'popunder_ad_path' || adPathResult.reason === 'known_popunder_ad_signature'
  );

  // Unsolicited cross-site popup from untrusted site to random ad network
  const crossSiteResult = shouldBlockNewTab({
    openerTabId: 999,
    openerUrl: 'https://pirate-streaming-hub.xyz/watch',
    tabUrl: 'https://random-scam-popunder-network.net/lander',
    intentsStore: intents,
    whitelist: [],
    popupShield: true,
    interactionsStore: interactions
  });
  assert.strictEqual(crossSiteResult.block, true);
  assert.strictEqual(crossSiteResult.reason, 'unsolicited_cross_site_tab');
});

runTest('popup-shield hasTrustedClick allows about:blank and legitimate destinations within 2500ms', () => {
  assert.strictEqual(shieldHasTrustedClick(), false);

  // When trusted click is recorded
  fullVmContext.trustedClickUntil = Date.now() + 2500;
  // Test destinations allowed when hasTrustedClick is true
  assert.strictEqual(
    shieldIsAllowedDestination('https://accounts.google.com/o/oauth2/v2/auth'),
    true
  );
  assert.strictEqual(
    shieldIsAllowedDestination('https://gitlab.com/login'),
    true
  );
  assert.strictEqual(
    shieldIsAllowedDestination('https://twitch.tv/'),
    true
  );
});

console.log('\n[Group 13: Netprime Unrequested Redirect & Close Protection (v3.3.3)]');

runTest('Unrequested redirect to google.com on netprime without <a href> link click is BLOCKED', () => {
  const result = shouldBlockTabNavigation({
    previousUrl: 'https://netprime.me/watch?v=123',
    newUrl: 'https://google.com/',
    tabId: 10,
    whitelist: [],
    popupShield: true,
    userClickedNavMap: new Map() // Empty, no <a> click
  });
  assert.strictEqual(result.block, true);
  assert.strictEqual(result.reason, 'unsolicited_cross_site_redirect');
});

runTest('Verified <a href="https://example.com"> click allows navigation to example.com', () => {
  const clicks = new Map();
  clicks.set(10, {
    timestamp: Date.now() - 300,
    targetHost: 'example.com',
    targetRoot: 'example.com',
    href: 'https://example.com/movie'
  });

  const result = shouldBlockTabNavigation({
    previousUrl: 'https://netprime.me/watch?v=123',
    newUrl: 'https://example.com/movie',
    tabId: 10,
    whitelist: [],
    popupShield: true,
    userClickedNavMap: clicks
  });
  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'user_clicked_link');
});

runTest('Blank space / video click on netprime does NOT permit unprompted pop-up to google.com', () => {
  const interactions = new Map();
  const result = shouldBlockNewTab({
    openerTabId: 50,
    openerUrl: 'https://netprime.me/watch',
    tabUrl: 'https://google.com/',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true,
    interactionsStore: interactions
  });
  assert.strictEqual(result.block, true);
  assert.strictEqual(result.reason, 'unsolicited_cross_site_tab');
});

runTest('popup-shield blocks location redirect to google.com without trusted link click', () => {
  shieldSetTrustedIntent(null);
  fullVmContext.trustedClickUntil = 0;

  assert.strictEqual(shieldIsAllowedNavigation('https://google.com'), false);
  assert.strictEqual(shieldIsAllowedDestination('https://google.com'), false);
});

runTest('popup-shield intercepts unauthorized window.close on tabs with history', () => {
  assert.strictEqual(typeof fullVmContext.window.close, 'function');
  assert.doesNotThrow(() => fullVmContext.window.close());
});

console.log('\n[Group 14: Mouse Wheel (Middle-Click) Tab Preservation (v3.3.4)]');

runTest('Middle-click intent in lastMiddleClickMap preserves new tab opened via wheel', () => {
  const mcMap = new Map();
  mcMap.set(88, {
    ts: Date.now() - 200,
    sourceHost: 'news.ycombinator.com',
    sourceRoot: 'ycombinator.com',
    targetHost: 'github.com',
    targetRoot: 'github.com',
    href: 'https://github.com/google'
  });

  const result = shouldBlockNewTab({
    openerTabId: 88,
    openerUrl: 'https://news.ycombinator.com/',
    tabUrl: 'https://github.com/google',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true,
    middleClickStore: mcMap
  });

  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'middle_click_wheel_intent');
});

runTest('Middle-click intent on link (isMiddleClick: true) preserves new background tab', () => {
  const clicks = new Map();
  clicks.set(99, {
    timestamp: Date.now() - 500,
    targetHost: 'example.org',
    targetRoot: 'example.org',
    href: 'https://example.org/article',
    isMiddleClick: true
  });

  const result = shouldBlockNewTab({
    openerTabId: 99,
    openerUrl: 'https://medium.com/@author/story',
    tabUrl: 'https://example.org/article',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true,
    userClicksStore: clicks
  });

  assert.strictEqual(result.block, false);
  assert.strictEqual(result.reason, 'middle_click_user_intent');
});

runTest('Unsolicited pop-under without middle-click or link intent is strictly blocked', () => {
  const emptyMcMap = new Map();
  const emptyClicks = new Map();

  const result = shouldBlockNewTab({
    openerTabId: 77,
    openerUrl: 'https://pirate-streaming.com/video',
    tabUrl: 'https://random-dating-tracker.xyz/lander',
    intentsStore: new Map(),
    whitelist: [],
    popupShield: true,
    middleClickStore: emptyMcMap,
    userClicksStore: emptyClicks
  });

  assert.strictEqual(result.block, true);
  assert.strictEqual(result.reason, 'unsolicited_cross_site_tab');
});

runTest('popup-shield preserves trustedClickUntil for 3500ms on middle click (button === 1)', () => {
  const pointerEvent = {
    isTrusted: true,
    button: 1,
    target: {
      closest: () => null,
      matches: () => false
    }
  };

  const pointerHandler = registeredListeners.get('pointerdown');
  assert.strictEqual(typeof pointerHandler, 'function');
  pointerHandler(pointerEvent);

  const until = shieldGetTrustedClickUntil();
  assert.ok(
    until > Date.now() + 3000,
    'trustedClickUntil should be at least 3000ms into the future after middle click'
  );
});

runTest('popup-shield preserves trustedClickUntil and intent on anchor middle click (button === 1)', () => {
  const mockAnchor = {
    tagName: 'A',
    href: 'https://github.com/google',
    innerText: 'Google on GitHub',
    getAttribute: (attr) => (attr === 'href' ? 'https://github.com/google' : null),
    hasAttribute: () => false,
    setAttribute: () => {},
    getBoundingClientRect: () => ({ width: 150, height: 25 }),
    querySelector: () => null
  };

  const pointerEvent = {
    isTrusted: true,
    button: 1,
    target: {
      closest: (sel) => (sel === 'a[href]' ? mockAnchor : null),
      matches: () => false,
      getBoundingClientRect: () => ({ width: 150, height: 25 })
    }
  };

  const pointerHandler = registeredListeners.get('pointerdown');
  assert.strictEqual(typeof pointerHandler, 'function');
  pointerHandler(pointerEvent);

  const until = shieldGetTrustedClickUntil();
  assert.ok(until > Date.now() + 3000);
  assert.strictEqual(shieldHasTrustedClick('https://github.com/google'), true);
});

console.log('\n[Group 15: Brave-Style Strict Window.open & Pop-up Lock (v3.3.5)]');

runTest('Unsolicited cross-site window.open is blocked and returns dummy window proxy', () => {
  // Clear any leftover intent
  shieldSetTrustedIntent(null);

  assert.strictEqual(shieldIsAllowedDestination('https://netprime-ads.xyz/click'), false);
  assert.strictEqual(shieldIsAllowedDestination('https://monetag-zone-12345.com/afu.php'), false);

  const dummyWin = fullVmContext.window.open('https://netprime-ads.xyz/click', '_blank');
  assert.ok(dummyWin, 'Dummy window object must be returned');
  assert.strictEqual(typeof dummyWin.focus, 'function');
  assert.strictEqual(dummyWin.closed, false);
  dummyWin.close();
  assert.strictEqual(dummyWin.closed, true);
});

runTest('window.open to empty or about:blank is blocked without active link intent', () => {
  shieldSetTrustedIntent(null);
  assert.strictEqual(shieldIsAllowedDestination(''), false);
  assert.strictEqual(shieldIsAllowedDestination('about:blank'), false);
});

runTest('window.open to legitimate auth provider is allowed without prior click', () => {
  assert.strictEqual(shieldIsAllowedDestination('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://appleid.apple.com/auth/authorize'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://login.microsoftonline.com/common/oauth2'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://github.com/login/oauth/authorize'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://discord.com/oauth2/authorize'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://checkout.stripe.com/pay/cs_live'), true);
  assert.strictEqual(shieldIsAllowedDestination('https://www.paypal.com/checkoutnow'), true);
});

runTest('Left-click on newly-added cross-site target="_blank" trap link is intercepted', () => {
  const clickHandler = registeredListeners.get('click');
  assert.strictEqual(typeof clickHandler, 'function');

  let prevented = false;
  let stopped = false;

  const trapAnchor = {
    nodeType: 1,
    tagName: 'A',
    href: 'https://monetag-ad-network.com/banner',
    getAttribute: (attr) => (attr === 'target' ? '_blank' : null),
    setAttribute: () => {},
    removeAttribute: () => {},
    hasAttribute: () => false,
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
    innerText: '',
    querySelector: () => null
  };

  if (typeof fullVmContext.window.__axMarkAnchorNode === 'function') {
    fullVmContext.window.__axMarkAnchorNode(trapAnchor);
  }

  const leftClickEvent = {
    isTrusted: true,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => {
      prevented = true;
    },
    stopImmediatePropagation: () => {
      stopped = true;
    },
    target: {
      closest: (sel) => (sel === 'a[href]' ? trapAnchor : sel.includes('player') ? true : null),
      matches: () => false
    }
  };

  clickHandler(leftClickEvent);
  assert.strictEqual(prevented, true, 'Left-click trap should be prevented');
  assert.strictEqual(stopped, true, 'Left-click trap propagation should be stopped');
});

runTest('Middle-click (button === 1) on cross-site target="_blank" is NOT intercepted as a trap', () => {
  const clickHandler = registeredListeners.get('click');
  assert.strictEqual(typeof clickHandler, 'function');

  let prevented = false;

  const validAnchor = {
    tagName: 'A',
    href: 'https://news.ycombinator.com/item?id=123',
    getAttribute: (attr) => (attr === 'target' ? '_blank' : null),
    setAttribute: () => {},
    removeAttribute: () => {},
    hasAttribute: () => false,
    getBoundingClientRect: () => ({ width: 200, height: 30 }),
    innerText: 'Discussion',
    querySelector: () => null
  };

  const middleClickEvent = {
    isTrusted: true,
    button: 1,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => {
      prevented = true;
    },
    stopImmediatePropagation: () => {},
    target: {
      closest: (sel) => (sel === 'a[href]' ? validAnchor : null),
      matches: () => false
    }
  };

  clickHandler(middleClickEvent);
  assert.strictEqual(prevented, false, 'Middle-click on legitimate link must NOT be prevented');
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===\n`);
if (passedTests === totalTests) {
  console.log('✓ All Anti-Vignette & Pop-under Classifier tests passed successfully!');
} else {
  process.exit(1);
}
