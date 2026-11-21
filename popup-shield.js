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
let lastTrustedLink = null; // { time: number, origin: string, href: string }

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
    const exp = now + 1500;
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

const TRUSTED_AUTH_HOSTS = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'github.com',
  'discord.com',
  'facebook.com',
  'twitter.com',
  'x.com',
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

  if (!targetUrl || targetUrl === 'about:blank' || targetUrl.trim() === '') {
    if (hasTrustedIntent(targetUrl)) {
      return true;
    }
    return false;
  }

  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const currentOrigin = window.location.origin.toLowerCase();
    const resolved = new URL(targetUrl, window.location.href);
    const targetOrigin = resolved.origin.toLowerCase();
    const targetHost = resolved.hostname.toLowerCase();

    // Same-origin navigation or relative paths are always allowed
    if (targetOrigin === currentOrigin) {
      return true;
    }

    // Same root domain navigation is allowed
    const currentRoot = getRootDomain(window.location.hostname);
    const targetRoot = getRootDomain(targetHost);
    if (currentRoot && targetRoot && currentRoot === targetRoot) {
      return true;
    }

    // Legitimate authentication, payment gateways, and banking portals
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

    // Check synchronous user intent (set on user click with new tab intent)
    if (hasTrustedIntent(targetUrl)) {
      return true;
    }

    // Fallback: Check if user genuinely clicked a visible anchor to this target origin within 700ms
    if (lastTrustedLink && Date.now() - lastTrustedLink.time <= 700) {
      if (
        lastTrustedLink.origin === targetOrigin ||
        lastTrustedLink.href === targetUrl ||
        getRootDomain(new URL(lastTrustedLink.href, window.location.href).hostname) === targetRoot
      ) {
        return true;
      }
    }

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

  // Ctrl+Shift+I (73), Ctrl+Shift+J (74), Ctrl+Shift+C (67)
  if (ctrlOrMeta && shift && (key === 'i' || key === 'j' || key === 'c' || code === 73 || code === 74 || code === 67)) {
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
      if (!target || !(target instanceof Element)) return;

      // CRITICAL: If click target is video, media player controls, buttons, inputs, or form fields,
      // reset trusted intent so pop-ups attached to video clicks are immediately intercepted!
      const isMediaOrControl = Boolean(
        target.closest(
          'video, audio, button, input, select, textarea, .jwplayer, .plyr, .video-js, [class*="play"], [class*="control"], [class*="btn"]'
        )
      );
      if (isMediaOrControl) {
        lastTrustedIntent = null;
        lastTrustedLink = null;
        return;
      }

      const anchor = target.closest('a[href]');
      if (anchor && anchor.href) {
        try {
          const href = anchor.href.trim();
          if (href.startsWith('http://') || href.startsWith('https://')) {
            const rect = anchor.getBoundingClientRect();
            let style;
            try {
              style = window.getComputedStyle(anchor);
            } catch {}
            const opacity = style ? parseFloat(style.opacity) : 1;
            const isVisible = style ? style.display !== 'none' && style.visibility !== 'hidden' : true;

            if (rect.width > 0 && rect.height > 0 && isVisible && opacity >= 0.2) {
              const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
              const isNewTabIntent = targetAttr === '_blank' || e.button === 1 || e.ctrlKey || e.metaKey;
              if (isNewTabIntent) {
                setTrustedIntent(href);
              }
              lastTrustedLink = {
                time: Date.now(),
                origin: new URL(href, window.location.href).origin.toLowerCase(),
                href: href
              };
              return;
            }
          }
        } catch {}
      }

      // Any click on document space or background that is not a visible anchor
      lastTrustedIntent = null;
      lastTrustedLink = null;
    } catch {}
  }

  // Intercept instantaneous transparent <a> traps injected on mousedown/pointerdown
  function onCaptureClickOrUp(e) {
    try {
      const target = e.target;
      if (!target || !(target instanceof Element)) return;

      if (e && e.isTrusted === true) {
        const anchor = target.closest('a[href]');
        if (anchor && anchor.href) {
          const href = anchor.href.trim();
          if (href.startsWith('http://') || href.startsWith('https://')) {
            const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
            const isNewTabIntent = targetAttr === '_blank' || e.button === 1 || e.ctrlKey || e.metaKey;
            if (isNewTabIntent) {
              let style;
              try {
                style = window.getComputedStyle(anchor);
              } catch {}
              const opacity = style ? parseFloat(style.opacity) : 1;
              const isVisible = style ? style.display !== 'none' && style.visibility !== 'hidden' : true;
              const rect = anchor.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && isVisible && opacity >= 0.2) {
                setTrustedIntent(href);
              }
            }
          }
        }
      }

      const anchor = target.closest('a[href]');
      if (!anchor || !anchor.href) return;

      if (!isCrossSite(anchor.href)) return;

      let isTrap = false;
      const now = Date.now();

      // Sign 1: Added to DOM within the last 600ms (classic mousedown injection trap)
      if (recentLinks.has(anchor)) {
        const addedAt = recentLinks.get(anchor);
        if (now - addedAt < 600) {
          isTrap = true;
        }
      }

      // Sign 2: Fixed or absolute overlay with high z-index, opacity < 0.15, or covering huge screen area
      if (!isTrap) {
        try {
          const style = window.getComputedStyle(anchor);
          const pos = style.position;
          if (pos === 'fixed' || pos === 'absolute') {
            const z = parseInt(style.zIndex, 10);
            const opacity = parseFloat(style.opacity);
            const rect = anchor.getBoundingClientRect();
            const wRatio = rect.width / (window.innerWidth || 1);
            const hRatio = rect.height / (window.innerHeight || 1);

            if (opacity < 0.15 || z >= 99999 || (wRatio >= 0.45 && hRatio >= 0.45)) {
              isTrap = true;
            }
          }
        } catch {}
      }

      // Sign 3: Empty text content, no visible img/svg/button, but covering substantial area
      if (!isTrap) {
        const textLen = (anchor.innerText || '').trim().length;
        const hasMedia = Boolean(anchor.querySelector('img, svg, button, canvas, video'));
        if (textLen === 0 && !hasMedia) {
          const rect = anchor.getBoundingClientRect();
          if (rect.width >= 150 && rect.height >= 100) {
            isTrap = true;
          }
        }
      }

      if (isTrap) {
        e.preventDefault();
        e.stopImmediatePropagation();
        reportBlocked(anchor.href, 'instant.anchor.trap');
        try {
          anchor.remove();
        } catch {}
      }
    } catch {}
  }

  window.addEventListener('pointerdown', onUserPointer, true);
  window.addEventListener('mousedown', onUserPointer, true);
  window.addEventListener('click', onCaptureClickOrUp, true);
  window.addEventListener('auxclick', onCaptureClickOrUp, true);
  window.addEventListener('pointerup', onCaptureClickOrUp, true);

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
    const nativeAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {
      markAnchorNode(child);
      return nativeAppendChild.apply(this, arguments);
    };

    const nativeInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (newNode, refNode) {
      markAnchorNode(newNode);
      return nativeInsertBefore.apply(this, arguments);
    };
  } catch {}

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

      // 1. Wrap win.open
      if (typeof win.open === 'function') {
        const nativeWinOpen = win.open;
        win.open = function (url, target, features) {
          try {
            const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
            if (!isAllowedDestination(strUrl)) {
              reportBlocked(strUrl, 'window.open');
              console.info('[AX-Popup] Yeni sekme açılışı önlendi (window.open):', strUrl || 'about:blank');
              return createDummyWindow(strUrl);
            }
          } catch {}
          return nativeWinOpen.apply(this, arguments);
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

      // 4. Wrap win.HTMLFormElement.prototype.submit
      if (win.HTMLFormElement && win.HTMLFormElement.prototype) {
        const nativeFormSubmit = win.HTMLFormElement.prototype.submit;
        win.HTMLFormElement.prototype.submit = function () {
          try {
            const isDetached = !this.isConnected;
            const isZeroSize = this.offsetWidth === 0 && this.offsetHeight === 0;
            const target = (this.getAttribute('target') || '').toLowerCase();
            const action = this.action || '';

            if ((isDetached || isZeroSize) && target === '_blank' && action) {
              if (!isAllowedDestination(action)) {
                reportBlocked(action, 'form.submit');
                return;
              }
            }
          } catch {}
          return nativeFormSubmit.apply(this, arguments);
        };
      }

      // 5. Wrap Location.prototype.assign and replace
      const locProto = win.Location ? win.Location.prototype : null;
      if (locProto && typeof locProto.assign === 'function') {
        const nativeAssign = locProto.assign;
        locProto.assign = function (url) {
          try {
            const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
            if (!isAllowedDestination(strUrl)) {
              reportBlocked(strUrl, 'location.assign');
              return;
            }
          } catch {}
          return nativeAssign.apply(this, arguments);
        };
      }

      if (locProto && typeof locProto.replace === 'function') {
        const nativeReplace = locProto.replace;
        locProto.replace = function (url) {
          try {
            const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
            if (!isAllowedDestination(strUrl)) {
              reportBlocked(strUrl, 'location.replace');
              return;
            }
          } catch {}
          return nativeReplace.apply(this, arguments);
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

  // Hook Element.prototype.attachShadow for closed Shadow DOM vignette overlays
  try {
    const nativeAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      if (this.id === 'ax-privacy-alert-host') {
        return nativeAttachShadow.apply(this, arguments);
      }
      const shadowRoot = nativeAttachShadow.apply(this, arguments);
      try {
        const host = this;
        setTimeout(() => {
          try {
            if (!host.isConnected) return;
            const style = window.getComputedStyle(host);
            const pos = style.position;
            const z = parseInt(style.zIndex, 10);
            if (pos === 'fixed' && (z >= 999999 || z >= 2147483000)) {
              const rect = host.getBoundingClientRect();
              if (rect.width >= window.innerWidth * 0.75 && rect.height >= window.innerHeight * 0.75) {
                host.remove();
                unlockBodyOverflow();
                console.info('[AX-Vignette] Shadow DOM reklam katmanı temizlendi');
                reportBlocked('shadow-dom-vignette', 'attachShadow');
              }
            }
          } catch {}
        }, 15);
      } catch {}
      return shadowRoot;
    };
  } catch (err) {
    console.warn('[AX-Privacy popup-shield] Could not hook attachShadow:', err);
  }

  // Universal In-Page Vignette / Fake Loading Modal Cleaner
  function cleanVignettesInDocument() {
    try {
      const elements = document.querySelectorAll(
        'div, section, aside, iframe, [class*="vignette"], [id*="vignette"], [class*="interstitial"], [id*="interstitial"]'
      );

      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (!el || el.__ax_vignette_scanned || el.id === 'ax-privacy-alert-host') continue;

        // Never touch login forms or media players
        if (el.querySelector('input[type="password"], video, audio')) {
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
    getRootDomain,
    isCrossSite,
    isDevToolsKey,
    setTrustedIntent,
    hasTrustedIntent,
    TRUSTED_AUTH_HOSTS
  };
}
