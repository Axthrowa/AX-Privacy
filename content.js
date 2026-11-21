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
      const data = await chrome.storage.local.get(['cosmeticFilter', 'whitelist']);
      const cosmeticFilter = data.cosmeticFilter !== undefined ? data.cosmeticFilter : true;
      const whitelist = data.whitelist || [];

      // Check if current site or parent domain is whitelisted
      const isWhitelisted = whitelist.some(
        (w) => currentHost === w || currentHost.endsWith('.' + w)
      );

      if (!cosmeticFilter || isWhitelisted) {
        return;
      }

      // --- Layer 1: Site-Specific Cosmetic CSS ---
      chrome.runtime
        .sendMessage({
          type: 'GET_COSMETIC_SELECTORS',
          hostname: currentHost
        })
        .then((response) => {
          if (response && response.success && Array.isArray(response.selectors) && response.selectors.length > 0) {
            const siteStyleId = 'ax-privacy-site-cosmetic';
            let siteStyle = document.getElementById(siteStyleId);
            if (!siteStyle) {
              siteStyle = document.createElement('style');
              siteStyle.id = siteStyleId;
              const target = document.head || document.documentElement;
              if (target) {
                target.appendChild(siteStyle);
              } else {
                document.addEventListener('DOMContentLoaded', () => {
                  (document.head || document.documentElement).appendChild(siteStyle);
                });
              }
            }
            siteStyle.textContent = `
              ${response.selectors.join(',\n')} {
                display: none !important;
                visibility: hidden !important;
                height: 0 !important;
                min-height: 0 !important;
                pointer-events: none !important;
              }
            `;
          }
        })
        .catch(() => {});

      // --- Layer 2: General Safe Turkish & Global Banner CSS ---
      const styleId = 'ax-cosmetic-filter-shield';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          ins.adsbygoogle,
          [data-ad-slot],
          [data-ad-client],
          [data-adunit],
          [data-ad-unit],
          [data-google-query-id],
          div[id^="google_ads_iframe"],
          div[id^="div-gpt-ad"],
          iframe[src*="doubleclick.net"],
          iframe[src*="googlesyndication.com"],
          iframe[src*="adservice.google."],
          .ad-placement,
          .ad-container,
          .ad-banner,
          .advertisement-container,
          .adsbygoogle,
          [id*="reklam"]:not(main):not(body),
          [class*="reklam-"]:not(main),
          .pageskin,
          .sticky-ad,
          #sticky-ad,
          .floating-ad,
          .video-ad-overlay,
          .click-overlay,
          #pop-overlay,
          a[target="_blank"] > img[src*=".gif"],
          a[target="_blank"] > img[src*=".webp"][src*="banner"] {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            min-height: 0 !important;
            pointer-events: none !important;
          }
        `;

        const target = document.head || document.documentElement;
        if (target) {
          target.appendChild(style);
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            (document.head || document.documentElement).appendChild(style);
          });
        }
      }

      // --- Layer 3: Smart DOM Scanner for dynamically injected GIF/WebP banners and invisible traps ---
      function scanForMaliciousOverlaysAndBanners() {
        try {
          const candidates = document.querySelectorAll(
            'div, section, aside, span, a, [id*="overlay"], [class*="overlay"], [id*="banner"], [class*="banner"]'
          );

          let blockedCount = 0;

          for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (!el || el.__ax_scanned_hidden) continue;

            const tagName = el.tagName.toLowerCase();
            // Critical safeguard: Never touch video players, semantic layout, or form containers
            if (
              tagName === 'video' ||
              tagName === 'header' ||
              tagName === 'nav' ||
              tagName === 'main' ||
              tagName === 'article' ||
              tagName === 'iframe' ||
              tagName === 'form' ||
              tagName === 'body' ||
              tagName === 'html'
            ) {
              continue;
            }

            // Never touch elements containing player media or interactive inputs
            if (el.querySelector('video, input, select, textarea, button[type="submit"]')) {
              continue;
            }

            // Never touch site navigation or breadcrumbs
            if (el.closest('nav, header')) {
              continue;
            }

            let style;
            try {
              style = window.getComputedStyle(el);
            } catch {
              continue;
            }

            if (!style || style.display === 'none' || style.visibility === 'hidden') {
              continue;
            }

            const position = style.position;
            const isFixedOrSticky = position === 'fixed' || position === 'sticky';
            const isAbsoluteOrFixed = position === 'fixed' || position === 'absolute';

            // Pattern A: Fixed / Sticky Floating GIF & Betting Banners
            if (isFixedOrSticky) {
              const hasExternalLink = Boolean(
                el.querySelector('a[href^="http://"], a[href^="https://"], a[target="_blank"]')
              );
              const hasGifOrWebp = Boolean(
                el.querySelector('img[src*=".gif"], img[src*=".webp"], [style*=".gif"], [style*=".webp"]')
              );
              const adMeta = (el.id + ' ' + el.className).toLowerCase();
              const hasAdKeywords =
                adMeta.includes('reklam') ||
                adMeta.includes('banner') ||
                adMeta.includes('bahis') ||
                adMeta.includes('bet') ||
                adMeta.includes('casino') ||
                adMeta.includes('sponsor');

              if (hasExternalLink && (hasGifOrWebp || hasAdKeywords)) {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
                el.__ax_scanned_hidden = true;
                blockedCount++;
                continue;
              }
            }

            // Pattern B: Invisible Click Overlay Trap (covers large area, z-index >= 999, transparent)
            if (isAbsoluteOrFixed) {
              const zIndex = parseInt(style.zIndex, 10);
              if (zIndex >= 999) {
                const rect = el.getBoundingClientRect();
                if (rect.width >= 300 && rect.height >= 200) {
                  const opacity = parseFloat(style.opacity);
                  const isTransparentBg =
                    style.backgroundColor === 'transparent' ||
                    style.backgroundColor.includes('rgba(0, 0, 0, 0)') ||
                    style.backgroundColor === 'rgba(0,0,0,0)';

                  const isTransparent = opacity < 0.1 || isTransparentBg;

                  if (isTransparent) {
                    const textLen = (el.innerText || '').trim().length;
                    // Trap layer is empty or holds only a single invisible link without text
                    if (textLen < 5) {
                      const childCount = el.children.length;
                      if (childCount <= 1) {
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
            }
          }

          if (blockedCount > 0) {
            chrome.runtime
              .sendMessage({
                type: 'INCREMENT_BLOCKED',
                count: blockedCount
              })
              .catch(() => {});
          }
        } catch {
          // Suppress scan errors
        }
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

      // Count hidden items once DOM is populated
      const countHiddenAds = () => {
        try {
          const adSelectors = [
            'ins.adsbygoogle',
            '[data-ad-slot]',
            'div[id^="google_ads_iframe"]',
            'div[id^="div-gpt-ad"]',
            'iframe[src*="doubleclick.net"]',
            'iframe[src*="googlesyndication.com"]',
            '[id*="reklam"]',
            '.sticky-ad',
            '.floating-ad'
          ];
          let foundCount = 0;
          for (const sel of adSelectors) {
            foundCount += document.querySelectorAll(sel).length;
          }
          if (foundCount > 0) {
            chrome.runtime
              .sendMessage({
                type: 'INCREMENT_BLOCKED',
                count: foundCount
              })
              .catch(() => {});
          }
        } catch {
          // Suppress count errors
        }
      };

      if (document.readyState === 'complete') {
        setTimeout(countHiddenAds, 1000);
      } else {
        window.addEventListener('load', () => setTimeout(countHiddenAds, 1000));
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
