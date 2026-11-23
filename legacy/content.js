/**
 * AX-Privacy Content Script (Manifest V3)
 * Non-breaking cosmetic ad hiding & isolated closed Shadow DOM security banner.
 */

(function () {
  'use strict';

  // Prevent multiple injections in the same frame
  if (window.__AX_PRIVACY_INITIALIZED__) return;
  window.__AX_PRIVACY_INITIALIZED__ = true;

  const currentHost = window.location.hostname.toLowerCase();
  const AX_CANDIDATE_SELECTOR =
    'div, section, aside, span, a, ins, [id*="overlay"], [class*="overlay"], [id*="banner"], [class*="banner"], [id*="reklam"], [class*="reklam"], [data-ad], [data-adslot]';
  const AX_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'SVG', 'HEAD', 'META', 'LINK', 'BR', 'HR',
    'NOSCRIPT', 'HTML', 'BODY', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'ARTICLE', 'FORM'
  ]);
  // YouTube navigation drawer / guide and our own UI must never be scored or hidden
  const AX_NEVER_TOUCH_SELECTOR =
    'ytd-guide-renderer, tp-yt-app-drawer, #guide, #sections, ytd-mini-guide-renderer, #ax-privacy-alert-host, #ax-privacy-picker-host, #ax-privacy-picker-overlay';

  const brainRef = typeof AxBrain !== 'undefined' ? AxBrain : (typeof window !== 'undefined' ? window.AxBrain : (typeof globalThis !== 'undefined' ? globalThis.AxBrain : null));
  let currentBrainModel = brainRef?.createDefaultModel?.() || null;
  // Element -> last evaluated signature. An element is re-scored when it changes (e.g. empty slot later filled).
  const evaluatedSignatures = new WeakMap();

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

  function evaluateElementAdScore(el, computedStyle, rect, hostName = '', model = currentBrainModel) {
    if (!el) return { score: 0, reasons: ['null-element'], excluded: true, reason: 'null-element', shouldHide: false };
    if (el.id === 'ax-privacy-alert-host' || el.id === 'ax-privacy-picker-host') {
      return { score: 0, reasons: ['alert-host'], excluded: true, reason: 'alert-host', shouldHide: false };
    }
    if (el.closest && el.closest(AX_NEVER_TOUCH_SELECTOR)) {
      return { score: 0, reasons: ['protected-ui'], excluded: true, reason: 'protected-ui', shouldHide: false };
    }
    const ownIdent = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
    if (/\b(upload|download|header|loading|shadow|radio|badge)\b/i.test(ownIdent)) {
      return { score: 0, reasons: ['protected-class'], excluded: true, reason: 'protected-class', shouldHide: false };
    }

    const tag = (el.tagName || '').toLowerCase();
    const SAFE_TAGS = new Set(['html', 'body', 'main', 'article', 'header', 'nav', 'footer']);
    if (SAFE_TAGS.has(tag)) return { score: 0, reasons: ['safe-tag'], excluded: true, reason: 'safe-tag', shouldHide: false };

    // 1. Safe Exclusions Check (Never hide inputs, passwords, video/audio, form controls)
    if (el.querySelector) {
      if (el.querySelector('video, audio')) {
        return { score: 0, reasons: ['media'], excluded: true, reason: 'media', shouldHide: false };
      }
      if (el.querySelector('input[type="password"], input[type="email"], textarea')) {
        return { score: 0, reasons: ['auth-input'], excluded: true, reason: 'auth-input', shouldHide: false };
      }
      const realInputs = el.querySelectorAll('input, select, textarea');
      if (realInputs && realInputs.length >= 3) {
        return { score: 0, reasons: ['form-fields'], excluded: true, reason: 'form-fields', shouldHide: false };
      }
      const canvas = el.querySelector('canvas');
      if (canvas && canvas.getBoundingClientRect) {
        const cr = canvas.getBoundingClientRect();
        if (cr.width >= 300 && cr.height >= 150) {
          return { score: 0, reasons: ['game-canvas'], excluded: true, reason: 'game-canvas', shouldHide: false };
        }
      }
    }

    // Never hide long readable content (> 450 chars) without ad iframes
    const textContent = (el.textContent || el.innerText || '').trim();
    if (textContent.length > 450) {
      const hasAdIframe =
        el.querySelector &&
        el.querySelector(
          'iframe[src*="doubleclick"], iframe[src*="adservice"], iframe[src*="googlesyndication"]'
        );
      if (!hasAdIframe) {
        return { score: 0, reasons: ['long-readable-content'], excluded: true, reason: 'long-readable-content', shouldHide: false };
      }
    }

    // Never touch YouTube / Twitch UI
    const curH =
      hostName ||
      (typeof window !== 'undefined' && window.location ? window.location.hostname.toLowerCase() : '');
    if (curH.includes('youtube.com') || curH.includes('twitch.tv')) {
      if (
        el.closest &&
        el.closest(
          'ytd-app, ytd-masthead, #player, #movie_player, .video-player, [data-a-target="player-overlay-click-handler"], tp-yt-app-drawer, #guide'
        )
      ) {
        return { score: 0, reasons: ['platform-player'], excluded: true, reason: 'platform-player', shouldHide: false };
      }
    }

    // Never touch player controls or containers
    if (
      el.closest &&
      el.closest(
        'video, audio, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="vjs-"], [class*="jw-"]'
      )
    ) {
      return { score: 0, reasons: ['player-controls'], excluded: true, reason: 'player-controls', shouldHide: false };
    }

    let score = 0;
    const reasons = [];

    const style =
      computedStyle ||
      (typeof window !== 'undefined' && window.getComputedStyle
        ? window.getComputedStyle(el)
        : el.style || {});
    const pos = style.position || '';
    const isFixed = pos === 'fixed';
    const isSticky = pos === 'sticky';
    const isAbsolute = pos === 'absolute';
    const zIndex = parseInt(style.zIndex || '0', 10) || 0;
    const opacity = parseFloat(style.opacity !== undefined ? style.opacity : '1');

    const r =
      rect ||
      (el.getBoundingClientRect
        ? el.getBoundingClientRect()
        : { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
    const w = r.width || 0;
    const h = r.height || 0;

    // Signal 1: Floating / Fixed Positioning (+2 or +3)
    if (isFixed || isSticky) {
      score += 2;
      reasons.push('fixed-or-sticky');
      if (zIndex >= 99999) {
        score += 1;
        reasons.push('max-z-index');
      }
    } else if (zIndex >= 999) {
      score += 2;
      reasons.push('high-z-index');
      if (zIndex >= 99999) {
        score += 1;
        reasons.push('max-z-index');
      }
    }

    // Signal 2: External / Suspicious Target (+3)
    let hasCrossSiteOrAdTarget = false;
    if (el.querySelectorAll) {
      const links = el.querySelectorAll('a[href]');
      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        const href = a.href || '';
        try {
          const u = new URL(
            href,
            typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost'
          );
          if (u.protocol.startsWith('http')) {
            const targetHost = u.hostname.toLowerCase();
            const targetRoot = getRootDomain(targetHost);
            const curRoot = getRootDomain(curH);
            if (curRoot && targetRoot && curRoot !== targetRoot) {
              hasCrossSiteOrAdTarget = true;
              break;
            }
            if (
              /[?&](?:ref|aff|clickid|bannerid|ad_id|out|goto)=/i.test(href) ||
              /\/(?:afu\.php|click\/)/i.test(href)
            ) {
              hasCrossSiteOrAdTarget = true;
              break;
            }
          }
        } catch {}
      }
      if (!hasCrossSiteOrAdTarget) {
        const ifr = el.querySelector('iframe');
        if (ifr) {
          const src = (ifr.src || '').toLowerCase();
          if (
            src.includes('doubleclick') ||
            src.includes('googlesyndication') ||
            src.includes('adservice') ||
            src.includes('popads') ||
            src.includes('propeller') ||
            src.includes('exoclick') ||
            src.includes('adsterra') ||
            src.includes('monetag')
          ) {
            hasCrossSiteOrAdTarget = true;
          }
        }
      }
    }
    if (hasCrossSiteOrAdTarget) {
      score += 3;
      reasons.push('cross-site-or-ad-target');
    }

    // Signal 3: GIF / WebP / Standard IAB Dimension (+3)
    const hasExternalImage = Boolean(
      el.querySelector &&
        el.querySelector('img[src*=".gif"], img[src*=".webp"], [style*=".gif"], [style*=".webp"]')
    );
    const IAB_SIZES = [
      { w: 728, h: 90 },
      { w: 970, h: 90 },
      { w: 970, h: 250 },
      { w: 300, h: 250 },
      { w: 300, h: 600 },
      { w: 160, h: 600 },
      { w: 120, h: 600 },
      { w: 468, h: 60 },
      { w: 320, h: 50 },
      { w: 320, h: 100 }
    ];
    const isIABSize =
      w > 0 && h > 0 && IAB_SIZES.some((s) => Math.abs(w - s.w) <= 8 && Math.abs(h - s.h) <= 8);

    if ((hasExternalImage && (hasCrossSiteOrAdTarget || isFixed || isSticky)) || isIABSize) {
      score += 3;
      reasons.push(isIABSize ? 'iab-dimension' : 'external-image');
    }

    // Signal 4: Pageskin / Wallpaper Sidebar Geometry (+3)
    const winW = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200;
    const isAtSideEdge = r.left <= 30 || r.right >= winW - 30;
    const isPageskinGeometry = (isFixed || isAbsolute) && w > 0 && w <= 280 && h >= 380 && isAtSideEdge;
    if (isPageskinGeometry && (hasCrossSiteOrAdTarget || hasExternalImage)) {
      score += 3;
      reasons.push('pageskin-geometry');
    }

    // Signal 5: Fake Progress / Verification / Push / Close Card (+4)
    const lowerText = textContent.toLowerCase();
    const fakeBaitWords = [
      'robot',
      'doğrula',
      'devam et',
      'dokun',
      'yükleniyor',
      'bildirim',
      'izin ver',
      'verify',
      'continue',
      'tap to',
      'loading',
      'allow',
      'update',
      'tıkla',
      'tamam'
    ];
    const hasBaitWord = fakeBaitWords.some((bw) => lowerText.includes(bw)) || /\b(ok|okay)\b/i.test(lowerText);
    const hasProgressPercent = /\d{1,3}\s*%/i.test(lowerText);
    const hasCloseButton = Boolean(
      el.querySelector &&
        el.querySelector('[class*="close" i], [id*="close" i], [aria-label*="close" i], button')
    );
    const isCornerPushCard =
      (isFixed || isAbsolute) &&
      zIndex >= 1000 &&
      w > 0 &&
      w <= 420 &&
      h > 0 &&
      h <= 260 &&
      (hasBaitWord || hasCrossSiteOrAdTarget);

    if ((hasBaitWord || hasProgressPercent) && (hasCloseButton || isFixed || zIndex >= 999)) {
      score += 4;
      reasons.push('fake-progress-or-bait');
    } else if (isCornerPushCard) {
      score += 4;
      reasons.push('corner-push-card');
    }

    // Signal 6: Invisible Click Curtain (+5)
    const isBigArea = w >= 250 && h >= 150;
    const isTransparent =
      opacity < 0.15 ||
      style.backgroundColor === 'transparent' ||
      style.backgroundColor === 'rgba(0, 0, 0, 0)';
    const isMinimalText = textContent.length < 10;
    if ((isFixed || isAbsolute) && zIndex >= 999 && isBigArea && isMinimalText && isTransparent) {
      score += 5;
      reasons.push('invisible-click-curtain');
    }

    // Signal 7: Obvious Ad Identifier (+3)
    const idStr = (el.id || '').toLowerCase();
    const classStr = (el.className || '').toString().toLowerCase();
    const dataAd = el.getAttribute
      ? el.getAttribute('data-ad') || el.getAttribute('data-adslot') || el.getAttribute('data-ad-client') || ''
      : '';
    const combinedIdent = `${idStr} ${classStr} ${dataAd}`;

    const adWordRegex =
      /\b(reklam|ad-?(slot|box|banner|container|wrap|wrapper|zone|space|placement)?|banner-ad|sponsor-ad|pageskin|popunder|vignette|interstitial|adsbox|adslot)\b/i;
    if (adWordRegex.test(combinedIdent)) {
      const fpRegex = /\b(upload|download|header|loading|shadow|radio|badge|avatar)\b/i;
      if (!fpRegex.test(combinedIdent) || adWordRegex.test(idStr)) {
        score += 3;
        reasons.push('ad-identifier');
      }
    }

    // Signal 8: AX-Brain Online Machine-Learned Inference
    const brain = typeof AxBrain !== 'undefined' ? AxBrain : (typeof window !== 'undefined' ? window.AxBrain : (typeof globalThis !== 'undefined' ? globalThis.AxBrain : null));
    if (brain && brain.extractFeatures && brain.predict && model) {
      try {
        const feat = brain.extractFeatures(el, {
          computedStyle: style,
          rect: r,
          currentHost: curH,
          isLateInjected: Boolean(el.__ax_late_injected)
        });
        const pred = brain.predict(feat, model);
        if (pred && typeof pred.probability === 'number' && pred.probability >= (model.threshold || 0.65)) {
          score = Math.max(score, 5);
          reasons.push('ax-brain-model');
        }
      } catch {}
    }

    return {
      score,
      reasons,
      excluded: false,
      shouldHide: score >= 5
    };
  }

  function nodeSignature(el) {
    return `${el.childElementCount}:${(el.textContent || '').length}:${typeof el.className === 'string' ? el.className : ''}:${el.getAttribute?.('style')?.length || 0}`;
  }

  function hideAdElement(el) {
    try {
      el.setAttribute('data-ax-hidden', '1');
      if (el.style && el.style.setProperty) {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
      el.__ax_scanned_hidden = true;
      unlockBodyOverflow();
    } catch {}
  }

  /** Scores one candidate unless it is unchanged since its last evaluation. Returns true when hidden. */
  function evaluateCandidate(el) {
    if (!el || !el.tagName || AX_SKIP_TAGS.has(el.tagName)) return false;
    if (el.__ax_scanned_hidden || (el.getAttribute && el.getAttribute('data-ax-hidden') === '1')) return false;
    const sig = nodeSignature(el);
    if (evaluatedSignatures.get(el) === sig) return false;
    evaluatedSignatures.set(el, sig);
    const res = evaluateElementAdScore(el, null, null, currentHost);
    if (!res.shouldHide) return false;
    hideAdElement(el);
    return true;
  }

  // Restores page scroll that ad overlays lock (shared by scanner and picker)
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

  /**
   * Safe 3-layer cosmetic filter:
   *   Layer 1: Site-specific CSS selectors from AdGuard Turkish & curated database
   *   Layer 2: General low-false-positive Turkish & global banner CSS selectors
   *   Layer 3: Smart DOM Scanner (debounced MutationObserver) for fixed GIF/WebP banners & invisible click overlays
   */
  async function applyCosmeticFilter() {
    try {
      const response = await chrome.runtime
        .sendMessage({
          type: 'GET_COSMETIC_SELECTORS',
          hostname: currentHost
        })
        .catch(() => null);

      if (!response || !response.success || response.whitelisted || !response.cosmeticFilter) {
        if (response?.whitelisted) {
          try {
            window.sessionStorage.setItem('ax_privacy_popup_shield', 'disabled');
          } catch {}
        }
        return;
      }

      if (response.model) {
        currentBrainModel = response.model;
      }

      if (response.popupShield !== false) {
        try {
          window.sessionStorage.setItem('ax_privacy_popup_shield', 'enabled');
        } catch {}
      }

      const selectors = Array.isArray(response.selectors) ? response.selectors : [];
      const learnedSelectors = Array.isArray(response.learnedSelectors) ? response.learnedSelectors : [];
      if (learnedSelectors.length > 0) {
        const applyLearned = () => {
          try {
            const safe = filterSafeLearnedSelectors(learnedSelectors);
            let learnedStyle = document.getElementById('ax-privacy-learned');
            if (!learnedStyle) {
              learnedStyle = document.createElement('style');
              learnedStyle.id = 'ax-privacy-learned';
              (document.head || document.documentElement).appendChild(learnedStyle);
            }
            learnedStyle.textContent = safe.length
              ? `${safe.join(',\n')} { display: none !important; visibility: hidden !important; pointer-events: none !important; }`
              : '';
          } catch {}
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', applyLearned);
        } else {
          applyLearned();
        }
        // Re-validate once late content has rendered
        window.addEventListener('load', () => setTimeout(applyLearned, 1500));
      }

      // Single injection of unified cosmetic CSS
      const styleId = 'ax-privacy-cosmetic';
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        const target = document.head || document.documentElement;
        if (target) {
          target.appendChild(style);
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            (document.head || document.documentElement).appendChild(style);
          });
        }
      }

      const cssRules = [];
      if (selectors.length > 0) {
        cssRules.push(`
          ${selectors.join(',\n')} {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            min-height: 0 !important;
            pointer-events: none !important;
          }
        `);
      }

      // Collapse blocked empty ad iframe elements
      cssRules.push(`
        [class*="vignette"]:not(main):not(body),
        [id*="vignette"]:not(main):not(body),
        [class*="interstitial"]:not(main):not(body),
        [id*="interstitial"]:not(main):not(body),
        iframe[src="about:blank"][style*="display: none"],
        iframe[style*="display: none"],
        iframe[style*="visibility: hidden"] {
          height: 0 !important;
          min-height: 0 !important;
          display: none !important;
        }
      `);



      style.textContent = cssRules.join('\n');

      // --- Heuristic DOM Scanner for Dynamic Malicious Overlays, GIFs & Pageskins ---
      const IAB_SIZES = [
        { w: 728, h: 90 },
        { w: 300, h: 250 },
        { w: 970, h: 250 },
        { w: 970, h: 90 },
        { w: 160, h: 600 },
        { w: 300, h: 600 },
        { w: 320, h: 50 },
        { w: 320, h: 100 },
        { w: 468, h: 60 }
      ];

      function isMediaOrLegitimateContent(el) {
        if (!el) return true;
        if (el.id === 'ax-privacy-alert-host' || (el.closest && el.closest('#ax-privacy-alert-host'))) {
          return true;
        }
        const tag = el.tagName.toLowerCase();
        if (
          tag === 'video' ||
          tag === 'audio' ||
          tag === 'header' ||
          tag === 'nav' ||
          tag === 'main' ||
          tag === 'article' ||
          tag === 'form' ||
          tag === 'body' ||
          tag === 'html' ||
          tag === 'svg' ||
          tag === 'img' ||
          tag === 'button'
        ) {
          return true;
        }

        // Never touch dialogs, buttons, tooltips, or interactive controls
        if (el.getAttribute) {
          const role = el.getAttribute('role');
          if (
            role === 'dialog' ||
            role === 'button' ||
            role === 'tab' ||
            role === 'menu' ||
            role === 'menuitem' ||
            role === 'tooltip' ||
            el.getAttribute('aria-modal') === 'true'
          ) {
            return true;
          }
        }

        // Never touch video players, seekbars, progress bars, sliders, or any player controls
        if (
          el.closest &&
          el.closest(
            'video, audio, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="vjs-"], [class*="jw-"], [class*="control"], [class*="progress"], [class*="timeline"], [class*="seekbar"], [role="slider"], [role="progressbar"], [aria-label*="play" i], [aria-label*="seek" i], [aria-label*="progress" i]'
          )
        ) {
          return true;
        }

        // Never touch video players or interactive input forms
        if (el.querySelector('video, audio, input, select, textarea, button[type="submit"]')) {
          return true;
        }

        // Never touch player containers
        const className = (el.className || '').toString().toLowerCase();
        const idName = (el.id || '').toLowerCase();
        if (
          className.includes('jwplayer') ||
          className.includes('plyr') ||
          className.includes('video-js') ||
          className.includes('vjs-') ||
          className.includes('player-container') ||
          idName.includes('player')
        ) {
          return true;
        }

        // Never touch site navigation or breadcrumbs
        if (el.closest('nav, header')) {
          return true;
        }

        // Never touch YouTube layout and navigation components
        if (
          (el.closest &&
            el.closest(
              'ytd-guide-renderer, tp-yt-app-drawer, #guide, #sections, ytd-mini-guide-renderer, ytd-app, ytd-masthead'
            )) ||
          (el.matches &&
            el.matches(
              'ytd-guide-renderer, tp-yt-app-drawer, #guide, #sections, ytd-mini-guide-renderer, ytd-app, ytd-masthead'
            ))
        ) {
          return true;
        }

        return false;
      }




      function neutralizeAntiAdblockModals() {
        try {
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
            'pinterest.com'
          ];
          if (MAJOR_SAFE_PLATFORMS.some((p) => currentHost === p || currentHost.endsWith('.' + p))) {
            return;
          }

          const modals = document.querySelectorAll(
            'div, section, aside, [role="dialog"], [class*="modal"], [id*="modal"], [class*="overlay"], [id*="overlay"], [class*="blocker"], [id*="blocker"], [class*="adblock"], [id*="adblock"]'
          );
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
            'turn off your ad blocker',
            'adblocker has been detected'
          ];
          for (let i = 0; i < modals.length; i++) {
            const el = modals[i];
            if (!el || el.__ax_antiadblock_scanned || el.id === 'ax-privacy-alert-host') continue;
            const text = (el.innerText || '').toLowerCase();
            const hasAntiAdblock = antiAdblockPhrases.some((phrase) => text.includes(phrase));
            if (hasAntiAdblock) {
              if (!el.querySelector('input[type="password"]')) {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
                try {
                  el.remove();
                } catch {}
                unlockBodyOverflow();
                el.__ax_antiadblock_scanned = true;
                console.info('[AX-AntiAdBlock] Anti-adblocker duvarı başarıyla kaldırıldı.');
              }
            }
          }
        } catch {}
      }

      function scanForMaliciousOverlaysAndBanners(mutated) {
        try {
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
            'pinterest.com'
          ];
          if (MAJOR_SAFE_PLATFORMS.some((p) => currentHost === p || currentHost.endsWith('.' + p))) {
            return;
          }

          // 1. Build the candidate queue (full document, or only mutated subtrees)
          const queue = [];
          const pushCandidates = (root) => {
            try {
              if (root && root.querySelectorAll) {
                const list = root.querySelectorAll(AX_CANDIDATE_SELECTOR);
                for (let i = 0; i < list.length; i++) queue.push(list[i]);
              }
            } catch {}
          };
          const pushShadow = (host) => {
            try {
              const root =
                host.shadowRoot ||
                (typeof chrome !== 'undefined' && chrome.dom?.openOrClosedShadowRoot
                  ? chrome.dom.openOrClosedShadowRoot(host)
                  : null);
              if (root) pushCandidates(root);
            } catch {}
          };

          if (!mutated) {
            neutralizeAntiAdblockModals();
            pushCandidates(document);
            // 2. Shadow DOM hosts marked by popup-shield's attachShadow hook (open or closed)
            const shadowHosts = document.querySelectorAll('[data-ax-shadow-host]');
            for (let i = 0; i < shadowHosts.length; i++) pushShadow(shadowHosts[i]);
          } else {
            for (const el of mutated.self) {
              if (el.matches && el.matches(AX_CANDIDATE_SELECTOR)) queue.push(el);
            }
            for (const el of mutated.deep) {
              if (el.matches && el.matches(AX_CANDIDATE_SELECTOR)) queue.push(el);
              pushCandidates(el);
              if (el.shadowRoot || el.hasAttribute('data-ax-shadow-host')) pushShadow(el);
            }
          }

          // Process in idle slices of 50 nodes so large pages never jank
          let cursor = 0;
          const runSlice = () => {
            let blockedCount = 0;
            const end = Math.min(cursor + 50, queue.length);
            for (; cursor < end; cursor++) {
              if (evaluateCandidate(queue[cursor])) blockedCount++;
            }
            if (blockedCount > 0) {
              chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED', count: Math.min(blockedCount, 25) }).catch(() => {});
            }
            if (cursor < queue.length) scheduleIdleScan(runSlice);
          };
          runSlice();

          let blockedCount = 0;

          // 3. Collapse empty / blocked ad iframes and empty wrappers
          const iframes = document.querySelectorAll('iframe');
          for (let i = 0; i < iframes.length; i++) {
            const ifr = iframes[i];
            if (!ifr || ifr.__ax_scanned_hidden) continue;
            const src = (ifr.src || '').toLowerCase();
            // Don't touch legitimate player iframes
            if (
              src.includes('youtube') ||
              src.includes('vimeo') ||
              src.includes('twitch') ||
              src.includes('vidmoly') ||
              src.includes('filemoon') ||
              src.includes('dood') ||
              src.includes('streamtape') ||
              src.includes('mixdrop')
            ) {
              continue;
            }
            const isAdSrc =
              src.includes('doubleclick') ||
              src.includes('googlesyndication') ||
              src.includes('adservice') ||
              src.includes('popads') ||
              src.includes('propeller') ||
              src.includes('exoclick') ||
              src.includes('adsterra') ||
              src.includes('monetag') ||
              src.includes('hilltop') ||
              src.includes('clickadu');

            const isBlockedOrEmpty = !src || src === 'about:blank' || isAdSrc;

            if (
              isAdSrc ||
              (isBlockedOrEmpty &&
                ifr.closest &&
                ifr.closest('[class*="ad" i], [id*="ad" i], [class*="banner" i], [class*="reklam" i]'))
            ) {
              ifr.style.setProperty('display', 'none', 'important');
              ifr.style.setProperty('height', '0', 'important');
              ifr.style.setProperty('min-height', '0', 'important');
              ifr.style.setProperty('margin', '0', 'important');
              ifr.style.setProperty('padding', '0', 'important');
              ifr.__ax_scanned_hidden = true;
              blockedCount++;

              // Also collapse empty parent wrapper if it only contained this ad iframe
              const parent = ifr.parentElement;
              if (parent && parent.children.length === 1 && !isMediaOrLegitimateContent(parent)) {
                parent.style.setProperty('display', 'none', 'important');
                parent.style.setProperty('height', '0', 'important');
                parent.style.setProperty('min-height', '0', 'important');
                parent.style.setProperty('margin', '0', 'important');
                parent.style.setProperty('padding', '0', 'important');
              }
            }
          }

          if (blockedCount > 0) {
            chrome.runtime
              .sendMessage({
                type: 'INCREMENT_BLOCKED',
                count: Math.min(blockedCount, 25)
              })
              .catch(() => {});
          }
        } catch {}
      }

      function scheduleIdleScan(fn) {
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          window.requestIdleCallback(fn, { timeout: 100 });
        } else {
          setTimeout(fn, 50);
        }
      }

      // Mutation-driven incremental scans: 200ms debounce, only mutated subtrees, idle slices
      let scanTimer = null;
      let pending = { self: new Set(), deep: new Set() };
      const flushScan = () => {
        scanTimer = null;
        const batch = pending;
        pending = { self: new Set(), deep: new Set() };
        // Very large batches: one full scan is cheaper than thousands of subtree queries
        scheduleIdleScan(() =>
          scanForMaliciousOverlaysAndBanners(batch.self.size + batch.deep.size > 500 ? undefined : batch)
        );
      };
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'childList') {
            if (m.target && m.target.nodeType === 1) pending.self.add(m.target);
            for (const n of m.addedNodes) if (n.nodeType === 1) pending.deep.add(n);
          } else if (m.target && m.target.nodeType === 1) {
            pending.self.add(m.target);
          }
        }
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = setTimeout(flushScan, 200);
      });
      const observerOptions = {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'src', 'href']
      };
      const startObserver = () => {
        if (document.documentElement) observer.observe(document.documentElement, observerOptions);
      };
      if (document.documentElement) {
        startObserver();
      } else {
        document.addEventListener('DOMContentLoaded', startObserver);
      }

      // Follow-up full scans after load (late ad slots, lazy banners)
      const scheduleFollowUps = () => {
        setTimeout(() => scheduleIdleScan(() => scanForMaliciousOverlaysAndBanners()), 800);
        setTimeout(() => scheduleIdleScan(() => scanForMaliciousOverlaysAndBanners()), 2500);
      };
      if (document.readyState === 'complete') {
        scheduleFollowUps();
      } else {
        window.addEventListener('load', scheduleFollowUps);
      }
    } catch {
      // Storage access or context invalidated
    }
  }

  /**
   * Render isolated Security Alert card inside a mode: 'closed' Shadow DOM
   */
  function renderSecurityAlert(alertData) {
    try {
      const existingHost = document.getElementById('ax-privacy-alert-host');
      if (existingHost) {
        existingHost.remove();
      }

      const host = document.createElement('div');
      host.id = 'ax-privacy-alert-host';

      // Inline host isolation styles
      host.style.all = 'initial';
      host.style.position = 'fixed';
      host.style.top = '20px';
      host.style.right = '20px';
      host.style.zIndex = '2147483647';
      host.style.fontFamily =
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      host.style.pointerEvents = 'auto';

      // Attach closed Shadow DOM for absolute CSS and DOM isolation
      const shadow = host.attachShadow({ mode: 'closed' });

      const isDanger = alertData.level === 'danger';
      const accentColor = isDanger ? '#ef4444' : '#f59e0b';
      const badgeText = isDanger ? 'TEHLİKE UYARISI' : 'GÜVENLİK DİKKAT';
      const badgeBg = isDanger ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)';

      const container = document.createElement('div');
      container.className = 'ax-alert-card';

      const style = document.createElement('style');
      style.textContent = `
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        .ax-alert-card {
          width: 360px;
          max-width: calc(100vw - 40px);
          background-color: #0b1120;
          color: #f8fafc;
          border: 1px solid ${accentColor};
          border-radius: 12px;
          box-shadow: 0 16px 36px -8px rgba(0, 0, 0, 0.7), 0 0 20px -3px ${accentColor}40;
          overflow: hidden;
          animation: ax-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          font-family: inherit;
        }
        @keyframes ax-slide-in {
          from {
            transform: translateY(-20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .ax-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background-color: rgba(255, 255, 255, 0.03);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .ax-brand-tag {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.5px;
          color: #94a3b8;
          text-transform: uppercase;
        }
        .ax-status-pill {
          background-color: ${badgeBg};
          color: ${accentColor};
          font-size: 10px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 9999px;
          letter-spacing: 0.5px;
          border: 1px solid ${accentColor}55;
        }
        .ax-card-body {
          padding: 16px;
        }
        .ax-title-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 8px;
        }
        .ax-icon {
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          color: ${accentColor};
          margin-top: 2px;
        }
        .ax-title {
          font-size: 14px;
          font-weight: 700;
          line-height: 1.3;
          color: #f8fafc;
        }
        .ax-message {
          font-size: 12px;
          line-height: 1.5;
          color: #cbd5e1;
          margin-bottom: 12px;
        }
        .ax-domain-box {
          display: inline-block;
          font-size: 11px;
          font-family: monospace;
          background-color: #1e293b;
          color: #38bdf8;
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          margin-bottom: 14px;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ax-actions {
          display: flex;
          gap: 8px;
        }
        .ax-btn {
          flex: 1;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
          text-align: center;
        }
        .ax-btn-back {
          background-color: ${accentColor};
          color: #ffffff;
        }
        .ax-btn-back:hover {
          filter: brightness(1.1);
        }
        .ax-btn-dismiss {
          background-color: #1e293b;
          color: #94a3b8;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .ax-btn-dismiss:hover {
          background-color: #334155;
          color: #f8fafc;
        }
      `;

      // Built with DOM APIs: alert text is set via textContent only
      const mk = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
      };
      const header = mk('div', 'ax-card-header');
      const brand = mk('div', 'ax-brand-tag');
      brand.appendChild(mk('span', '', '🛡️ AX-Privacy'));
      header.append(brand, mk('span', 'ax-status-pill', badgeText));
      const body = mk('div', 'ax-card-body');
      const titleRow = mk('div', 'ax-title-row');
      const SVG_NS = 'http://www.w3.org/2000/svg';
      const icon = document.createElementNS(SVG_NS, 'svg');
      icon.setAttribute('class', 'ax-icon');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2');
      const iconPath = document.createElementNS(SVG_NS, 'path');
      iconPath.setAttribute('stroke-linecap', 'round');
      iconPath.setAttribute('stroke-linejoin', 'round');
      iconPath.setAttribute(
        'd',
        'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z'
      );
      icon.appendChild(iconPath);
      titleRow.append(icon, mk('div', 'ax-title', alertData.title || 'Güvenlik Uyarısı'));
      const actions = mk('div', 'ax-actions');
      const backButton = mk('button', 'ax-btn ax-btn-back', 'Güvenliğe Dön');
      backButton.id = 'ax-back-btn';
      const dismissButton = mk('button', 'ax-btn ax-btn-dismiss', 'Riski Anladım');
      dismissButton.id = 'ax-dismiss-btn';
      actions.append(backButton, dismissButton);
      body.append(
        titleRow,
        mk('p', 'ax-message', alertData.message || 'Şüpheli aktivite algılandı.'),
        mk('div', 'ax-domain-box', alertData.domain || currentHost),
        actions
      );
      container.append(header, body);

      shadow.appendChild(style);
      shadow.appendChild(container);

      // Event handlers
      const dismissBtn = shadow.getElementById('ax-dismiss-btn');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          host.remove();
        });
      }

      const backBtn = shadow.getElementById('ax-back-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.href = 'about:blank';
          }
        });
      }

      const target = document.body || document.documentElement;
      target.appendChild(host);
    } catch {
      // Suppress UI insertion errors
    }
  }

  /**
   * ============================================================================
   * AX-Brain: Interactive Ad Picker ("Reklamı Seç ve Öğret")
   * ============================================================================
   */

  const SAFE_IDENT = /^[a-zA-Z_-][a-zA-Z0-9_-]*$/;
  const STRUCTURAL_TAGS = new Set(['html', 'body', 'main', 'article', 'header', 'nav', 'footer']);

  /**
   * Builds a selector that matches ONLY the picked element (verified with querySelectorAll).
   * Returns '' when no unique selector exists; the element is then hidden once but no rule is saved.
   */
  function deriveSelector(el) {
    if (!el || !el.tagName) return '';
    const unique = (sel) => {
      try {
        return document.querySelectorAll(sel).length === 1;
      } catch {
        return false;
      }
    };
    if (el.id && SAFE_IDENT.test(el.id) && unique(`#${el.id}`)) return `#${el.id}`;

    const parts = [];
    let node = el;
    for (let depth = 0; node && node.tagName && depth < 6; depth++) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') break;
      if (node !== el && node.id && SAFE_IDENT.test(node.id)) {
        parts.unshift(`#${node.id}`);
        const sel = parts.join(' > ');
        return unique(sel) ? sel : '';
      }
      let part = tag;
      const classes = Array.from(node.classList || []).filter((cl) => SAFE_IDENT.test(cl)).slice(0, 2);
      if (classes.length > 0) part += `.${classes.join('.')}`;
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((ch) => ch.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(' > ');
      if (unique(sel)) return sel;
      node = parent;
    }
    return '';
  }

  /** True when hiding this element would blank the page (layout wrappers, structural tags, our UI). */
  function isPageLevelElement(el) {
    if (!el || !el.tagName) return true;
    if (STRUCTURAL_TAGS.has(el.tagName.toLowerCase())) return true;
    if (el.closest && el.closest(AX_NEVER_TOUCH_SELECTOR + ', #ax-privacy-toast-host')) return true;
    try {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const style = window.getComputedStyle(el);
      const floating = style.position === 'fixed' || style.position === 'sticky';
      // A non-floating box at least as large as the viewport is page layout, not an ad
      if (!floating && r.width >= vw * 0.9 && r.height >= vh * 0.9) return true;
    } catch {}
    return false;
  }

  /** Learned (picker) selectors are only applied when they hit a few, non page-level elements. */
  function filterSafeLearnedSelectors(list) {
    const out = [];
    for (const sel of Array.isArray(list) ? list : []) {
      try {
        const found = document.querySelectorAll(sel);
        if (found.length > 5) continue;
        if (Array.from(found).some(isPageLevelElement)) continue;
        out.push(sel);
      } catch {}
    }
    return out;
  }

  let isPickerActive = false;
  let pickerOverlay = null;
  let hoveredTarget = null;

  function createPickerOverlay() {
    if (pickerOverlay && pickerOverlay.parentNode) return pickerOverlay;
    pickerOverlay = document.createElement('div');
    pickerOverlay.id = 'ax-privacy-picker-overlay';
    pickerOverlay.style.cssText =
      'position: fixed; pointer-events: none; z-index: 2147483646; border: 2px dashed #0284c7; background: rgba(2, 132, 199, 0.18); border-radius: 4px; box-sizing: border-box; display: none; transition: top 0.05s ease, left 0.05s ease, width 0.05s ease, height 0.05s ease;';
    (document.body || document.documentElement).appendChild(pickerOverlay);
    return pickerOverlay;
  }

  function updatePickerOverlay(el) {
    if (!el || !pickerOverlay) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      pickerOverlay.style.display = 'none';
      return;
    }
    pickerOverlay.style.display = 'block';
    pickerOverlay.style.top = `${r.top}px`;
    pickerOverlay.style.left = `${r.left}px`;
    pickerOverlay.style.width = `${r.width}px`;
    pickerOverlay.style.height = `${r.height}px`;
  }

  function onPickerPointerMove(e) {
    if (!isPickerActive) return;
    const target = e.target;
    if (!target || target === pickerOverlay || target.id === 'ax-privacy-picker-overlay' || target.closest?.('#ax-privacy-toast-host, #ax-privacy-alert-host')) {
      return;
    }
    hoveredTarget = target;
    updatePickerOverlay(target);
  }

  function onPickerClick(e) {
    if (!isPickerActive) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = hoveredTarget || e.target;
    if (!target) {
      stopAdPicker();
      return;
    }

    if (isPageLevelElement(target)) {
      // Picking a layout wrapper would hide the whole site; ignore the click and keep the picker open
      return;
    }

    const sel = deriveSelector(target);
    const brain = typeof AxBrain !== 'undefined' ? AxBrain : (typeof window !== 'undefined' ? window.AxBrain : (typeof globalThis !== 'undefined' ? globalThis.AxBrain : null));
    const features = brain?.extractFeatures ? brain.extractFeatures(target, { currentHost }) : [];

    // Hide target element immediately
    target.style.setProperty('display', 'none', 'important');
    target.style.setProperty('visibility', 'hidden', 'important');
    target.style.setProperty('pointer-events', 'none', 'important');

    // Send training signal to AX-Brain (label: 1)
    if (chrome.runtime?.sendMessage) {
      chrome.runtime
        .sendMessage({
          type: 'AX_BRAIN_TRAIN',
          features,
          label: 1,
          selector: sel,
          host: currentHost
        })
        .catch(() => {});
    }

    stopAdPicker();
    showPickerUndoToast(target, sel, features);
  }

  function onPickerKeyDown(e) {
    if (e.key === 'Escape' && isPickerActive) {
      stopAdPicker();
    }
  }

  function startAdPicker() {
    if (isPickerActive) return;
    isPickerActive = true;
    createPickerOverlay();
    window.addEventListener('pointermove', onPickerPointerMove, true);
    window.addEventListener('click', onPickerClick, true);
    window.addEventListener('keydown', onPickerKeyDown, true);
    if (document.documentElement) {
      document.documentElement.style.cursor = 'crosshair';
    }
  }

  function stopAdPicker() {
    if (!isPickerActive) return;
    isPickerActive = false;
    hoveredTarget = null;
    if (pickerOverlay) {
      pickerOverlay.style.display = 'none';
    }
    window.removeEventListener('pointermove', onPickerPointerMove, true);
    window.removeEventListener('click', onPickerClick, true);
    window.removeEventListener('keydown', onPickerKeyDown, true);
    if (document.documentElement) {
      document.documentElement.style.removeProperty('cursor');
    }
  }

  function showPickerUndoToast(targetEl, sel, features) {
    try {
      const existing = document.getElementById('ax-privacy-toast-host');
      if (existing) existing.remove();

      const host = document.createElement('div');
      host.id = 'ax-privacy-toast-host';
      host.style.all = 'initial';
      host.style.position = 'fixed';
      host.style.bottom = '24px';
      host.style.right = '24px';
      host.style.zIndex = '2147483647';
      host.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      const shadow = host.attachShadow({ mode: 'closed' });
      const wrap = document.createElement('div');
      wrap.style.cssText =
        'display: flex; align-items: center; gap: 12px; background: #0b1120; color: #f8fafc; border: 1px solid #0284c7; padding: 12px 18px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); font-size: 13px;';

      const msg = document.createElement('span');
      msg.textContent = "Reklam gizlendi ve AX-Brain'e öğretildi.";

      const undoBtn = document.createElement('button');
      undoBtn.textContent = 'Geri Al';
      undoBtn.style.cssText =
        'background: #0284c7; color: #ffffff; border: none; padding: 5px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px;';

      let autoRemoveTimer = null;

      undoBtn.addEventListener('click', () => {
        if (autoRemoveTimer) clearTimeout(autoRemoveTimer);
        if (targetEl) {
          targetEl.style.removeProperty('display');
          targetEl.style.removeProperty('visibility');
          targetEl.style.removeProperty('pointer-events');
        }
        if (chrome.runtime?.sendMessage) {
          chrome.runtime
            .sendMessage({
              type: 'AX_BRAIN_TRAIN',
              features,
              label: 0,
              selector: sel,
              host: currentHost
            })
            .catch(() => {});
        }
        host.remove();
      });

      wrap.appendChild(msg);
      wrap.appendChild(undoBtn);
      shadow.appendChild(wrap);
      const target = document.body || document.documentElement;
      if (target) target.appendChild(host);

      autoRemoveTimer = setTimeout(() => {
        try {
          host.remove();
        } catch {}
      }, 6000);
    } catch {}
  }

  // Listen for security alert & picker messages from background or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message?.type === 'AX_SECURITY_ALERT') {
        renderSecurityAlert(message);
        sendResponse({ success: true });
        return true;
      }
      if (message?.type === 'AX_START_PICKER') {
        startAdPicker();
        sendResponse({ success: true });
        return true;
      }
    } catch {
      // Suppress
    }
    return false;
  });

  // Apply safe cosmetic filters immediately
  applyCosmeticFilter();

  /**
   * Twitch Shield bridge: synchronizes extension settings with page-level localStorage
   * for the MAIN world twitch-shield.js script
   */
  async function syncTwitchShieldBridge() {
    if (!currentHost.includes('twitch.tv')) return;
    try {
      const data = await chrome.storage.local.get(['twitchShield', 'twitchProxyUrl', 'whitelist']);
      const isEnabled = data.twitchShield !== undefined ? data.twitchShield : true;
      const proxyUrl = typeof data.twitchProxyUrl === 'string' ? data.twitchProxyUrl.trim() : '';
      const whitelist = data.whitelist || [];
      const isWhitelisted = whitelist.some(
        (w) => currentHost === w || currentHost.endsWith('.' + w)
      );

      const targetValue = !isEnabled || isWhitelisted ? 'disabled' : 'enabled';
      const prevValue = window.localStorage.getItem('ax_privacy_twitch_shield');

      if (prevValue !== targetValue) {
        window.localStorage.setItem('ax_privacy_twitch_shield', targetValue);
      }

      const prevProxy = window.localStorage.getItem('ax_privacy_twitch_proxy');
      if (prevProxy !== proxyUrl) {
        window.localStorage.setItem('ax_privacy_twitch_proxy', proxyUrl);
      }
    } catch {
      // Suppress
    }
  }

  // Sync Twitch shield bridge immediately on twitch.tv
  syncTwitchShieldBridge();

  /**
   * YouTube Shield bridge: synchronizes extension settings with page-level localStorage
   * for the MAIN world youtube-shield.js script
   */
  async function syncYouTubeShieldBridge() {
    if (!currentHost.includes('youtube.com')) return;
    try {
      const data = await chrome.storage.local.get(['youtubeShield', 'whitelist']);
      const isEnabled = data.youtubeShield !== undefined ? data.youtubeShield : true;
      const whitelist = data.whitelist || [];
      const isWhitelisted = whitelist.some(
        (w) => currentHost === w || currentHost.endsWith('.' + w)
      );

      const targetValue = !isEnabled || isWhitelisted ? 'disabled' : 'enabled';
      const prevValue = window.localStorage.getItem('ax_privacy_youtube_shield');

      if (prevValue !== targetValue) {
        window.localStorage.setItem('ax_privacy_youtube_shield', targetValue);
      }
    } catch {
      // Suppress
    }
  }

  // Sync YouTube shield bridge immediately on youtube.com
  syncYouTubeShieldBridge();

  /**
   * Pop-up & Redirect Shield bridge: synchronizes extension settings with page-level sessionStorage
   * for the MAIN world popup-shield.js script
   */
  async function syncPopupShieldBridge() {
    try {
      const data = await chrome.storage.local.get(['popupShield', 'whitelist']);
      const isEnabled = data.popupShield !== undefined ? data.popupShield : true;
      const whitelist = data.whitelist || [];
      const isWhitelisted = whitelist.some(
        (w) => currentHost === w || currentHost.endsWith('.' + w)
      );

      const targetValue = !isEnabled || isWhitelisted ? 'disabled' : 'enabled';
      const prevValue = window.sessionStorage.getItem('ax_privacy_popup_shield');

      if (prevValue !== targetValue) {
        window.sessionStorage.setItem('ax_privacy_popup_shield', targetValue);
      }
    } catch {
      // Suppress
    }
  }

  // Track newly added anchors to detect traps injected in the last 600ms
  const recentContentAnchors = new WeakMap();
  try {
    const anchorObserver = new MutationObserver((mutations) => {
      const now = Date.now();
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const node = added[j];
          if (node && node.nodeType === 1) {
            if (node.tagName === 'A') recentContentAnchors.set(node, now);
            const subAnchors = node.querySelectorAll ? node.querySelectorAll('a') : [];
            for (let k = 0; k < subAnchors.length; k++) {
              recentContentAnchors.set(subAnchors[k], now);
            }
          }
        }
      }
    });
    if (document.documentElement) {
      anchorObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch {}

  function handleTrustedPointerOrClick(e) {
    if (!e || e.isTrusted !== true) return;
    try {
      const isMiddleClick = e.button === 1;
      const hasModifier = Boolean(e.ctrlKey || e.metaKey);
      const sourceHost = (window.location.hostname || '').toLowerCase();
      const sourceRoot = getRootDomain(sourceHost);

      const target = e.target;
      const anchor = target && target instanceof Element ? target.closest('a[href]') : null;

      let href = '';
      let targetHost = '';
      let targetRoot = '';

      if (anchor && anchor.href) {
        const rawHref = anchor.href.trim();
        if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
          href = rawHref;
          try {
            const u = new URL(rawHref);
            targetHost = u.hostname.toLowerCase();
            targetRoot = getRootDomain(targetHost);
          } catch {}
        }
      }

      // 1. Mouse wheel / middle-click immediate intent dispatch (fire-and-forget)
      if (isMiddleClick) {
        chrome.runtime
          .sendMessage({
            type: 'AX_MIDDLE_CLICK_INTENT',
            ts: Date.now(),
            sourceHost,
            sourceRoot,
            targetHost,
            targetRoot,
            href
          })
          .catch(() => {});
      }

      if (!anchor || !href || !targetHost) return;

      // Check intent to open a new tab vs same-tab navigation
      const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
      const isNewTabIntent = targetAttr === '_blank' || isMiddleClick || hasModifier;

      // Physical visibility & dimension check (supports inline elements and display: contents)
      let rect = anchor.getBoundingClientRect();
      if ((rect.width <= 0 || rect.height <= 0) && target.getBoundingClientRect) {
        rect = target.getBoundingClientRect();
      }

      // Check if text or media exists inside anchor
      const textLen = (anchor.innerText || '').trim().length;
      const hasMedia = Boolean(anchor.querySelector('img, svg, canvas, video'));

      if (rect.width <= 0 || rect.height <= 0) {
        if (!textLen && !hasMedia) return;
      }

      // Brave-style strict popup trap defense in content.js:
      const isPlainLeftClick = e.button === 0 && !hasModifier;
      const isBlank = targetAttr === '_blank';
      const isCrossSite = sourceRoot && targetRoot && sourceRoot !== targetRoot;
      if (isPlainLeftClick && isBlank && isCrossSite) {
        const now = Date.now();
        if (recentContentAnchors.has(anchor) && now - recentContentAnchors.get(anchor) < 400) {
          return;
        }
        if (
          target.closest &&
          target.closest(
            'video, audio, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="vjs-"], [class*="jw-"]'
          )
        ) {
          return;
        }
      }

      // Trap protection: Only reject dynamic injection if element has NO visible text/media
      if (recentContentAnchors.has(anchor)) {
        const addedAt = recentContentAnchors.get(anchor);
        if (Date.now() - addedAt < 600 && textLen === 0 && !hasMedia) return;
      }

      let style;
      try {
        style = window.getComputedStyle(anchor);
      } catch {
        return;
      }

      if (style.display === 'none' || style.visibility === 'hidden') return;
      const opacity = parseFloat(style.opacity);
      if (opacity < 0.15 && textLen === 0 && !hasMedia) return;

      // Must not cover the entire screen (transparent curtain traps)
      if (rect.width > 0 && rect.height > 0) {
        const wRatio = rect.width / (window.innerWidth || 1);
        const hRatio = rect.height / (window.innerHeight || 1);
        if (wRatio >= 0.7 && hRatio >= 0.7 && opacity < 0.15 && textLen === 0 && !hasMedia) return;
      }

      const now = Date.now();
      chrome.runtime
        .sendMessage({
          type: isNewTabIntent ? 'AX_TRUSTED_NEW_TAB' : 'AX_TRUSTED_NAV',
          targetHost,
          targetRoot,
          sourceHost,
          sourceRoot,
          href,
          button: e.button,
          isMiddleClick,
          isNewTabIntent,
          time: now,
          ts: now
        })
        .catch(() => {});
    } catch {}
  }

  // Hook all pointer and click phases to guarantee ultra-early delivery before tab creation
  window.addEventListener('pointerdown', handleTrustedPointerOrClick, true);
  window.addEventListener('mousedown', handleTrustedPointerOrClick, true);
  window.addEventListener('click', handleTrustedPointerOrClick, true);
  window.addEventListener('auxclick', handleTrustedPointerOrClick, true);

  // Sync popup shield bridge across all origins
  syncPopupShieldBridge();

  // Listen to pop-up shield blocked events dispatched from MAIN world popup-shield.js
  window.addEventListener('message', (event) => {
    try {
      if (event.data && event.data.type === 'AX_POPUP_BLOCKED') {
        chrome.runtime
          .sendMessage({
            type: 'INCREMENT_BLOCKED',
            count: 1
          })
          .catch(() => {});

        let blockedHost = event.data.targetHost;
        if (!blockedHost && event.data.url) {
          try {
            blockedHost = new URL(event.data.url).hostname;
          } catch {}
        }
        if (blockedHost) {
          chrome.runtime
            .sendMessage({
              type: 'AX_BRAIN_REPORT_THREAT',
              domain: blockedHost,
              sourceHost: currentHost,
              reason: event.data.reason || 'popup_shield_blocked',
              url: event.data.url || ''
            })
            .catch(() => {});
        }
      }
    } catch {}
  });

  // Listen for storage changes to sync Twitch, YouTube & Pop-up shields in real time
  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.twitchShield || changes.whitelist || changes.twitchProxyUrl) {
          syncTwitchShieldBridge();
        }
        if (changes.youtubeShield || changes.whitelist) {
          syncYouTubeShieldBridge();
        }
        if (changes.popupShield || changes.whitelist) {
          syncPopupShieldBridge();
        }
      }
    });
  }

  // Export for unit tests
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      evaluateElementAdScore,
      evaluateCandidate,
      nodeSignature,
      getRootDomain,
      deriveSelector,
      isPageLevelElement,
      filterSafeLearnedSelectors,
      startAdPicker,
      stopAdPicker
    };
  }
})();
