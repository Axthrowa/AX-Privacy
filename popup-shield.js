/**
 * AX-Privacy Pop-up, Anti-Vignette & Click-Hijack Shield (Manifest V3 - MAIN World - v2.7.0)
 * Features:
 *   1. Captures trusted user clicks to allow legitimate navigations
 *   2. Resets trusted click state on video, player controls, buttons, or blank space clicks
 *   3. Clean iframe contentWindow & contentDocument hooks to stop iframe bypasses
 *   4. Intercepts synthetic dispatchEvent(new MouseEvent('click')) on external links
 *   5. Intercepts instantaneous transparent <a> traps injected on mousedown/pointerdown
 *   6. Tracks and neutralizes closed Shadow DOM vignette overlays (Element.prototype.attachShadow)
 *   7. Intercepts programmatic location.assign & location.replace click-hijack redirects
 *   8. Universal Vignette / Fake loading overlay cleaner with body/html overflow restoration
 *   9. Zero external dependencies, pure JS wrapped in robust try/catch blocks
 */

function getRootDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return '';
  const clean = hostname.trim().toLowerCase();
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  const secondToLast = parts[parts.length - 2];
  if (['com', 'co', 'gov', 'org', 'edu', 'net'].includes(secondToLast) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function isCrossSite(urlStr) {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const u = new URL(urlStr, window.location.href);
    const root1 = getRootDomain(window.location.hostname);
    const root2 = getRootDomain(u.hostname);
    return root1 !== root2;
  } catch {
    return false;
  }
}

function isVignetteCandidate(el) {
  if (!el) return false;
  if (el.hasPasswordInput || el.hasVideo || el.hasAuthKeywords) return false;

  // Pattern 1: Max-Z-Index Fullscreen Ad Iframe
  if (el.tagName === 'IFRAME') {
    const z = parseInt(el.style?.zIndex || '0', 10);
    if (z >= 9999999 || z >= 2147483000) {
      const w = el.rect?.width || 0;
      const h = el.rect?.height || 0;
      if (w >= 300 && h >= 300) {
        return true;
      }
    }
  }

  const z = parseInt(el.style?.zIndex || '0', 10);
  const text = (el.text || '').toLowerCase();
  const isFixed = el.style?.position === 'fixed';

  // Pattern 2: Fake Loading / Tap-To-Continue Bait text
  if (isFixed && z >= 99999) {
    const baitPhrases = [
      'devam etmek için dokunun',
      'devam etmek için tıklayın',
      'tap to continue',
      'click to continue',
      'press allow',
      'bildirimlere izin ver'
    ];
    const hasBaitPhrase = baitPhrases.some((b) => text.includes(b));
    const hasProgress =
      /\d{1,3}\s*%/i.test(text) &&
      (text.includes('yükleniyor') || text.includes('loading') || text.includes('dokunun') || text.includes('continue'));
    if (hasBaitPhrase || hasProgress) {
      return true;
    }

    // Pattern 3: Giant Empty / Transparent Click Curtain
    const w = el.rect?.width || 0;
    const h = el.rect?.height || 0;
    if (w >= 600 && h >= 400 && text.trim().length === 0 && !el.hasRealInputs) {
      return true;
    }
  }

  return false;
}

// Track synchronous trusted user intents
let lastTrustedIntent = null; // { host: string, root: string, href: string, exp: number }
let lastTrustedLink = null; // { time: number, origin: string, root: string, href: string }
let trustedClickUntil = 0;

function hasTrustedClick(targetUrl = '') {
  const now = Date.now();
  if (now > trustedClickUntil) return false;

  // If no targetUrl or about:blank, verify we have a valid trusted link or intent
  if (!targetUrl || targetUrl === 'about:blank' || targetUrl.trim() === '') {
    return Boolean(
      (lastTrustedIntent && lastTrustedIntent.exp > now) ||
      (lastTrustedLink && now - lastTrustedLink.time <= 2500)
    );
  }

  try {
    const resolved = new URL(
      targetUrl,
      typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost'
    );
    const targetHost = resolved.hostname.toLowerCase();
    const targetRoot = getRootDomain(targetHost);

    // If target has the same root domain as the current page, it's allowed
    if (typeof window !== 'undefined' && window.location) {
      const curRoot = getRootDomain(window.location.hostname);
      if (curRoot && targetRoot && curRoot === targetRoot) {
        return true;
      }
    }

    // Check if target matches lastTrustedLink
    if (lastTrustedLink && now - lastTrustedLink.time <= 2500) {
      const linkRoot =
        lastTrustedLink.root ||
        getRootDomain(
          new URL(
            lastTrustedLink.href,
            typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost'
          ).hostname
        );
      if (linkRoot && targetRoot && linkRoot === targetRoot) {
        return true;
      }
      if (
        lastTrustedLink.href === targetUrl ||
        (lastTrustedLink.origin && lastTrustedLink.origin === resolved.origin.toLowerCase())
      ) {
        return true;
      }
    }

    // Check if target matches lastTrustedIntent
    if (lastTrustedIntent && lastTrustedIntent.exp > now) {
      const intentRoot = lastTrustedIntent.root || getRootDomain(lastTrustedIntent.host || '');
      if (intentRoot && targetRoot && intentRoot === targetRoot) {
        return true;
      }
    }
  } catch {}

  return false;
}

function setTrustedIntent(targetUrl) {
  try {
    if (!targetUrl || typeof targetUrl !== 'string') {
      lastTrustedIntent = null;
      lastTrustedLink = null;
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem('__ax_trusted_intent');
        }
        if (typeof window !== 'undefined' && window.name) {
          const rawName = window.name;
          if (rawName.startsWith('{') && rawName.includes('__axIntent')) {
            const envelope = JSON.parse(rawName);
            delete envelope.__axIntent;
            window.name = JSON.stringify(envelope);
          }
        }
      } catch {}
      return;
    }
    const href = targetUrl.trim();
    let host = '';
    try {
      const u = new URL(href, typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost');
      host = u.hostname.toLowerCase();
    } catch {
      return;
    }
    const now = Date.now();
    const exp = now + 3500;
    const intentData = { host, root: getRootDomain(host), href, exp };

    // 1. In-memory fast cache
    lastTrustedIntent = intentData;

    // 2. sessionStorage
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('__ax_trusted_intent', JSON.stringify(intentData));
      }
    } catch {}

    // 3. window.name JSON envelope without destroying original name
    try {
      if (typeof window !== 'undefined') {
        const rawName = window.name || '';
        let envelope = {};
        if (rawName.startsWith('{') && rawName.endsWith('}')) {
          try {
            envelope = JSON.parse(rawName);
          } catch {
            envelope = { __origName: rawName };
          }
        } else if (rawName) {
          envelope = { __origName: rawName };
        }
        envelope.__axIntent = { host, exp };
        window.name = JSON.stringify(envelope);
      }
    } catch {}
  } catch {}
}

function matchesIntent(intent, targetUrl) {
  if (!intent) return false;
  if (!targetUrl || targetUrl === 'about:blank' || targetUrl.trim() === '') {
    return true;
  }
  try {
    const u = new URL(targetUrl, typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost');
    const targetHost = u.hostname.toLowerCase();
    const targetRoot = getRootDomain(targetHost);
    if (intent.host && (targetHost === intent.host || targetHost.endsWith('.' + intent.host))) {
      return true;
    }
    const intentRoot = intent.root || getRootDomain(intent.host || '');
    if (intentRoot && targetRoot && intentRoot === targetRoot) {
      return true;
    }
    if (intent.href && (targetUrl === intent.href || targetUrl.startsWith(intent.href))) {
      return true;
    }
  } catch {}
  return false;
}

function hasTrustedIntent(targetUrl) {
  try {
    const now = Date.now();

    // 1. Check in-memory first
    if (lastTrustedIntent && lastTrustedIntent.exp > now) {
      if (matchesIntent(lastTrustedIntent, targetUrl)) {
        return true;
      }
    }

    // 2. Check sessionStorage
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const raw = window.sessionStorage.getItem('__ax_trusted_intent');
        if (raw) {
          const stored = JSON.parse(raw);
          if (stored && stored.exp > now) {
            if (matchesIntent(stored, targetUrl)) {
              return true;
            }
          } else {
            window.sessionStorage.removeItem('__ax_trusted_intent');
          }
        }
      }
    } catch {}

    // 3. Check window.name envelope
    try {
      if (typeof window !== 'undefined' && window.name) {
        const rawName = window.name;
        if (rawName.startsWith('{') && rawName.includes('__axIntent')) {
          const envelope = JSON.parse(rawName);
          if (envelope && envelope.__axIntent && envelope.__axIntent.exp > now) {
            if (matchesIntent(envelope.__axIntent, targetUrl)) {
              return true;
            }
          }
        }
      }
    } catch {}
  } catch {}
  return false;
}

const TRUSTED_FEED_OPENERS = new Set([
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'yandex.com',
  'yandex.com.tr',
  'yahoo.com',
  'search.yahoo.com',
  'reddit.com',
  'x.com',
  'twitter.com',
  'instagram.com',
  'facebook.com',
  'threads.net',
  'tiktok.com',
  'pinterest.com',
  'youtube.com',
  'github.com',
  'linkedin.com',
  'wikipedia.org',
  'discord.com',
  'spotify.com',
  'twitch.tv',
  'whatsapp.com',
  'telegram.org',
  'akakce.com',
  'cimri.com'
]);

function isTrustedFeedOpener(host) {
  if (!host) return false;
  const clean = host.toLowerCase();
  const root = getRootDomain(clean);
  return TRUSTED_FEED_OPENERS.has(root) || TRUSTED_FEED_OPENERS.has(clean);
}

const MAJOR_SAFE_PLATFORMS = [
  'x.com',
  'twitter.com',
  'instagram.com',
  'facebook.com',
  'youtube.com',
  'twitch.tv',
  'reddit.com',
  'github.com',
  'linkedin.com',
  'google.com',
  'netflix.com',
  'amazon.com',
  'amazon.com.tr',
  'discord.com',
  'spotify.com',
  'whatsapp.com',
  'telegram.org',
  'threads.net',
  'tiktok.com',
  'pinterest.com',
  'akakce.com',
  'cimri.com',
  'hepsiburada.com',
  'trendyol.com',
  'n11.com',
  'sahibinden.com'
];

const TRUSTED_AUTH_HOSTS = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'github.com',
  'gitlab.com',
  'discord.com',
  'twitch.tv',
  'id.twitch.tv',
  'stripe.com',
  'checkout.stripe.com',
  'paypal.com',
  'www.paypal.com',
  'iyzico.com',
  'sandbox-api.iyzico.com',
  'paytr.com',
  'bkmexpress.com.tr'
];

function isAllowedDestination(targetUrl) {
  if (typeof window !== 'undefined') {
    try {
      if (window.sessionStorage?.getItem('ax_privacy_popup_shield') === 'disabled') {
        return true;
      }
    } catch {}
  }

  const now = Date.now();

  // 1. Empty or about:blank destinations: strictly require active new tab intent from recent link click
  if (!targetUrl || targetUrl === 'about:blank' || targetUrl.trim() === '') {
    return Boolean(
      (lastTrustedIntent && lastTrustedIntent.exp > now) ||
      (lastTrustedLink && now - lastTrustedLink.time <= 2500)
    );
  }

  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const currentOrigin = (window.location.origin || (window.location.href ? new URL(window.location.href).origin : '')).toLowerCase();
    const resolved = new URL(targetUrl, window.location.href);
    const targetOrigin = resolved.origin.toLowerCase();
    const targetHost = resolved.hostname.toLowerCase();

    // 2. Same-origin navigation or relative paths are always allowed
    if (targetOrigin === currentOrigin) {
      return true;
    }

    // 3. Same root domain navigation is allowed (e.g. netprime.me opening netprime.me/watch)
    const currentRoot = getRootDomain(window.location.hostname);
    const targetRoot = getRootDomain(targetHost);
    if (currentRoot && targetRoot && currentRoot === targetRoot) {
      return true;
    }

    // 4. Feeds and search engines legitimately open user-clicked links
    if (isTrustedFeedOpener(window.location.hostname)) {
      return true;
    }

    // 5. Legitimate authentication, payment gateways, and banking portals
    const isAuthHost = TRUSTED_AUTH_HOSTS.some(
      (h) => targetHost === h || targetHost.endsWith('.' + h) || targetRoot === h
    );
    if (
      isAuthHost ||
      targetHost.includes('oauth') ||
      targetHost.includes('3dsecure') ||
      targetHost.includes('3d-secure') ||
      targetHost.includes('banka') ||
      targetHost.includes('odeme')
    ) {
      return true;
    }

    // 6. Cross-site window.open: ONLY allowed if user clicked a link matching target root domain within 2500ms
    if (lastTrustedIntent && lastTrustedIntent.exp > now) {
      const intentRoot = lastTrustedIntent.root || getRootDomain(lastTrustedIntent.host || '');
      if (intentRoot && targetRoot && intentRoot === targetRoot) {
        return true;
      }
    }

    if (lastTrustedLink && now - lastTrustedLink.time <= 2500) {
      const linkRoot =
        lastTrustedLink.root ||
        getRootDomain(
          new URL(
            lastTrustedLink.href,
            typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost'
          ).hostname
        );
      if (linkRoot && targetRoot && linkRoot === targetRoot) {
        return true;
      }
      if (lastTrustedLink.origin === targetOrigin || lastTrustedLink.href === targetUrl) {
        return true;
      }
    }

    // All other unsolicited cross-site window.open calls are strictly blocked!
    return false;
  } catch {
    return false;
  }
}

/**
 * Validates in-page navigations (Location.prototype.assign, replace, href setter, window.open self).
 * Strictly prevents Anti-DevTools scripts from hijacking or redirecting the current page to
 * external domains (e.g. google.com, bing.com, about:blank) when DevTools is opened.
 */
function isAllowedNavigation(targetUrl) {
  if (typeof window !== 'undefined') {
    try {
      if (window.sessionStorage?.getItem('ax_privacy_popup_shield') === 'disabled') {
        return true;
      }
    } catch {}
  }

  if (!targetUrl || targetUrl === 'about:blank' || targetUrl.trim() === '') {
    return hasTrustedIntent(targetUrl) || hasTrustedClick(targetUrl);
  }

  try {
    if (typeof window === 'undefined' || !window.location) return true;
    const currentOrigin = (window.location.origin || (window.location.href ? new URL(window.location.href).origin : '')).toLowerCase();
    const resolved = new URL(targetUrl, window.location.href);
    const targetOrigin = resolved.origin.toLowerCase();
    const targetHost = resolved.hostname.toLowerCase();

    // 1. Same-origin navigation or relative paths are always allowed
    if (targetOrigin === currentOrigin) {
      return true;
    }

    // 2. Same root domain navigation is allowed (e.g. sub.mysite.com -> mysite.com)
    const currentRoot = getRootDomain(window.location.hostname);
    const targetRoot = getRootDomain(targetHost);
    if (currentRoot && targetRoot && currentRoot === targetRoot) {
      return true;
    }

    // Feeds, search engines and social platforms legitimately navigate to outbound links
    if (isTrustedFeedOpener(window.location.hostname)) {
      return true;
    }

    // 3. Legitimate auth/payment callbacks
    const isAuthHost = TRUSTED_AUTH_HOSTS.some(
      (h) => targetHost === h || targetHost.endsWith('.' + h) || targetRoot === h
    );
    if (
      isAuthHost ||
      targetHost.includes('oauth') ||
      targetHost.includes('3dsecure') ||
      targetHost.includes('3d-secure') ||
      targetHost.includes('banka') ||
      targetHost.includes('odeme')
    ) {
      return true;
    }

    const fullPath = (resolved.pathname + resolved.search).toLowerCase();
    if (
      fullPath.includes('/oauth') ||
      fullPath.includes('/3dsecure') ||
      fullPath.includes('/3d-secure') ||
      fullPath.includes('response_type=code')
    ) {
      return true;
    }

    // 4. User genuinely clicked a link with navigation/new-tab intent matching this destination
    if (hasTrustedIntent(targetUrl) || hasTrustedClick(targetUrl)) {
      return true;
    }

    if (lastTrustedLink && Date.now() - lastTrustedLink.time <= 2500) {
      if (
        lastTrustedLink.origin === targetOrigin ||
        lastTrustedLink.href === targetUrl ||
        getRootDomain(new URL(lastTrustedLink.href, window.location.href).hostname) === targetRoot
      ) {
        return true;
      }
    }

    // Otherwise, unsolicited external redirect (e.g. anti-devtools jumping to google.com/bing.com) is blocked!
    return false;
  } catch {
    return false;
  }
}

function isDevToolsKey(e) {
  if (!e) return false;
  const key = (e.key || '').toLowerCase();
  const code = e.keyCode || e.which || 0;
  const ctrlOrMeta = Boolean(e.ctrlKey || e.metaKey);
  const shift = Boolean(e.shiftKey);

  // F12
  if (key === 'f12' || code === 123) return true;

  // Ctrl+Shift+I (73), Ctrl+Shift+J (74)
  if (ctrlOrMeta && shift && (key === 'i' || key === 'j' || code === 73 || code === 74)) {
    return true;
  }

  // Ctrl+U (85) - View Page Source
  if (ctrlOrMeta && !shift && (key === 'u' || code === 85)) {
    return true;
  }

  return false;
}

(function initPopupShield() {
  'use strict';

  if (typeof window === 'undefined') return;

  // Prevent multiple injections in the same window/frame
  if (window.__AX_POPUP_SHIELD_INSTALLED__) return;

  try {
    const shieldStatus = window.sessionStorage.getItem('ax_privacy_popup_shield');
    if (shieldStatus === 'disabled') {
      return;
    }
  } catch {
    // If sessionStorage is restricted, proceed with protection
  }

  window.__AX_POPUP_SHIELD_INSTALLED__ = true;

  // Zero-overhead early return for trusted major platforms (YouTube, Twitch, Netflix, X, etc.)
  const curHost =
    typeof window !== 'undefined' && window.location
      ? (window.location.hostname || '').toLowerCase()
      : '';
  if (curHost && MAJOR_SAFE_PLATFORMS.some((p) => curHost === p || curHost.endsWith('.' + p))) {
    return;
  }

  // Defeat anti-adblock detection and provide standard noop surrogates for web analytics/ads
  try {
    // 1. Google Tag Manager / Analytics Surrogates
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
      window.gtag = function () {
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          window.dataLayer.push(arguments);
        }
      };
    }
    if (!window.ga) {
      window.ga = function () {};
      window.ga.create = function () {
        return { get() {}, set() {}, send() {} };
      };
      window.ga.getByName = function () {
        return null;
      };
      window.ga.getAll = function () {
        return [];
      };
      window.ga.remove = function () {};
    }
    if (!window._gaq) {
      window._gaq = { push: function () {} };
    }

    // 2. Facebook Pixel Surrogate
    if (!window.fbq) {
      window.fbq = function () {};
      window.fbq.push = function () {};
      window.fbq.loaded = true;
      window.fbq.version = '2.0';
      window.fbq.queue = [];
    }

    // 3. Google AdSense / DFP Surrogates
    if (!window.adsbygoogle) {
      window.adsbygoogle = [];
    }
    window.adsbygoogle.loaded = true;
    window.adsbygoogle.push = function (obj) {
      if (obj && typeof obj === 'object') {
        try {
          obj.loaded = true;
        } catch {}
      }
      return 0;
    };
    window.google_ad_client = 'ca-pub-0000000000000000';
    window.google_ad_status = 1;

    // 4. Taboola / Outbrain / Criteo Surrogates
    window._taboola = window._taboola || [];
    window.OBR = window.OBR || { extern: { researchWidget() {} } };
    window.Criteo = window.Criteo || { events: [] };

    // 5. Anti-Adblock Canary Globals
    window.canRunAds = true;
    window.isAdBlockActive = false;
    window.adblock = false;
    window.adblocker = false;
    window.hasAdBlocker = false;
    window.adBlockDetected = false;
    window._adblock = false;

    // 6. FuckAdBlock & BlockAdBlock Full Stubs
    function createAdBlockStub() {
      const stub = {
        on: function (detected, fn) {
          if (!detected && typeof fn === 'function') {
            try {
              setTimeout(fn, 1);
            } catch {}
          }
          return stub;
        },
        onDetected: function () {
          return stub;
        },
        onNotDetected: function (fn) {
          if (typeof fn === 'function') {
            try {
              setTimeout(fn, 1);
            } catch {}
          }
          return stub;
        },
        check: function () {
          return true;
        },
        clearEvent: function () {},
        setOption: function () {
          return stub;
        },
        init: function () {
          return stub;
        }
      };
      return stub;
    }
    window.fuckAdBlock = createAdBlockStub();
    window.blockAdBlock = createAdBlockStub();
    window.FuckAdBlock = function () {
      return createAdBlockStub();
    };
    window.BlockAdBlock = function () {
      return createAdBlockStub();
    };
    window.snackBar = window.snackBar || { show() {} };

    // 7. Bait Element Height/Width Defuser (Hooks offsetHeight & clientHeight on bait elements)
    const BAIT_CLASSES =
      /^(adsbox|pub_300x250|pub_300x250m|pub_728x90|text-ad|textAd|text_ad|text_ads|text-ads|text-ad-links|ad-banner|adsbygoogle|banner_ad|ad-unit)$/i;
    const proto = typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : null;
    if (proto) {
      const origOffsetH = Object.getOwnPropertyDescriptor(proto, 'offsetHeight')?.get;
      const origClientH = Object.getOwnPropertyDescriptor(proto, 'clientHeight')?.get;
      if (origOffsetH) {
        Object.defineProperty(proto, 'offsetHeight', {
          get() {
            const h = origOffsetH.call(this);
            if (h === 0 && this.className && typeof this.className === 'string' && BAIT_CLASSES.test(this.className)) {
              return 250;
            }
            return h;
          },
          configurable: true
        });
      }
      if (origClientH) {
        Object.defineProperty(proto, 'clientHeight', {
          get() {
            const h = origClientH.call(this);
            if (h === 0 && this.className && typeof this.className === 'string' && BAIT_CLASSES.test(this.className)) {
              return 250;
            }
            return h;
          },
          configurable: true
        });
      }
    }
  } catch (err) {
    console.warn('[AX-Privacy] Surrogates initialization warning:', err);
  }

  // Track newly added cross-site <a> tags injected on mousedown/pointerdown
  const recentLinks = new WeakMap(); // HTMLAnchorElement -> timestamp

  // Prevent multiple hooking of the same window
  const protectedWindows = new WeakSet();

  function reportBlocked(url, context) {
    const cleanUrl = url || 'about:blank';
    console.info(`[AX-Popup] İzinsiz reklam penceresi engellendi (${context}):`, cleanUrl);
    try {
      window.postMessage(
        {
          type: 'AX_POPUP_BLOCKED',
          targetUrl: cleanUrl,
          context
        },
        '*'
      );
    } catch {}
  }

  function createDummyWindow(targetUrl) {
    let currentHref = targetUrl || '';
    const dummy = {
      closed: false,
      name: '',
      opener: window,
      focus() {},
      blur() {},
      close() {
        dummy.closed = true;
      },
      postMessage() {},
      location: {
        get href() {
          return currentHref;
        },
        set href(val) {
          const str = String(val || '').trim();
          if (!isAllowedDestination(str)) {
            reportBlocked(str, 'dummy.location.href');
            return;
          }
          currentHref = str;
        },
        replace(url) {
          const str = String(url || '').trim();
          if (!isAllowedDestination(str)) {
            reportBlocked(str, 'dummy.location.replace');
            return;
          }
        },
        assign(url) {
          const str = String(url || '').trim();
          if (!isAllowedDestination(str)) {
            reportBlocked(str, 'dummy.location.assign');
            return;
          }
        },
        reload() {},
        toString() {
          return currentHref;
        }
      },
      document: {
        open() {
          return this;
        },
        write() {},
        writeln() {},
        close() {}
      }
    };
    return dummy;
  }

  function onUserPointer(e) {
    if (!e || e.isTrusted !== true) return;
    try {
      const target = e.target;
      if (!target || (!(target instanceof Element) && !target.closest)) return;

      const anchor = target.closest('a[href]');

      // If click target is inside a media player (video, audio, player controls) and NOT an anchor with href,
      // reset trusted intent so pop-ups attached to video playback clicks are intercepted!
      const isMediaOrControl = Boolean(
        target.closest(
          'video, audio, .jwplayer, .plyr, .video-js, [class*="vjs-"], [class*="player-poster"], [class*="player-control"]'
        )
      );
      if (isMediaOrControl && !anchor) {
        lastTrustedIntent = null;
        lastTrustedLink = null;
        trustedClickUntil = 0;
        return;
      }

      if (anchor && anchor.href) {
        // Record initial href on pointerdown before malicious scripts can swap it
        if (!anchor.hasAttribute('data-ax-orig-href')) {
          anchor.setAttribute('data-ax-orig-href', anchor.href);
        }
        try {
          const href = anchor.href.trim();
          if (href.startsWith('http://') || href.startsWith('https://')) {
            let rect = anchor.getBoundingClientRect();
            if ((rect.width <= 0 || rect.height <= 0) && target.getBoundingClientRect) {
              rect = target.getBoundingClientRect();
            }

            let style;
            try {
              style = window.getComputedStyle(anchor);
            } catch {}
            const opacity = style ? parseFloat(style.opacity) : 1;
            const isVisible = style ? style.display !== 'none' && style.visibility !== 'hidden' : true;

            const textLen = (anchor.innerText || '').trim().length;
            const hasMedia = Boolean(anchor.querySelector('img, svg, canvas, video'));
            const hasContent = (rect.width > 0 && rect.height > 0) || textLen > 0 || hasMedia;

            // Strict popup trap filter: Never treat dynamically injected or player-clickjack links as trusted on left-click
            const isPlainLeftClick = e.button === 0 && !e.ctrlKey && !e.metaKey;
            const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
            const isBlank = targetAttr === '_blank';
            const isCross = isCrossSite(href);
            const now = Date.now();
            const isRecentlyAdded = recentLinks.has(anchor) && now - recentLinks.get(anchor) < 500;
            const isPlayerOrBodyTrap = Boolean(
              target.closest(
                'video, audio, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="vjs-"], [class*="jw-"]'
              ) ||
              target === document.body ||
              target === document.documentElement
            );

            if (isPlainLeftClick && isBlank && isCross && (isRecentlyAdded || isPlayerOrBodyTrap)) {
              lastTrustedIntent = null;
              lastTrustedLink = null;
              trustedClickUntil = 0;
              return;
            }

            if (hasContent && isVisible && opacity >= 0.15) {
              const u = new URL(href, window.location.href);
              const host = u.hostname.toLowerCase();
              const root = getRootDomain(host);

              const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
              const isMiddleClick = e.button === 1;
              const isModifier = Boolean(e.ctrlKey || e.metaKey);
              const isNewTabIntent = targetAttr === '_blank' || isMiddleClick || isModifier;

              trustedClickUntil = Date.now() + (isNewTabIntent ? 3500 : 2500);
              if (isNewTabIntent) {
                setTrustedIntent(href);
              }
              lastTrustedLink = {
                time: Date.now(),
                origin: u.origin.toLowerCase(),
                root,
                href
              };
              return;
            }
          }
        } catch {}
      }

      // Middle-click (wheel click) tolerance: if user middle-clicked, give 3500ms synchronous tolerance
      if (e.button === 1) {
        trustedClickUntil = Date.now() + 3500;
        return;
      }

      // Any click on document space or background that is not a visible anchor
      lastTrustedIntent = null;
      lastTrustedLink = null;
      trustedClickUntil = 0;
    } catch {}
  }

  // Intercept instantaneous transparent <a> traps injected on mousedown/pointerdown
  function onCaptureClickOrUp(e) {
    try {
      const target = e.target;
      if (!target || (!(target instanceof Element) && !target.closest)) return;

      if (typeof window !== 'undefined' && window.location) {
        const curHost = window.location.hostname.toLowerCase();
        if (isTrustedFeedOpener(curHost) || MAJOR_SAFE_PLATFORMS.some((p) => curHost === p || curHost.endsWith('.' + p))) {
          // Trusted social media / feed / platform: Always register user click intent and allow normal navigation
          const anchor = target.closest('a[href]');
          if (anchor && anchor.href) {
            setTrustedIntent(anchor.href);
          }
          return;
        }
      }

      // Middle-click (button 1) and Ctrl/Cmd/Shift+click are always the user's choice: record intent, never block.
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) {
        if (e.isTrusted === true) {
          const anchor = target.closest('a[href]');
          if (anchor && anchor.href) setTrustedIntent(anchor.href);
          trustedClickUntil = Date.now() + 2500;
        }
        return;
      }

      // Never interfere with legitimate video/audio player interactions, seekbars or sliders
      const isVideoControl = Boolean(
        (target.closest &&
          target.closest(
            'video, audio, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="vjs-"], [class*="jw-"], [class*="control"], [class*="progress"], [class*="timeline"], [class*="seekbar"], [role="slider"], [role="progressbar"], button, input, [aria-label*="play" i], [aria-label*="seek" i]'
          )) ||
        (target.matches &&
          target.matches(
            'video, audio, [role="slider"], [role="progressbar"], [class*="control"], [class*="progress"], [class*="slider"]'
          ))
      );

      if (isVideoControl) {
        const parentAnchor = target.closest('a[href]');
        if (parentAnchor && isCrossSite(parentAnchor.href)) {
          // If a cross-site ad anchor wraps the video player, neutralize navigation without breaking player clicks
          const trapUrl = parentAnchor.href;
          if (parentAnchor.removeAttribute) {
            parentAnchor.removeAttribute('href');
            parentAnchor.removeAttribute('target');
          }
          if (parentAnchor.setAttribute) {
            parentAnchor.setAttribute('data-ax-defused-trap', 'true');
          }
          if (e.preventDefault) e.preventDefault();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          reportBlocked(trapUrl, 'video-wrap-ad-trap');
          console.info('[AX-Popup] Video oynatıcısını saran izinsiz reklam linki engellendi:', trapUrl);
        }
        return;
      }

      if (e && e.isTrusted === true) {
        if (e.button === 1) {
          trustedClickUntil = Date.now() + 3500;
        }

        const anchor = target.closest('a[href]');
        if (anchor && anchor.href) {
          const href = anchor.href.trim();
          if (href.startsWith('http://') || href.startsWith('https://')) {
            let rect = anchor.getBoundingClientRect();
            if ((rect.width <= 0 || rect.height <= 0) && target.getBoundingClientRect) {
              rect = target.getBoundingClientRect();
            }
            let style;
            try {
              style = window.getComputedStyle(anchor);
            } catch {}
            const opacity = style ? parseFloat(style.opacity) : 1;
            const isVisible = style ? style.display !== 'none' && style.visibility !== 'hidden' : true;
            const textLen = (anchor.innerText || '').trim().length;
            const hasMedia = Boolean(anchor.querySelector('img, svg, canvas, video'));
            const hasContent = (rect.width > 0 && rect.height > 0) || textLen > 0 || hasMedia;

            // Strict popup trap filter: Never treat dynamically injected or player-clickjack links as trusted on left-click
            const isPlainLeftClick = e.button === 0 && !e.ctrlKey && !e.metaKey;
            const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
            const isBlank = targetAttr === '_blank';
            const isCross = isCrossSite(href);
            const now = Date.now();
            const isRecentlyAdded = recentLinks.has(anchor) && now - recentLinks.get(anchor) < 500;
            const isPlayerOrBodyTrap = Boolean(
              target.closest(
                'video, audio, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="vjs-"], [class*="jw-"]'
              ) ||
              target === document.body ||
              target === document.documentElement
            );

            if (isPlainLeftClick && isBlank && isCross && (isRecentlyAdded || isPlayerOrBodyTrap)) {
              lastTrustedIntent = null;
              lastTrustedLink = null;
              trustedClickUntil = 0;
              return;
            }

            if (hasContent && isVisible && opacity >= 0.15) {
              const u = new URL(href, window.location.href);
              const host = u.hostname.toLowerCase();
              const root = getRootDomain(host);

              const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
              const isMiddleClick = e.button === 1;
              const isModifier = Boolean(e.ctrlKey || e.metaKey);
              const isNewTabIntent = targetAttr === '_blank' || isMiddleClick || isModifier;

              trustedClickUntil = Date.now() + (isNewTabIntent ? 3500 : 2500);
              if (isNewTabIntent) {
                setTrustedIntent(href);
              }
              lastTrustedLink = {
                time: Date.now(),
                origin: u.origin.toLowerCase(),
                root,
                href
              };
            }
          }
        }
      }

      const anchor = target.closest('a[href]');
      if (!anchor || !anchor.href) return;

      // Clickjack Defense: Check if href was swapped dynamically between pointerdown and click
      const origHref = anchor.getAttribute('data-ax-orig-href');
      const currentHref = anchor.href || '';
      if (origHref && currentHref && origHref !== currentHref) {
        const isKnownLinkShim =
          currentHref.includes('l.instagram.com') ||
          currentHref.includes('t.co') ||
          currentHref.includes('google.com/url') ||
          currentHref.includes('l.facebook.com') ||
          currentHref.includes('out.reddit.com');
        if (!isKnownLinkShim && isCrossSite(currentHref) && !hasTrustedIntent(currentHref)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          reportBlocked(currentHref, 'href-swap-trap');
          console.info('[AX-Popup] Anlık href değiştirme tuzağı (clickjack) engellendi:', {
            origHref,
            swappedHref: currentHref
          });
          anchor.href = origHref;
          anchor.removeAttribute('data-ax-orig-href');
          return;
        }
      }
      anchor.removeAttribute('data-ax-orig-href');

      if (!isCrossSite(anchor.href)) return;

      let isTrap = false;
      const now = Date.now();
      const isBlank = (anchor.getAttribute('target') || '').toLowerCase().trim() === '_blank';
      const isRecentlyAdded = recentLinks.has(anchor) && now - recentLinks.get(anchor) < 500;

      // Left-click trap: anchor injected in the last 500ms, target=_blank, and transparent / fullscreen / over a player
      if (e.isTrusted === true && isBlank && isRecentlyAdded) {
        if (target.closest('video, audio, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"]')) {
          isTrap = true;
        } else {
          try {
            const rect = anchor.getBoundingClientRect();
            const style = window.getComputedStyle(anchor);
            const opacity = parseFloat(style.opacity);
            const fullscreen =
              rect.width >= (window.innerWidth || 1) * 0.8 && rect.height >= (window.innerHeight || 1) * 0.8;
            const transparent = (!isNaN(opacity) && opacity < 0.15) || (anchor.innerText || '').trim().length === 0;
            if (fullscreen || (transparent && !anchor.querySelector('img, svg, canvas, video'))) {
              isTrap = true;
            }
          } catch {}
        }
      }

      if (isTrap) {
        e.preventDefault();
        e.stopImmediatePropagation();
        reportBlocked(anchor.href, 'instant.anchor.trap');
        try {
          if (anchor.querySelector('video, audio')) {
            anchor.removeAttribute('href');
            anchor.removeAttribute('target');
            anchor.setAttribute('data-ax-defused-trap', 'true');
            const controls = anchor.querySelectorAll(
              'video, audio, button, [role="button"], [role="slider"], [class*="control"], [class*="progress"], [class*="seekbar"]'
            );
            for (let c = 0; c < controls.length; c++) {
              controls[c].style.setProperty('pointer-events', 'auto', 'important');
            }
          } else {
            anchor.remove();
          }
        } catch {}
      }
    } catch {}
  }

  window.addEventListener('pointerdown', onUserPointer, true);
  window.addEventListener('mousedown', onUserPointer, true);
  window.addEventListener('click', onCaptureClickOrUp, true);
  window.addEventListener('auxclick', onCaptureClickOrUp, true);
  window.addEventListener('pointerup', onCaptureClickOrUp, true);

  // Catch unsolicited cross-site target="_blank" form submissions
  window.addEventListener(
    'submit',
    (e) => {
      try {
        const form = e.target;
        if (!form || form.tagName !== 'FORM') return;
        const target = (form.getAttribute('target') || '').toLowerCase();
        const action = form.action || '';
        const cross = isCrossSite(action);
        if ((target === '_blank' || cross) && !isAllowedDestination(action)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          reportBlocked(action, 'event.submit');
          console.info('[AX-Popup] Form gönderimi önlendi (submit event):', action);
        }
      } catch {}
    },
    true
  );

  // Track DOM additions for recentLinks
  function markAnchorNode(node) {
    try {
      if (!node || node.nodeType !== 1) return;
      if (node.tagName === 'A' && node.href && isCrossSite(node.href)) {
        recentLinks.set(node, Date.now());
      }
      const anchors = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (isCrossSite(a.href)) {
          recentLinks.set(a, Date.now());
        }
      }
    } catch {}
  }

  try {
    const nodeObserver = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          markAnchorNode(added[j]);
        }
      }
    });
    if (document.documentElement) {
      nodeObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch {}

  // Function to apply comprehensive pop-up protection to any window object (main or clean iframe)
  function protectWindow(win) {
    if (!win || protectedWindows.has(win)) return;
    try {
      protectedWindows.add(win);
      win.__axMarkAnchorNode = markAnchorNode;

      // 1. Wrap win.open
      if (typeof win.open === 'function') {
        const nativeWinOpen = win.open;
        win.open = function (url, target, features) {
          try {
            const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
            const targetStr = (target !== undefined && target !== null ? String(target) : '').toLowerCase().trim();
            const isSelfNav = targetStr === '_self' || targetStr === '_top' || targetStr === '_parent';
            const isAllowed = isSelfNav ? isAllowedNavigation(strUrl) : isAllowedDestination(strUrl);
            if (!isAllowed) {
              reportBlocked(strUrl, 'window.open');
              console.info('[AX-Popup] Açılış/yönlendirme önlendi (window.open):', strUrl || 'about:blank');
              return createDummyWindow(strUrl);
            }
          } catch {}
          return nativeWinOpen.apply(this, arguments);
        };
      }

      // 1b. Wrap win.close to prevent malicious scripts from closing the user's active/main tab
      if (typeof win.close === 'function') {
        const nativeWinClose = win.close;
        win.close = function () {
          try {
            if (typeof window !== 'undefined' && window.sessionStorage?.getItem('ax_privacy_popup_shield') === 'disabled') {
              return nativeWinClose.apply(this, arguments);
            }
            // Protect main tabs; script-opened popups (OAuth/payment) may still close themselves
            const isMainTab = Boolean(!win.opener || win.opener === win);
            if (isMainTab) {
              console.info('[AX-Shield] İzinsiz window.close engellendi');
              reportBlocked(win.location?.href || '', 'window.close');
              return;
            }
          } catch {}
          return nativeWinClose.apply(this, arguments);
        };
      }

      // 2. Wrap win.HTMLAnchorElement.prototype.click
      if (win.HTMLAnchorElement && win.HTMLAnchorElement.prototype) {
        const nativeAnchorClick = win.HTMLAnchorElement.prototype.click;
        win.HTMLAnchorElement.prototype.click = function () {
          try {
            const target = (this.getAttribute('target') || '').toLowerCase();
            const hasDownload = this.hasAttribute('download');
            const href = this.href || '';
            const cross = isCrossSite(href);

            if (!hasDownload && (target === '_blank' || cross)) {
              if (!isAllowedDestination(href)) {
                reportBlocked(href, 'anchor.click');
                console.info('[AX-Popup] Yeni sekme açılışı önlendi (anchor.click):', href);
                return false;
              }
            }
          } catch {}
          return nativeAnchorClick.apply(this, arguments);
        };
      }

      // 3. Wrap win.EventTarget.prototype.dispatchEvent (synthetic event dispatch)
      if (win.EventTarget && win.EventTarget.prototype) {
        const nativeDispatch = win.EventTarget.prototype.dispatchEvent;
        win.EventTarget.prototype.dispatchEvent = function (event) {
          try {
            if (this && this.tagName === 'A' && this.href) {
              const evtType = (event?.type || '').toLowerCase();
              if (
                evtType === 'click' ||
                evtType === 'auxclick' ||
                evtType === 'pointerdown' ||
                evtType === 'pointerup' ||
                evtType === 'mousedown' ||
                evtType === 'mouseup' ||
                (win.MouseEvent && event instanceof win.MouseEvent) ||
                (win.PointerEvent && event instanceof win.PointerEvent)
              ) {
                const hasDownload = this.hasAttribute('download');
                const target = (this.getAttribute('target') || '').toLowerCase();
                const href = this.href;
                const cross = isCrossSite(href);

                if (!hasDownload && (target === '_blank' || cross)) {
                  if (!isAllowedDestination(href)) {
                    reportBlocked(href, 'synthetic.dispatchEvent');
                    console.info('[AX-Popup] Yeni sekme açılışı önlendi (dispatchEvent):', href);
                    return false; // Cancel synthetic click
                  }
                }
              }
            }
          } catch {}
          return nativeDispatch.apply(this, arguments);
        };
      }

      // 4. Wrap win.HTMLFormElement.prototype.submit & requestSubmit
      if (win.HTMLFormElement && win.HTMLFormElement.prototype) {
        const nativeFormSubmit = win.HTMLFormElement.prototype.submit;
        win.HTMLFormElement.prototype.submit = function () {
          try {
            const target = (this.getAttribute('target') || '').toLowerCase();
            const action = this.action || '';
            const cross = isCrossSite(action);

            if ((target === '_blank' || cross) && !isAllowedDestination(action)) {
              reportBlocked(action, 'form.submit');
              console.info('[AX-Popup] Form açılışı önlendi (form.submit):', action);
              return;
            }
          } catch {}
          return nativeFormSubmit.apply(this, arguments);
        };

        if (typeof win.HTMLFormElement.prototype.requestSubmit === 'function') {
          const nativeFormRequestSubmit = win.HTMLFormElement.prototype.requestSubmit;
          win.HTMLFormElement.prototype.requestSubmit = function (submitter) {
            try {
              const target = (submitter?.getAttribute?.('target') || this.getAttribute('target') || '').toLowerCase();
              const action = submitter?.getAttribute?.('formaction') || this.action || '';
              const cross = isCrossSite(action);

              if ((target === '_blank' || cross) && !isAllowedDestination(action)) {
                reportBlocked(action, 'form.requestSubmit');
                console.info('[AX-Popup] Form açılışı önlendi (form.requestSubmit):', action);
                return;
              }
            } catch {}
            return nativeFormRequestSubmit.apply(this, arguments);
          };
        }
      }

      // 5. Wrap Location.prototype.assign, replace, and href setter (Anti-DevTools & unprompted redirect blocker)
      const locProto = win.Location ? win.Location.prototype : null;
      if (locProto) {
        if (typeof locProto.assign === 'function') {
          const nativeAssign = locProto.assign;
          locProto.assign = function (url) {
            try {
              const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
              if (!isAllowedNavigation(strUrl)) {
                reportBlocked(strUrl, 'location.assign');
                console.info('[AX-Popup] Sayfa yönlendirmesi önlendi (location.assign):', strUrl);
                return;
              }
            } catch {}
            return nativeAssign.apply(this, arguments);
          };
        }

        if (typeof locProto.replace === 'function') {
          const nativeReplace = locProto.replace;
          locProto.replace = function (url) {
            try {
              const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
              if (!isAllowedNavigation(strUrl)) {
                reportBlocked(strUrl, 'location.replace');
                console.info('[AX-Popup] Sayfa yönlendirmesi önlendi (location.replace):', strUrl);
                return;
              }
            } catch {}
            return nativeReplace.apply(this, arguments);
          };
        }

        try {
          const descHref = Object.getOwnPropertyDescriptor(locProto, 'href');
          if (descHref && descHref.set) {
            const nativeHrefSet = descHref.set;
            Object.defineProperty(locProto, 'href', {
              set(url) {
                try {
                  const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
                  if (!isAllowedNavigation(strUrl)) {
                    reportBlocked(strUrl, 'location.href');
                    console.info('[AX-Popup] Sayfa yönlendirmesi önlendi (location.href):', strUrl);
                    return;
                  }
                } catch {}
                return nativeHrefSet.call(this, url);
              },
              get: descHref.get,
              configurable: true,
              enumerable: true
            });
          }
        } catch {}
      }

      // Also protect win.location directly if it has instance methods
      try {
        if (win.location) {
          if (typeof win.location.assign === 'function') {
            const origLocAssign = win.location.assign;
            win.location.assign = function (url) {
              try {
                const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
                if (!isAllowedNavigation(strUrl)) {
                  reportBlocked(strUrl, 'win.location.assign');
                  console.info('[AX-Popup] Sayfa yönlendirmesi önlendi (win.location.assign):', strUrl);
                  return;
                }
              } catch {}
              return origLocAssign.apply(this, arguments);
            };
          }
          if (typeof win.location.replace === 'function') {
            const origLocReplace = win.location.replace;
            win.location.replace = function (url) {
              try {
                const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
                if (!isAllowedNavigation(strUrl)) {
                  reportBlocked(strUrl, 'win.location.replace');
                  console.info('[AX-Popup] Sayfa yönlendirmesi önlendi (win.location.replace):', strUrl);
                  return;
                }
              } catch {}
              return origLocReplace.apply(this, arguments);
            };
          }
        }
      } catch {}
      // 6. Anti-Browser-Locker: Protect against abusive history.pushState loops that freeze browsers
      if (win.history && typeof win.history.pushState === 'function') {
        const origPushState = win.history.pushState;
        let pushCount = 0;
        let lastPushTime = Date.now();
        win.history.pushState = function () {
          const now = Date.now();
          if (now - lastPushTime > 1000) {
            pushCount = 0;
            lastPushTime = now;
          }
          pushCount++;
          if (pushCount > 50) {
            console.warn('[AX-Popup] Kötü niyetli history.pushState döngüsü (browser-locker) sınırlandırıldı.');
            return;
          }
          return origPushState.apply(this, arguments);
        };
      }
    } catch {}
  }

  // Protect main window immediately
  protectWindow(window);

  // Hook HTMLIFrameElement.prototype.contentWindow & contentDocument to close clean iframe escape hatch
  try {
    const iframeProto = HTMLIFrameElement.prototype;
    const descContentWindow = Object.getOwnPropertyDescriptor(iframeProto, 'contentWindow');
    if (descContentWindow && descContentWindow.get) {
      const nativeGetWindow = descContentWindow.get;
      Object.defineProperty(iframeProto, 'contentWindow', {
        get() {
          const win = nativeGetWindow.call(this);
          if (win) {
            protectWindow(win);
          }
          return win;
        },
        configurable: true,
        enumerable: true
      });
    }

    const descContentDoc = Object.getOwnPropertyDescriptor(iframeProto, 'contentDocument');
    if (descContentDoc && descContentDoc.get) {
      const nativeGetDoc = descContentDoc.get;
      Object.defineProperty(iframeProto, 'contentDocument', {
        get() {
          const doc = nativeGetDoc.call(this);
          try {
            if (doc && doc.defaultView) {
              protectWindow(doc.defaultView);
            }
          } catch {}
          return doc;
        },
        configurable: true,
        enumerable: true
      });
    }
  } catch (err) {
    console.warn('[AX-Privacy popup-shield] Could not hook iframe getters:', err);
  }

  function unlockBodyOverflow() {
    try {
      if (document.body && (document.body.style.overflow === 'hidden' || document.body.style.position === 'fixed')) {
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('position');
      }
      if (document.documentElement && document.documentElement.style.overflow === 'hidden') {
        document.documentElement.style.removeProperty('overflow');
      }
    } catch {}
  }

  // Hook Element.prototype.attachShadow for closed Shadow DOM vignette & push overlays
  try {
    const nativeAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      if (this.id === 'ax-privacy-alert-host') {
        return nativeAttachShadow.apply(this, arguments);
      }
      if (typeof window !== 'undefined' && window.location) {
        const curH = (window.location.hostname || '').toLowerCase();
        if (curH.includes('youtube.com') || curH.includes('twitch.tv')) {
          return nativeAttachShadow.apply(this, arguments);
        }
      }

      // Mark host element for universal scoring scanner in content script
      try {
        this.setAttribute('data-ax-shadow-host', '1');
      } catch {}

      const shadowRoot = nativeAttachShadow.apply(this, arguments);
      try {
        this.__axShadowRoot = shadowRoot;
      } catch {}

      try {
        const host = this;
        setTimeout(() => {
          try {
            if (!host.isConnected) return;
            const style = window.getComputedStyle(host);
            const pos = style.position;
            const z = parseInt(style.zIndex, 10);
            const isFloating = pos === 'fixed' || pos === 'absolute';
            const rect = host.getBoundingClientRect();
            const text = (host.innerText || '').toLowerCase();

            // Check if it's a fullscreen vignette overlay
            if (isFloating && (z >= 99999 || z >= 2147483000)) {
              if (rect.width >= window.innerWidth * 0.75 && rect.height >= window.innerHeight * 0.75) {
                host.remove();
                unlockBodyOverflow();
                console.info('[AX-Vignette] Shadow DOM reklam katmanı temizlendi');
                reportBlocked('shadow-dom-vignette', 'attachShadow');
                return;
              }
            }

            // Check if it carries ad overlay/push signatures
            const idClass = ((host.id || '') + ' ' + (host.className || '')).toLowerCase();
            const hasAdIdent = /\b(reklam|ad-?|banner|vignette|interstitial|popunder|push)\b/i.test(idClass);
            const hasBait =
              text.includes('devam etmek için') ||
              text.includes('dokunun') ||
              text.includes('robot') ||
              text.includes('yükleniyor') ||
              text.includes('tap to continue');
            if (isFloating && z >= 9999 && (hasAdIdent || hasBait)) {
              host.remove();
              unlockBodyOverflow();
              console.info('[AX-Shield] Shadow DOM reklam/push katmanı temizlendi');
              reportBlocked('shadow-dom-ad-overlay', 'attachShadow');
            }
          } catch {}
        }, 15);
      } catch {}
      return shadowRoot;
    };
  } catch (err) {
    console.warn('[AX-Privacy popup-shield] Could not hook attachShadow:', err);
  }

  // Hook Notification.requestPermission to silently deny unsolicited auto-push permission traps
  try {
    if (typeof Notification !== 'undefined' && Notification.requestPermission) {
      const nativeRequestPermission = Notification.requestPermission;
      Notification.requestPermission = function () {
        try {
          if (
            typeof window !== 'undefined' &&
            window.sessionStorage?.getItem('ax_privacy_popup_shield') === 'disabled'
          ) {
            return nativeRequestPermission.apply(this, arguments);
          }
          const curHost =
            typeof window !== 'undefined' && window.location?.hostname
              ? window.location.hostname.toLowerCase()
              : '';
          const TRUSTED_NOTIFICATION_HOSTS = [
            'chat.google.com',
            'mail.google.com',
            'discord.com',
            'web.whatsapp.com',
            'web.telegram.org',
            'slack.com',
            'teams.microsoft.com',
            'twitter.com',
            'x.com',
            'facebook.com',
            'instagram.com'
          ];
          const isTrustedHost = TRUSTED_NOTIFICATION_HOSTS.some(
            (h) => curHost === h || curHost.endsWith('.' + h)
          );
          const now = Date.now();
          const isUserInitiated =
            trustedClickUntil > now || (lastTrustedLink && now - lastTrustedLink.time <= 1500);

          if (!isTrustedHost && !isUserInitiated) {
            console.info('[AX-Shield] İzinsiz otomatik push bildirim isteği engellendi');
            reportBlocked('push-notification-trap', 'Notification.requestPermission');
            if (typeof arguments[0] === 'function') {
              try {
                arguments[0]('denied');
              } catch {}
            }
            return Promise.resolve('denied');
          }
        } catch {}
        return nativeRequestPermission.apply(this, arguments);
      };
    }
  } catch (err) {
    console.warn('[AX-Privacy popup-shield] Could not hook Notification.requestPermission:', err);
  }

  // Hook navigator.serviceWorker.register to block known ad/push notification service workers
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.serviceWorker &&
      navigator.serviceWorker.register
    ) {
      const nativeSWRegister = navigator.serviceWorker.register;
      navigator.serviceWorker.register = function (scriptURL, options) {
        try {
          if (
            typeof window !== 'undefined' &&
            window.sessionStorage?.getItem('ax_privacy_popup_shield') === 'disabled'
          ) {
            return nativeSWRegister.apply(this, arguments);
          }
          const strUrl = String(scriptURL || '').toLowerCase();
          const AD_SW_PATTERNS = [
            'push-sw',
            'ntfc',
            'monetag',
            'propeller',
            'adsterra',
            'inpage',
            'onesignal-ad',
            'ad-worker',
            'ad-sw',
            'afu.php'
          ];
          if (AD_SW_PATTERNS.some((p) => strUrl.includes(p))) {
            console.info('[AX-Shield] İzinsiz reklam service worker kaydı engellendi:', strUrl);
            reportBlocked('ad-service-worker', strUrl);
            return Promise.reject(new Error('[AX-Shield] Ad service worker blocked'));
          }
        } catch {}
        return nativeSWRegister.apply(this, arguments);
      };
    }
  } catch (err) {
    console.warn('[AX-Privacy popup-shield] Could not hook serviceWorker.register:', err);
  }

  // Universal In-Page Vignette / Fake Loading Modal Cleaner
  function cleanVignettesInDocument() {
    try {
      if (typeof window !== 'undefined' && window.location) {
        const curHost = window.location.hostname.toLowerCase();
        if (isTrustedFeedOpener(curHost) || MAJOR_SAFE_PLATFORMS.some((p) => curHost === p || curHost.endsWith('.' + p))) {
          return;
        }
      }

      const elements = document.querySelectorAll(
        'div, section, aside, iframe, [class*="vignette"], [id*="vignette"], [class*="interstitial"], [id*="interstitial"]'
      );

      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (!el || el.__ax_vignette_scanned || el.id === 'ax-privacy-alert-host') continue;

        // Never touch login forms, media players, dialogs, or legitimate interactive UI
        if (
          el.querySelector('input, select, textarea, button, [role="button"], [role="dialog"], video, audio, svg, img') ||
          (el.getAttribute && (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true'))
        ) {
          continue;
        }

        // Never touch navigation or breadcrumb headers
        if (el.closest('nav, header')) continue;

        let style;
        try {
          style = window.getComputedStyle(el);
        } catch {
          continue;
        }

        if (!style || style.display === 'none' || style.visibility === 'hidden') continue;

        const pos = style.position;
        if (pos !== 'fixed' && pos !== 'absolute') continue;

        const zIndex = parseInt(style.zIndex, 10);
        if (zIndex < 9999) continue;

        const rect = el.getBoundingClientRect();
        const text = (el.innerText || '').trim();
        const lowerText = text.toLowerCase();

        const candidateData = {
          tagName: el.tagName,
          style: { position: pos, zIndex: String(zIndex) },
          rect: { width: rect.width, height: rect.height },
          text: text,
          hasPasswordInput: Boolean(el.querySelector('input[type="password"]')),
          hasVideo: Boolean(el.querySelector('video, audio')),
          hasRealInputs: Boolean(el.querySelector('input, select, textarea')),
          hasAuthKeywords:
            lowerText.includes('şifre') ||
            lowerText.includes('password') ||
            lowerText.includes('giriş yap') ||
            lowerText.includes('sign in')
        };

        const antiAdblockPhrases = [
          'reklam engelleyiciyi kapat',
          'reklam engelleyicinizi kapatın',
          'lütfen reklam engelleyiciyi devre dışı bırakın',
          'ad blocker detected',
          'please disable your ad blocker',
          'adblock detected',
          'disable adblock to continue',
          'reklam engelleyici tespit edildi',
          'adblocker tespit edildi',
          'adblocker\'ı kapat',
          'disable adblock',
          'turn off your ad blocker'
        ];
        const isAntiAdblockModal = antiAdblockPhrases.some((p) => lowerText.includes(p));
        if (isAntiAdblockModal && !candidateData.hasPasswordInput) {
          el.remove();
          unlockBodyOverflow();
          console.info('[AX-AntiAdBlock] Anti-adblocker duvarı temizlendi');
          reportBlocked('anti-adblock-modal', 'cleanVignettes');
          continue;
        }

        if (isVignetteCandidate(candidateData)) {
          el.remove();
          unlockBodyOverflow();
          console.info('[AX-Vignette] Reklam katmanı temizlendi');
          reportBlocked('vignette-overlay', 'cleanVignettes');
        }
      }
    } catch {}
  }

  let vignetteTimer = null;
  const debouncedVignetteScan = () => {
    if (vignetteTimer) clearTimeout(vignetteTimer);
    vignetteTimer = setTimeout(cleanVignettesInDocument, 150);
  };

  try {
    const vigObserver = new MutationObserver(debouncedVignetteScan);
    if (document.documentElement) {
      vigObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    window.addEventListener('DOMContentLoaded', debouncedVignetteScan);
    window.addEventListener('load', debouncedVignetteScan);
  } catch {}

  // Anti-DevTools & Right-Click Protector (Defeats site-level inspection & contextmenu blocks)
  try {
    window.addEventListener(
      'keydown',
      (e) => {
        if (isDevToolsKey(e)) {
          // Stop malicious or streaming site scripts from blocking DevTools / view source
          e.stopImmediatePropagation();
        }
      },
      true // Capture phase to run before site event handlers
    );

    window.addEventListener(
      'contextmenu',
      (e) => {
        // Stop site scripts from disabling native right-click
        e.stopImmediatePropagation();
      },
      true // Capture phase to run before site event handlers
    );
  } catch {}
})();

// Export for Node.js unit tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isVignetteCandidate,
    isAllowedDestination,
    isAllowedNavigation,
    getRootDomain,
    isCrossSite,
    isDevToolsKey,
    setTrustedIntent,
    hasTrustedIntent,
    hasTrustedClick,
    getTrustedClickUntil: () => trustedClickUntil,
    TRUSTED_AUTH_HOSTS
  };
}
