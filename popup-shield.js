/**
 * AX-Privacy Pop-up & Click-Hijack Shield (Manifest V3 - MAIN World - v2.6.0)
 * Features:
 *   - Captures trusted user clicks to allow legitimate user navigations
 *   - Resets trusted click state on video, player controls, buttons, or blank space clicks
 *   - Intercepts window.open calls to untrusted external domains and returns a safe window proxy
 *   - Neutralizes detached/hidden synthetic <a> and <form> pop-under triggers
 *   - Intercepts programmatic location.assign & location.replace click-hijack redirects
 *   - Supports all_frames: true (runs inside embedded iframes and top-level pages)
 *   - Zero external dependencies, pure JS wrapped in robust try/catch blocks
 */

(function () {
  'use strict';

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

  // Track the most recent trusted user click on an anchor
  let lastTrustedLink = null; // { time: number, origin: string, href: string }

  const TRUSTED_AUTH_HOSTS = [
    'accounts.google.com',
    'appleid.apple.com',
    'login.microsoftonline.com',
    'github.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'paypal.com'
  ];

  function onUserPointer(e) {
    if (!e || e.isTrusted !== true) return;
    try {
      const target = e.target;
      if (!target || !(target instanceof Element)) return;

      // CRITICAL: If click target is video, media player controls, buttons, inputs, or form fields,
      // reset lastTrustedLink to null so pop-ups attached to video clicks are immediately intercepted!
      const isMediaOrControl = Boolean(
        target.closest(
          'video, audio, button, input, select, textarea, .jwplayer, .plyr, .video-js, [class*="play"], [class*="control"], [class*="btn"]'
        )
      );
      if (isMediaOrControl) {
        lastTrustedLink = null;
        return;
      }

      const anchor = target.closest('a[href]');
      if (anchor && anchor.href) {
        try {
          const u = new URL(anchor.href, window.location.href);
          const rect = anchor.getBoundingClientRect();
          // Ensure anchor has physical presence (not an invisible zero-pixel or transparent overlay trap)
          if (rect.width > 0 && rect.height > 0) {
            lastTrustedLink = {
              time: Date.now(),
              origin: u.origin.toLowerCase(),
              href: anchor.href
            };
            return;
          }
        } catch {}
      }

      // Any click on document space or background that is not a visible anchor
      lastTrustedLink = null;
    } catch {}
  }

  // Capture user interactions at the earliest phase before page listeners
  window.addEventListener('pointerdown', onUserPointer, true);
  window.addEventListener('click', onUserPointer, true);

  function isAllowedDestination(targetUrl) {
    if (!targetUrl || targetUrl === 'about:blank' || targetUrl.trim() === '') {
      // about:blank is only allowed if a trusted link click happened in the last 700ms
      if (lastTrustedLink && Date.now() - lastTrustedLink.time <= 700) {
        return true;
      }
      return false;
    }

    try {
      const currentOrigin = window.location.origin.toLowerCase();
      const resolved = new URL(targetUrl, window.location.href);
      const targetOrigin = resolved.origin.toLowerCase();
      const targetHost = resolved.hostname.toLowerCase();

      // Same-origin navigation or relative paths are always allowed
      if (targetOrigin === currentOrigin) {
        return true;
      }

      // Legitimate authentication, payment gateways, and banking portals
      if (
        TRUSTED_AUTH_HOSTS.some((h) => targetHost === h || targetHost.endsWith('.' + h)) ||
        targetHost.includes('oauth') ||
        targetHost.includes('3dsecure') ||
        targetHost.includes('banka') ||
        targetHost.includes('odeme')
      ) {
        return true;
      }

      // Check if user genuinely clicked a visible anchor to this target origin within 700ms
      if (lastTrustedLink && Date.now() - lastTrustedLink.time <= 700) {
        if (lastTrustedLink.origin === targetOrigin || lastTrustedLink.href === targetUrl) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

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

  // 1. Wrap window.open
  try {
    const nativeOpen = window.open;
    window.open = function (url, target, features) {
      try {
        const strUrl = url !== undefined && url !== null ? String(url).trim() : '';
        if (!isAllowedDestination(strUrl)) {
          reportBlocked(strUrl, 'window.open');
          return createDummyWindow(strUrl);
        }
      } catch (err) {
        // Fall back to native if evaluation fails
      }
      return nativeOpen.apply(this, arguments);
    };
  } catch (err) {
    console.warn('[AX-Privacy popup-shield] Could not hook window.open:', err);
  }

  // 2. Wrap HTMLAnchorElement.prototype.click
  try {
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        const isDetached = !this.isConnected;
        const isZeroSize = this.offsetWidth === 0 && this.offsetHeight === 0;
        const target = (this.getAttribute('target') || '').toLowerCase();
        const hasDownload = this.hasAttribute('download');
        const href = this.href || '';

        if ((isDetached || isZeroSize) && target === '_blank' && !hasDownload && href) {
          if (!isAllowedDestination(href)) {
            reportBlocked(href, 'anchor.click');
            return;
          }
        }
      } catch {}
      return nativeAnchorClick.apply(this, arguments);
    };
  } catch (err) {
    console.warn('[AX-Privacy popup-shield] Could not hook anchor.click:', err);
  }

  // 3. Wrap HTMLFormElement.prototype.submit
  try {
    const nativeFormSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
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
  } catch (err) {
    console.warn('[AX-Privacy popup-shield] Could not hook form.submit:', err);
  }

  // 4. Wrap Location.prototype.assign and replace to block programmatic redirects
  try {
    const locProto = window.Location ? window.Location.prototype : null;
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
  } catch (err) {}

  try {
    const locProto = window.Location ? window.Location.prototype : null;
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
  } catch (err) {}
})();
