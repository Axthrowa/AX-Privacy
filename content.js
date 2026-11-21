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

      if (response.popupShield !== false) {
        try {
          window.sessionStorage.setItem('ax_privacy_popup_shield', 'enabled');
        } catch {}
      }

      const selectors = Array.isArray(response.selectors) ? response.selectors : [];

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

      // Universal HTML5 Video & Media Player Controls Protection
      cssRules.push(`
        video,
        audio,
        .video-js,
        .video-js *,
        .jwplayer,
        .jwplayer *,
        .plyr,
        .plyr *,
        .dplayer,
        .dplayer *,
        .artplayer-app,
        .artplayer-app *,
        [class*="player"] [class*="control"],
        [class*="player"] [class*="control"] *,
        [class*="player"] [class*="progress"],
        [class*="player"] [class*="progress"] *,
        [class*="player"] [class*="slider"],
        [class*="player"] [class*="slider"] *,
        [class*="player"] [class*="timeline"],
        [class*="player"] [class*="timeline"] *,
        [class*="player"] [class*="seekbar"],
        [class*="player"] [class*="seekbar"] *,
        [class*="player"] [class*="fullscreen"],
        [class*="player"] [class*="fullscreen"] *,
        [class*="player"] [class*="volume"],
        [class*="player"] [class*="volume"] *,
        [class*="player"] button,
        [class*="player"] [role="button"],
        [class*="player"] [role="slider"],
        [class*="player"] [role="progressbar"],
        .video-player__default-player,
        .video-player__default-player *,
        [data-a-target="player-play-pause-button"],
        [data-a-target="player-fullscreen-button"],
        [data-a-target="player-settings-button"],
        [data-a-target="player-settings-menu"],
        [data-a-target="player-overlay-click-handler"] {
          pointer-events: auto !important;
        }
      `);

      if (currentHost.includes('youtube.com')) {
        cssRules.push(`
          ytd-guide-renderer,
          tp-yt-app-drawer,
          #guide,
          #sections,
          ytd-mini-guide-renderer {
            visibility: visible !important;
          }
          .html5-video-player .ytp-chrome-bottom,
          .html5-video-player .ytp-chrome-bottom *,
          .html5-video-player.ad-showing .ytp-chrome-bottom,
          .html5-video-player.ad-showing .ytp-chrome-bottom *,
          .ytp-play-button,
          .ytp-fullscreen-button,
          .ytp-volume-area,
          .ytp-volume-panel,
          .ytp-volume-slider,
          .ytp-mute-button,
          .ytp-settings-button,
          .ytp-progress-bar-container,
          .ytp-progress-bar,
          .ytp-progress-bar * {
            opacity: 1 !important;
            pointer-events: auto !important;
            visibility: visible !important;
          }
        `);
      }

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

      function defuseVideoPlayerClickTraps() {
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

          const videos = document.querySelectorAll('video');
          if (!videos || videos.length === 0) return;

          for (let v = 0; v < videos.length; v++) {
            const video = videos[v];
            const vRect = video.getBoundingClientRect();
            if (vRect.width < 80 || vRect.height < 80) continue;

            const playerContainer =
              (video.closest &&
                video.closest(
                  '.video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="vjs-"], [class*="jw-"]'
                )) ||
              video.parentElement;
            if (!playerContainer) continue;

            const overlays = playerContainer.querySelectorAll('div, span, a');
            for (let o = 0; o < overlays.length; o++) {
              const el = overlays[o];
              if (el === video || el.contains(video)) continue;

              // Never touch legitimate controls, buttons, or overlay containers housing controls
              const isControl = Boolean(
                (el.matches &&
                  el.matches(
                    '[class*="control"], [class*="progress"], [class*="slider"], [class*="rail"], [class*="timeline"], [class*="seekbar"], [role="slider"], [role="progressbar"], button, input, [aria-label*="play" i], [aria-label*="seek" i]'
                  )) ||
                  (el.closest &&
                    el.closest(
                      '[class*="control"], [class*="progress"], [class*="slider"], [class*="rail"], [class*="timeline"], [class*="seekbar"], [role="slider"], [role="progressbar"], button, input, .video-player, [data-a-target*="player"]'
                    )) ||
                  el.querySelector(
                    'button, [role="button"], [role="slider"], input, select, textarea, [class*="control"], [class*="progress"], [data-a-target*="button"], [data-a-target*="player"]'
                  )
              );
              if (isControl) continue;

              let style;
              try {
                style = window.getComputedStyle(el);
              } catch {
                continue;
              }
              const pos = style.position;
              if (pos !== 'absolute' && pos !== 'fixed') continue;

              const zIndex = parseInt(style.zIndex, 10);
              if (zIndex < 1) continue;

              const oRect = el.getBoundingClientRect();
              const isCoveringPlayer =
                oRect.width >= vRect.width * 0.6 && oRect.height >= vRect.height * 0.6;

              if (isCoveringPlayer) {
                // Must be an actual ad or external link trap; never disable pure UI overlays
                const hasAdOrLink = el.tagName === 'A' || Boolean(el.querySelector('a[href^="http"], a[target="_blank"]'));
                if (hasAdOrLink) {
                  const containsControls = Boolean(
                    el.querySelector('video, audio, button, [role="button"], [role="slider"], [class*="control"]')
                  );
                  if (!containsControls) {
                    el.style.setProperty('pointer-events', 'none', 'important');
                  }
                  if (el.tagName === 'A') {
                    el.removeAttribute('href');
                    el.removeAttribute('target');
                    el.onclick = (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                    };
                  }
                  const innerLinks = el.querySelectorAll('a[href]');
                  for (let l = 0; l < innerLinks.length; l++) {
                    innerLinks[l].removeAttribute('href');
                    innerLinks[l].removeAttribute('target');
                    innerLinks[l].onclick = (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                    };
                  }
                }
              }
            }
          }
        } catch {}
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

      function scanForMaliciousOverlaysAndBanners() {
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

          defuseVideoPlayerClickTraps();
          neutralizeAntiAdblockModals();
          const candidates = document.querySelectorAll(
            'div, section, aside, span, a, [id*="overlay"], [class*="overlay"], [id*="banner"], [class*="banner"], [id*="reklam"], [class*="reklam"]'
          );

          let blockedCount = 0;

          for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (!el || el.__ax_scanned_hidden) continue;

            if (isMediaOrLegitimateContent(el)) continue;

            let styleObj;
            try {
              styleObj = window.getComputedStyle(el);
            } catch {
              continue;
            }

            if (!styleObj || styleObj.display === 'none' || styleObj.visibility === 'hidden') {
              continue;
            }

            const position = styleObj.position;
            const isFixedOrSticky = position === 'fixed' || position === 'sticky';
            const isAbsoluteOrFixed = position === 'fixed' || position === 'absolute';

            const adMeta = (el.id + ' ' + (el.className || '')).toLowerCase();
            const hasAdKeywords =
              adMeta.includes('reklam') ||
              adMeta.includes('banner') ||
              adMeta.includes('bahis') ||
              adMeta.includes('bet') ||
              adMeta.includes('casino') ||
              adMeta.includes('sponsor');

            // Determine if the element links to an actual external domain (exclude same-site and relative URLs)
            let hasActualExternalLink = false;
            const linkList = el.querySelectorAll('a[href]');
            for (let aIdx = 0; aIdx < linkList.length; aIdx++) {
              try {
                const u = new URL(linkList[aIdx].href, window.location.href);
                if (u.protocol.startsWith('http')) {
                  const targetHost = u.hostname.replace(/^www\./, '');
                  const curHost = window.location.hostname.replace(/^www\./, '');
                  if (targetHost && targetHost !== curHost && !targetHost.endsWith('.' + curHost) && !curHost.endsWith('.' + targetHost)) {
                    hasActualExternalLink = true;
                    break;
                  }
                }
              } catch {}
            }

            // Only animated GIFs count as potential ad banners; WebP is a standard modern image format
            const hasGifBanner = Boolean(
              el.querySelector('img[src*=".gif"], [style*=".gif"]')
            );

            // Never hide elements that contain article headings or series titles (legitimate content cards)
            const hasHeadingOrTitle = Boolean(
              el.querySelector('h1, h2, h3, h4, h5, h6, time, [class*="title" i], [class*="episode" i], [class*="season" i]')
            );
            if (hasHeadingOrTitle) {
              continue;
            }

            // Pattern 1: Fixed / Sticky Floating GIF & Betting Banners
            if (isFixedOrSticky && (hasActualExternalLink || hasAdKeywords) && (hasGifBanner || hasAdKeywords)) {
              el.style.setProperty('display', 'none', 'important');
              el.style.setProperty('pointer-events', 'none', 'important');
              el.__ax_scanned_hidden = true;
              blockedCount++;
              continue;
            }

            const rect = el.getBoundingClientRect();

            // Pattern 2: Standard IAB Ad Dimensions (Must be an actual ad, not a regular content card!)
            if (rect.width > 0 && rect.height > 0 && (hasAdKeywords || (hasActualExternalLink && hasGifBanner) || el.querySelector('iframe[src*="ad"]'))) {
              const matchesIAB = IAB_SIZES.some(
                (size) => Math.abs(rect.width - size.w) <= 4 && Math.abs(rect.height - size.h) <= 4
              );
              if (matchesIAB) {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
                el.__ax_scanned_hidden = true;
                blockedCount++;
                continue;
              }
            }

            // Pattern 3: Pageskin / Wallpaper Sidebars
            if (isAbsoluteOrFixed && rect.width > 40 && rect.width <= 260 && rect.height >= 400) {
              const isAtEdge = rect.left <= 25 || rect.right >= (window.innerWidth || 1200) - 25;
              if (isAtEdge && (hasAdKeywords || (hasActualExternalLink && hasGifBanner))) {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
                el.__ax_scanned_hidden = true;
                blockedCount++;
                continue;
              }
            }

            // Pattern 4: Vignette / Interstitial / Fake Loading Trap
            if (isAbsoluteOrFixed) {
              const zIndex = parseInt(styleObj.zIndex, 10);
              if (zIndex >= 99999 || zIndex >= 2147483000) {
                const baitPhrases = [
                  'devam etmek için dokunun',
                  'devam etmek için tıklayın',
                  'tap to continue',
                  'click to continue',
                  'press allow',
                  'bildirimlere izin ver'
                ];
                const text = (el.innerText || '').trim();
                const lowerText = text.toLowerCase();
                const hasBait = baitPhrases.some((b) => lowerText.includes(b));
                const hasProgress =
                  /\d{1,3}\s*%/i.test(text) &&
                  (lowerText.includes('yükleniyor') || lowerText.includes('loading') || lowerText.includes('dokunun') || lowerText.includes('continue'));

                if ((hasBait || hasProgress) && !el.querySelector('input, select, textarea, video')) {
                  el.remove();
                  unlockBodyOverflow();
                  console.info('[AX-Vignette] Reklam katmanı temizlendi');
                  blockedCount++;
                  continue;
                }
              }

              // Pattern 5: Floating Corner Badges / Fake Corner Widgets (<= 90x90px)
              if (zIndex >= 1000 && rect.width >= 10 && rect.width <= 90 && rect.height >= 10 && rect.height <= 90) {
                const winW = window.innerWidth || 1000;
                const winH = window.innerHeight || 800;
                const isTopEdge = rect.top <= 40;
                const isBottomEdge = rect.bottom >= winH - 40;
                const isLeftEdge = rect.left <= 40;
                const isRightEdge = rect.right >= winW - 40;
                const isCorner = (isTopEdge || isBottomEdge) && (isLeftEdge || isRightEdge);

                if (isCorner) {
                  const isSafeControl =
                    (el.closest && el.closest('nav, header, footer, aside, .chat, [role="navigation"]')) ||
                    (el.matches &&
                      el.matches(
                        '[aria-label*="chat" i], [aria-label*="scroll" i], [class*="scroll-to-top" i], [class*="back-to-top" i], [id*="scroll-to-top" i], [id*="back-to-top" i]'
                      )) ||
                    el.querySelector('input, select, textarea, video, audio, form');

                  if (!isSafeControl && (hasAdKeywords || (hasActualExternalLink && (hasGifBanner || el.querySelector('iframe'))))) {
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                    el.__ax_scanned_hidden = true;
                    blockedCount++;
                    continue;
                  }
                }
              }
            }
          }

          // Collapse empty / blocked ad iframes
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
            if (
              src.includes('doubleclick') ||
              src.includes('googlesyndication') ||
              src.includes('adservice') ||
              src.includes('popads') ||
              src.includes('propeller') ||
              src.includes('exoclick') ||
              src.includes('adsterra')
            ) {
              ifr.style.setProperty('display', 'none', 'important');
              ifr.style.setProperty('height', '0', 'important');
              ifr.style.setProperty('min-height', '0', 'important');
              ifr.__ax_scanned_hidden = true;
              blockedCount++;
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

      // Debounced mutation observer to efficiently react to dynamic ad injections
      let scanTimer = null;
      const debouncedScan = () => {
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = setTimeout(scanForMaliciousOverlaysAndBanners, 200);
      };

      const observer = new MutationObserver(debouncedScan);
      const rootTarget = document.documentElement || document.body;
      if (rootTarget) {
        observer.observe(rootTarget, { childList: true, subtree: true });
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true });
          }
        });
      }

      // Initial scanning runs
      if (document.readyState === 'complete') {
        setTimeout(scanForMaliciousOverlaysAndBanners, 400);
      } else {
        window.addEventListener('load', () => setTimeout(scanForMaliciousOverlaysAndBanners, 400));
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

      container.innerHTML = `
        <div class="ax-card-header">
          <div class="ax-brand-tag">
            <span>🛡️ AX-Privacy</span>
          </div>
          <span class="ax-status-pill">${badgeText}</span>
        </div>
        <div class="ax-card-body">
          <div class="ax-title-row">
            <svg class="ax-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div class="ax-title">${alertData.title || 'Güvenlik Uyarısı'}</div>
          </div>
          <p class="ax-message">${alertData.message || 'Şüpheli aktivite algılandı.'}</p>
          <div class="ax-domain-box">${alertData.domain || currentHost}</div>
          <div class="ax-actions">
            <button class="ax-btn ax-btn-back" id="ax-back-btn">Güvenliğe Dön</button>
            <button class="ax-btn ax-btn-dismiss" id="ax-dismiss-btn">Riski Anladım</button>
          </div>
        </div>
      `;

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

  // Listen for security alert messages from background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message?.type === 'AX_SECURITY_ALERT') {
        renderSecurityAlert(message);
        sendResponse({ success: true });
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

  function handleTrustedNewTabIntent(e) {
    if (!e || e.isTrusted !== true) return;
    try {
      const target = e.target;
      if (!target || !(target instanceof Element)) return;

      const anchor = target.closest('a[href]');
      if (!anchor || !anchor.href) return;

      const href = anchor.href.trim();
      if (!href.startsWith('http://') && !href.startsWith('https://')) return;

      // Check intent to open a new tab
      const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
      const isMiddleClick = e.button === 1;
      const hasModifier = Boolean(e.ctrlKey || e.metaKey);
      const isNewTabIntent = targetAttr === '_blank' || isMiddleClick || hasModifier;

      if (!isNewTabIntent) return;

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
      if (opacity < 0.15) return;

      // Must not cover the entire screen (transparent curtain traps)
      if (rect.width > 0 && rect.height > 0) {
        const wRatio = rect.width / (window.innerWidth || 1);
        const hRatio = rect.height / (window.innerHeight || 1);
        if (wRatio >= 0.7 && hRatio >= 0.7) return;
      }

      let targetHost = '';
      try {
        targetHost = new URL(href).hostname.toLowerCase();
      } catch {
        return;
      }

      chrome.runtime.sendMessage({
        type: 'AX_TRUSTED_NEW_TAB',
        targetHost,
        href,
        button: e.button,
        isMiddleClick,
        time: Date.now()
      }).catch(() => {});
    } catch {}
  }

  // Hook all pointer and click phases to guarantee ultra-early delivery before tab creation
  window.addEventListener('pointerdown', handleTrustedNewTabIntent, true);
  window.addEventListener('mousedown', handleTrustedNewTabIntent, true);
  window.addEventListener('click', handleTrustedNewTabIntent, true);
  window.addEventListener('auxclick', handleTrustedNewTabIntent, true);

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
})();
