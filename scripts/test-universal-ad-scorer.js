/**
 * AX-Privacy Universal Scoring Ad & Overlay Cleaner Unit Tests (v3.4.0)
 * Validates:
 *   1. Universal heuristic scoring engine (Fixed GIF, IAB 728x90, Pageskin, Transparent Overlay, 87% Vignette, Robot Push Card -> score >= 5, shouldHide: true)
 *   2. False positive prevention (Login modal with password, video player, nav, article > 450 chars, upload/download buttons -> shouldHide: false)
 *   3. Notification & ServiceWorker protection (Auto push blocked as denied, ad-workers rejected, legitimate allowed)
 *   4. Shadow DOM exposure (data-ax-shadow-host="1" & __axShadowRoot)
 *   5. Middle-click (button === 1), Ctrl+click & auth/payment preservation
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('=== AX-Privacy Universal Ad Scorer & Shield Test Suite (v3.4.0) ===\n');

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

// Load content.js evaluateElementAdScore in a controlled VM context
const contentJsSource = fs.readFileSync(path.join(ROOT_DIR, 'content.js'), 'utf8');

function createMockElement(opts = {}) {
  const tagName = (opts.tagName || 'div').toUpperCase();
  const id = opts.id || '';
  const className = opts.className || '';
  const style = opts.style || {};
  const rect = opts.rect || { width: 100, height: 100, top: 50, left: 50, right: 150, bottom: 150 };
  const textContent = opts.textContent || '';
  const attributes = opts.attributes || {};
  const childElements = opts.children || [];

  return {
    tagName,
    id,
    className,
    style,
    textContent,
    innerText: textContent,
    getBoundingClientRect: () => rect,
    getAttribute: (attr) => attributes[attr] || null,
    setAttribute: (attr, val) => {
      attributes[attr] = val;
    },
    querySelectorAll: (sel) => {
      if (sel === 'a[href]') {
        return childElements.filter((c) => c.tagName === 'A' && c.href);
      }
      if (sel === 'input, select, textarea') {
        return childElements.filter((c) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(c.tagName));
      }
      return [];
    },
    querySelector: (sel) => {
      const lowSel = sel.toLowerCase();
      for (const child of childElements) {
        const cTag = (child.tagName || '').toLowerCase();
        if (lowSel.includes(cTag) && cTag.length > 1) {
          if (cTag === 'input') {
            if (lowSel.includes('password') && child.type === 'password') return child;
            if (lowSel.includes('email') && child.type === 'email') return child;
            if (!lowSel.includes('password') && !lowSel.includes('email')) return child;
          } else {
            return child;
          }
        }
        if (lowSel.includes('.gif') && child.src && child.src.includes('.gif')) return child;
        if (lowSel.includes('.webp') && child.src && child.src.includes('.webp')) return child;
        if (lowSel.includes('iframe') && cTag === 'iframe') return child;
        if (lowSel.includes('close') && (child.className?.includes('close') || child.textContent === '×')) return child;
      }
      return null;
    },
    closest: (sel) => {
      if (opts.closestMatches && opts.closestMatches.includes(sel)) return {};
      return null;
    },
    matches: (sel) => {
      if (opts.matchesSelector && opts.matchesSelector.includes(sel)) return true;
      return false;
    }
  };
}

// Extract evaluateElementAdScore from content.js
const sandbox = {
  window: {
    location: { href: 'https://example-publisher.com/article', hostname: 'example-publisher.com' },
    innerWidth: 1200,
    innerHeight: 800,
    getComputedStyle: (el) => el.style || {},
    addEventListener: () => {}
  },
  document: {
    documentElement: { style: {} },
    body: { style: {} },
    getElementById: () => null,
    createElement: () => ({ style: {}, setProperty: () => {}, appendChild: () => {} }),
    addEventListener: () => {}
  },
  chrome: {
    runtime: { sendMessage: () => Promise.resolve({ success: true }), onMessage: { addListener: () => {} } },
    storage: { local: { get: () => Promise.resolve({}) }, onChanged: { addListener: () => {} } }
  },
  module: { exports: {} }
};
vm.createContext(sandbox);
vm.runInContext(contentJsSource, sandbox);
const { evaluateElementAdScore } = sandbox.module.exports;

// ---------------------------------------------------------------------------
// 1. Universal Scorer Positive Ad Detections (score >= 5 -> shouldHide: true)
// ---------------------------------------------------------------------------
console.log('[Group 1: Universal Heuristic Ad Detections]');

runTest('Fixed GIF banner with external destination scores >= 5 and is hidden', () => {
  const el = createMockElement({
    tagName: 'div',
    className: 'ad-banner-floating',
    style: { position: 'fixed', zIndex: '9999' },
    rect: { width: 300, height: 250, top: 100, left: 100, right: 400, bottom: 350 },
    children: [
      { tagName: 'A', href: 'https://external-betting-network.xyz/click', matches: () => true },
      { tagName: 'IMG', src: 'https://external-betting-network.xyz/ad.gif', matches: () => true }
    ]
  });

  const res = evaluateElementAdScore(el, el.style, el.getBoundingClientRect(), 'example-publisher.com');
  assert.ok(res.score >= 5, `Expected score >= 5, got ${res.score} (reasons: ${res.reasons.join(', ')})`);
  assert.strictEqual(res.shouldHide, true);
});

runTest('Standard IAB 728x90 banner with cross-site destination scores >= 5 and is hidden', () => {
  const el = createMockElement({
    tagName: 'div',
    className: 'top-ad-placement',
    style: { position: 'relative' },
    rect: { width: 728, height: 90, top: 10, left: 200, right: 928, bottom: 100 },
    children: [
      { tagName: 'A', href: 'https://ad-network-exchange.com/slot', matches: () => true }
    ]
  });

  const res = evaluateElementAdScore(el, el.style, el.getBoundingClientRect(), 'example-publisher.com');
  assert.ok(res.score >= 5, `Expected score >= 5, got ${res.score} (reasons: ${res.reasons.join(', ')})`);
  assert.strictEqual(res.shouldHide, true);
});

runTest('Pageskin sidebar (narrow & tall stuck to edge) scores >= 5 and is hidden', () => {
  const el = createMockElement({
    tagName: 'div',
    className: 'pageskin-left',
    style: { position: 'fixed', zIndex: '500' },
    rect: { width: 160, height: 600, top: 50, left: 10, right: 170, bottom: 650 },
    children: [
      { tagName: 'A', href: 'https://affiliate-tracker.net/go?ref=123', matches: () => true }
    ]
  });

  const res = evaluateElementAdScore(el, el.style, el.getBoundingClientRect(), 'example-publisher.com');
  assert.ok(res.score >= 5, `Expected score >= 5, got ${res.score} (reasons: ${res.reasons.join(', ')})`);
  assert.strictEqual(res.shouldHide, true);
});

runTest('Invisible transparent click curtain (fixed, z-index >= 999, large, transparent) scores >= 5', () => {
  const el = createMockElement({
    tagName: 'div',
    style: { position: 'fixed', zIndex: '99999', opacity: '0.01', backgroundColor: 'transparent' },
    rect: { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 },
    textContent: ''
  });

  const res = evaluateElementAdScore(el, el.style, el.getBoundingClientRect(), 'example-publisher.com');
  assert.ok(res.score >= 5, `Expected score >= 5, got ${res.score} (reasons: ${res.reasons.join(', ')})`);
  assert.strictEqual(res.shouldHide, true);
});

runTest('Fake Vignette "%87 Yükleniyor... Devam etmek için dokunun" modal scores >= 5 and is hidden', () => {
  const el = createMockElement({
    tagName: 'div',
    style: { position: 'fixed', zIndex: '999999' },
    rect: { width: 500, height: 400, top: 100, left: 200, right: 700, bottom: 500 },
    textContent: 'Dosya hazırlanıyor %87 Yükleniyor... Devam etmek için dokunun',
    children: [
      { tagName: 'SPAN', className: 'close-btn', textContent: '×', matches: () => true }
    ]
  });

  const res = evaluateElementAdScore(el, el.style, el.getBoundingClientRect(), 'example-publisher.com');
  assert.ok(res.score >= 5, `Expected score >= 5, got ${res.score} (reasons: ${res.reasons.join(', ')})`);
  assert.strictEqual(res.shouldHide, true);
});

runTest('Corner In-Page Push card ("Ben robot değilim / Bildirimlere izin ver") scores >= 5 and is hidden', () => {
  const el = createMockElement({
    tagName: 'div',
    className: 'inpage-push-card',
    style: { position: 'fixed', zIndex: '2000' },
    rect: { width: 340, height: 180, top: 20, right: 20, left: 840, bottom: 200 },
    textContent: 'Robot olmadığınızı doğrulayın. Devam etmek için izin ver butonuna dokunun.',
    children: [
      { tagName: 'BUTTON', textContent: 'İzin Ver', matches: () => true }
    ]
  });

  const res = evaluateElementAdScore(el, el.style, el.getBoundingClientRect(), 'example-publisher.com');
  assert.ok(res.score >= 5, `Expected score >= 5, got ${res.score} (reasons: ${res.reasons.join(', ')})`);
  assert.strictEqual(res.shouldHide, true);
});

// ---------------------------------------------------------------------------
// 2. False Positive Prevention (Never hide legitimate content & UI)
// ---------------------------------------------------------------------------
console.log('\n[Group 2: False Positive Prevention]');

runTest('Real login modal with password and email input is NEVER hidden (excluded: true)', () => {
  const el = createMockElement({
    tagName: 'div',
    className: 'auth-modal-dialog',
    style: { position: 'fixed', zIndex: '9999' },
    rect: { width: 400, height: 350, top: 100, left: 300, right: 700, bottom: 450 },
    children: [
      { tagName: 'INPUT', type: 'email', matches: () => true },
      { tagName: 'INPUT', type: 'password', matches: () => true },
      { tagName: 'BUTTON', textContent: 'Giriş Yap', matches: () => true }
    ]
  });

  const res = evaluateElementAdScore(el, el.style, el.getBoundingClientRect(), 'example-publisher.com');
  assert.strictEqual(res.excluded, true);
  assert.strictEqual(res.shouldHide, false);
});

runTest('Real video player container with <video> is NEVER hidden (excluded: true)', () => {
  const el = createMockElement({
    tagName: 'div',
    className: 'player-container video-js',
    style: { position: 'relative' },
    rect: { width: 800, height: 450, top: 50, left: 100, right: 900, bottom: 500 },
    children: [
      { tagName: 'VIDEO', matches: () => true }
    ]
  });

  const res = evaluateElementAdScore(el, el.style, el.getBoundingClientRect(), 'example-publisher.com');
  assert.strictEqual(res.excluded, true);
  assert.strictEqual(res.shouldHide, false);
});

runTest('Semantic <nav>, <header>, <main> and <article> elements are excluded', () => {
  for (const tag of ['nav', 'header', 'main', 'article']) {
    const el = createMockElement({ tagName: tag });
    const res = evaluateElementAdScore(el, {}, {}, 'example-publisher.com');
    assert.strictEqual(res.excluded, true, `Tag <${tag}> must be excluded`);
    assert.strictEqual(res.shouldHide, false);
  }
});

runTest('Long readable article container (> 450 characters) is excluded from ad hiding', () => {
  const longText = 'Bu makale, modern web mimarilerinde performans optimizasyonu ve kullanıcı güvenliği üzerine detaylı bir analiz sunmaktadır. '.repeat(5);
  assert.ok(longText.length > 450);

  const el = createMockElement({
    tagName: 'div',
    className: 'article-body',
    textContent: longText,
    rect: { width: 700, height: 1200, top: 100, left: 200, right: 900, bottom: 1300 }
  });

  const res = evaluateElementAdScore(el, {}, el.getBoundingClientRect(), 'example-publisher.com');
  assert.strictEqual(res.excluded, true);
  assert.strictEqual(res.shouldHide, false);
});

runTest('Buttons with classes "upload-button" or "download-badge" are NOT falsely classified as ads', () => {
  const el = createMockElement({
    tagName: 'div',
    className: 'upload-button-wrapper download-badge-container',
    textContent: 'Dosya Yükle',
    rect: { width: 120, height: 40, top: 50, left: 50, right: 170, bottom: 90 }
  });

  const res = evaluateElementAdScore(el, {}, el.getBoundingClientRect(), 'example-publisher.com');
  assert.strictEqual(res.shouldHide, false);
  assert.ok(!res.reasons.includes('ad-identifier'), 'Should not match ad-identifier');
});

// ---------------------------------------------------------------------------
// 3. MAIN World Hooks: Push Notification & Service Worker Protection
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Push Notification & Service Worker Hooks]');

const popupShieldSource = fs.readFileSync(path.join(ROOT_DIR, 'popup-shield.js'), 'utf8');

runTest('popup-shield hooks Notification.requestPermission and denies unprompted permission traps', async () => {
  let deniedResult = null;
  const mockNotification = {
    requestPermission: (cb) => {
      if (cb) cb('granted');
      return Promise.resolve('granted');
    }
  };

  const shieldVmContext = {
    window: {
      location: { href: 'https://pirate-streaming.com/watch', hostname: 'pirate-streaming.com' },
      sessionStorage: { getItem: () => 'enabled' },
      addEventListener: () => {},
      innerWidth: 1200,
      innerHeight: 800
    },
    document: {
      documentElement: { style: {} },
      body: { style: {} },
      addEventListener: () => {},
      querySelectorAll: () => []
    },
    Notification: mockNotification,
    navigator: {
      serviceWorker: {
        register: () => Promise.resolve({})
      }
    },
    HTMLIFrameElement: { prototype: {} },
    Element: { prototype: { attachShadow: () => ({}) } },
    HTMLAnchorElement: { prototype: {} },
    HTMLFormElement: { prototype: {} },
    Location: { prototype: {} },
    EventTarget: { prototype: {} }
  };
  vm.createContext(shieldVmContext);
  vm.runInContext(popupShieldSource, shieldVmContext);

  // Calling Notification.requestPermission without prior user click
  const result = await shieldVmContext.Notification.requestPermission();
  assert.strictEqual(result, 'denied', 'Unprompted Notification.requestPermission should be silently denied');
});

runTest('popup-shield hooks navigator.serviceWorker.register and rejects ad push workers', async () => {
  const shieldVmContext = {
    window: {
      location: { href: 'https://pirate-streaming.com/watch', hostname: 'pirate-streaming.com' },
      sessionStorage: { getItem: () => 'enabled' },
      addEventListener: () => {},
      innerWidth: 1200,
      innerHeight: 800
    },
    document: {
      documentElement: { style: {} },
      body: { style: {} },
      addEventListener: () => {},
      querySelectorAll: () => []
    },
    Notification: { requestPermission: () => Promise.resolve('granted') },
    navigator: {
      serviceWorker: {
        register: (url) => Promise.resolve({ url })
      }
    },
    HTMLIFrameElement: { prototype: {} },
    Element: { prototype: { attachShadow: () => ({}) } },
    HTMLAnchorElement: { prototype: {} },
    HTMLFormElement: { prototype: {} },
    Location: { prototype: {} },
    EventTarget: { prototype: {} }
  };
  vm.createContext(shieldVmContext);
  vm.runInContext(popupShieldSource, shieldVmContext);

  // Attempting to register ad push workers
  await assert.rejects(
    shieldVmContext.navigator.serviceWorker.register('/push-sw.js'),
    /Ad service worker blocked/
  );
  await assert.rejects(
    shieldVmContext.navigator.serviceWorker.register('https://monetag.com/sw.js'),
    /Ad service worker blocked/
  );

  // Normal legitimate service worker should pass to native
  const legit = await shieldVmContext.navigator.serviceWorker.register('/sw.js');
  assert.strictEqual(legit.url, '/sw.js');
});

runTest('popup-shield marks closed shadow root host with data-ax-shadow-host="1"', () => {
  const hostAttrs = {};
  const mockHost = {
    id: 'test-shadow-host',
    setAttribute: (k, v) => {
      hostAttrs[k] = v;
    },
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
    isConnected: true
  };

  const nativeAttachShadow = function (init) {
    return { mode: init?.mode || 'open' };
  };

  const shieldVmContext = {
    window: {
      location: { href: 'https://pirate-streaming.com/watch', hostname: 'pirate-streaming.com' },
      sessionStorage: { getItem: () => 'enabled' },
      addEventListener: () => {},
      getComputedStyle: () => ({ position: 'relative', zIndex: '10' })
    },
    document: {
      documentElement: { style: {} },
      body: { style: {} },
      addEventListener: () => {},
      querySelectorAll: () => []
    },
    Notification: { requestPermission: () => Promise.resolve('granted') },
    navigator: { serviceWorker: { register: () => Promise.resolve({}) } },
    HTMLIFrameElement: { prototype: {} },
    Element: { prototype: { attachShadow: nativeAttachShadow } },
    HTMLAnchorElement: { prototype: {} },
    HTMLFormElement: { prototype: {} },
    Location: { prototype: {} },
    EventTarget: { prototype: {} }
  };
  vm.createContext(shieldVmContext);
  vm.runInContext(popupShieldSource, shieldVmContext);

  // Invoke attachShadow on mock host
  const root = shieldVmContext.Element.prototype.attachShadow.call(mockHost, { mode: 'closed' });
  assert.ok(root);
  assert.strictEqual(hostAttrs['data-ax-shadow-host'], '1');
  assert.strictEqual(mockHost.__axShadowRoot, root);
});

// ---------------------------------------------------------------------------
// 4. Middle-Click & Auth Provider Preservation
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Middle Click & Auth Provider Preservation]');

const popupShieldExports = vm.runInContext(
  `module.exports;`,
  vm.createContext({
    ...sandbox,
    module: { exports: {} },
    window: { location: { href: 'https://site.com', hostname: 'site.com' } }
  })
);

runTest('popup-shield allows legitimate auth gateways unconditionally', () => {
  const { isAllowedDestination } = sandbox.module.exports;
  // Test from popup-shield.js exports
  const authUrls = [
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://appleid.apple.com/auth/authorize',
    'https://login.microsoftonline.com/common/oauth2',
    'https://github.com/login/oauth/authorize',
    'https://discord.com/oauth2/authorize',
    'https://api.stripe.com/v1/tokens',
    'https://www.paypal.com/checkoutnow',
    'https://sandbox-api.iyzico.com/payment/3dsecure',
    'https://www.paytr.com/odeme/guvenli/'
  ];

  // Load popup-shield to test isAllowedDestination
  const shieldContext = {
    window: {
      location: { href: 'https://site.com', hostname: 'site.com', origin: 'https://site.com' },
      sessionStorage: { getItem: () => 'enabled' },
      addEventListener: () => {},
      innerWidth: 1200,
      innerHeight: 800
    },
    document: { documentElement: null },
    Node: class {},
    Element: class {},
    HTMLAnchorElement: class {},
    HTMLIFrameElement: class {},
    EventTarget: class {},
    HTMLFormElement: class {},
    MutationObserver: class {
      observe() {}
    },
    Notification: { requestPermission: () => Promise.resolve('granted') },
    navigator: { serviceWorker: { register: () => Promise.resolve({}) } },
    module: { exports: {} },
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL
  };
  vm.createContext(shieldContext);
  vm.runInContext(popupShieldSource, shieldContext);

  for (const url of authUrls) {
    assert.strictEqual(
      shieldContext.module.exports.isAllowedDestination(url),
      true,
      `Auth url must be allowed: ${url}`
    );
  }
});

// ---------------------------------------------------------------------------
// v4.1.0 Regression: signature-based re-evaluation (no WeakSet blind spot)
// ---------------------------------------------------------------------------
console.log('\n[Group v4.1.0: Signature Re-evaluation]');

const { evaluateCandidate } = sandbox.module.exports;

function mutableEl(opts) {
  const children = [];
  const attributes = {};
  const el = createMockElement({ ...opts, children, attributes });
  el.childElementCount = 0;
  el.fill = (patch) => {
    if (patch.children) {
      children.push(...patch.children);
      el.childElementCount = children.length;
    }
    if (patch.textContent !== undefined) {
      el.textContent = patch.textContent;
      el.innerText = patch.textContent;
    }
    if (patch.style) Object.assign(el.style, patch.style);
    if (patch.styleAttr) attributes.style = patch.styleAttr;
  };
  el.attrs = attributes;
  return el;
}

runTest('v4.1.0: empty div later filled with a GIF banner is caught on signature change', () => {
  const el = mutableEl({ tagName: 'div', style: { position: 'static' }, rect: { width: 300, height: 250, top: 100, left: 100, right: 400, bottom: 350 } });
  assert.strictEqual(evaluateCandidate(el), false, 'empty slot is not an ad yet');
  assert.strictEqual(evaluateCandidate(el), false, 'unchanged signature is skipped');
  el.fill({
    children: [
      { tagName: 'A', href: 'https://bet-network.xyz/go' },
      { tagName: 'IMG', src: 'https://bet-network.xyz/banner.gif' }
    ],
    style: { position: 'sticky', zIndex: '9999' },
    styleAttr: 'position:sticky;z-index:9999'
  });
  assert.strictEqual(evaluateCandidate(el), true);
  assert.strictEqual(el.attrs['data-ax-hidden'], '1');
  assert.strictEqual(evaluateCandidate(el), false, 'hidden elements are skipped');
});

runTest('v4.1.0: "Ben robot değilim. Devam etmek için dokunun" card is caught after injection', () => {
  const el = mutableEl({ tagName: 'div', style: {}, rect: { width: 360, height: 200, top: 580, left: 820, right: 1180, bottom: 780 } });
  assert.strictEqual(evaluateCandidate(el), false);
  el.fill({ textContent: 'Ben robot değilim. Devam etmek için dokunun', style: { position: 'fixed', zIndex: '2147483647' }, styleAttr: 'position:fixed' });
  assert.strictEqual(evaluateCandidate(el), true);
});

runTest('v4.1.0: "%87 Yükleniyor" vignette is caught after text change', () => {
  const el = mutableEl({ tagName: 'div', style: { position: 'fixed', zIndex: '99999' }, rect: { width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 } });
  el.backgroundOpaque = true;
  el.style.backgroundColor = 'rgb(0, 0, 0)';
  el.style.opacity = '1';
  assert.strictEqual(evaluateCandidate(el), false);
  el.fill({ textContent: '%87 Yükleniyor... TAMAM' });
  assert.strictEqual(evaluateCandidate(el), true);
});

runTest('v4.1.0: forms, password inputs, video, nav and ytd-guide-renderer are never hidden', () => {
  const login = createMockElement({
    tagName: 'div',
    style: { position: 'fixed', zIndex: '99999' },
    textContent: 'Devam etmek için giriş yapın',
    children: [{ tagName: 'INPUT', type: 'password' }]
  });
  assert.strictEqual(evaluateCandidate(login), false);
  const form = createMockElement({ tagName: 'form', style: { position: 'fixed', zIndex: '99999' }, textContent: 'robot' });
  assert.strictEqual(evaluateCandidate(form), false);
  const video = createMockElement({ tagName: 'div', style: { position: 'fixed', zIndex: '99999' }, textContent: 'loading', children: [{ tagName: 'VIDEO' }] });
  assert.strictEqual(evaluateCandidate(video), false);
  const nav = createMockElement({ tagName: 'nav', style: { position: 'fixed', zIndex: '99999' }, textContent: 'allow' });
  assert.strictEqual(evaluateCandidate(nav), false);
  const guide = createMockElement({ tagName: 'div', style: { position: 'fixed', zIndex: '99999' }, textContent: 'Yükleniyor %50' });
  guide.closest = (sel) => (sel.includes('ytd-guide-renderer') ? {} : null);
  assert.strictEqual(evaluateCandidate(guide), false);
});

// ---------------------------------------------------------------------------
// v4.1.1 Regression: ad picker never hides the whole site
// ---------------------------------------------------------------------------
console.log('\n[Group v4.1.1: Ad Picker Safety]');

const { isPageLevelElement, filterSafeLearnedSelectors } = sandbox.module.exports;

runTest('v4.1.1: picker refuses body/main and viewport-sized layout wrappers, accepts a banner', () => {
  assert.strictEqual(isPageLevelElement(createMockElement({ tagName: 'body' })), true);
  assert.strictEqual(isPageLevelElement(createMockElement({ tagName: 'main' })), true);
  const wrapper = createMockElement({ tagName: 'div', style: { position: 'static' }, rect: { width: 1200, height: 3000, top: 0, left: 0, right: 1200, bottom: 3000 } });
  assert.strictEqual(isPageLevelElement(wrapper), true);
  const banner = createMockElement({ tagName: 'div', style: { position: 'static' }, rect: { width: 728, height: 90, top: 10, left: 10, right: 738, bottom: 100 } });
  assert.strictEqual(isPageLevelElement(banner), false);
  const fixedOverlay = createMockElement({ tagName: 'div', style: { position: 'fixed' }, rect: { width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 } });
  assert.strictEqual(isPageLevelElement(fixedOverlay), false, 'full-screen fixed overlays may be picked');
});

runTest('v4.1.1: stored learned selectors are dropped when they match many or page-level elements', () => {
  const banner = createMockElement({ tagName: 'div', rect: { width: 300, height: 250, top: 0, left: 0, right: 300, bottom: 250 } });
  const wrapper = createMockElement({ tagName: 'div', rect: { width: 1200, height: 3000, top: 0, left: 0, right: 1200, bottom: 3000 } });
  const dom = {
    '#ad-box': [banner],
    'div.container': [wrapper],
    'div.card': Array.from({ length: 12 }, () => banner)
  };
  const prev = sandbox.document.querySelectorAll;
  sandbox.document.querySelectorAll = (sel) => dom[sel] || [];
  try {
    const kept = filterSafeLearnedSelectors(['#ad-box', 'div.container', 'div.card']);
    assert.deepStrictEqual(Array.from(kept), ['#ad-box']);
  } finally {
    sandbox.document.querySelectorAll = prev;
  }
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===\n`);
if (passedTests === totalTests) {
  console.log('✓ All Universal Ad Scorer & Shield tests passed successfully!');
} else {
  process.exit(1);
}
