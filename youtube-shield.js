/**
 * AX-Privacy YouTube Video Stream Shield (Manifest V3 - MAIN World - v2.3.0)
 * Multi-layer in-stream video ad & anti-adblock enforcement mitigation for YouTube.com
 *
 * Architecture:
 *   1. Layer 1 (Pre-emptive): Pure JSON Response Cleaner:
 *      - pruneAdData removes adPlacements, playerAds, adSlots, and bkaEnforcementMessageViewModel
 *      - Protects videoDetails, streamingData, playabilityStatus
 *      - Hooks window.ytInitialPlayerResponse via Object.defineProperty
 *      - Hooks window.fetch and XMLHttpRequest for /youtubei/v1/player and /youtubei/v1/next
 *   2. Layer 2 (Reactive): Fast-Skip Fallback:
 *      - Detects .ad-showing / .ad-interrupting on player
 *      - Temporarily mutes video (saving previous mute state)
 *      - Fast-forwards video.currentTime to duration and clicks visible skip buttons
 *      - Unmutes once ad classes disappear
 *   3. Layer 3 (Cosmetic): Non-breaking CSS suppression of ad slots and enforcement modals
 */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.__AX_YOUTUBE_SHIELD_INITIALIZED__) return;
  window.__AX_YOUTUBE_SHIELD_INITIALIZED__ = true;

  // 1. Synchronously verify module state from localStorage (set by content.js bridge)
  try {
    if (window.localStorage.getItem('ax_privacy_youtube_shield') === 'disabled') {
      return;
    }
  } catch {
    // Proceed safely
  }

  /**
   * Cleans ad metadata and anti-adblock warnings from YouTube JSON structures
   * Preserves streamingData, videoDetails, and playabilityStatus completely
   */
  function pruneAdData(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    try {
      // Remove ad placements, slots, and break parameters
      delete obj.adPlacements;
      delete obj.playerAds;
      delete obj.adSlots;
      delete obj.adBreakHeartbeatParams;

      // Remove anti-adblock enforcement modal if present
      if (obj.auxiliaryUi && obj.auxiliaryUi.messageRenderers) {
        delete obj.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel;
        delete obj.auxiliaryUi.messageRenderers.enforcementMessageViewModel;
      }

      // Clean nested playerResponse structures if present
      if (obj.playerResponse && typeof obj.playerResponse === 'object') {
        delete obj.playerResponse.adPlacements;
        delete obj.playerResponse.playerAds;
        delete obj.playerResponse.adSlots;
        delete obj.playerResponse.adBreakHeartbeatParams;

        if (obj.playerResponse.auxiliaryUi && obj.playerResponse.auxiliaryUi.messageRenderers) {
          delete obj.playerResponse.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel;
          delete obj.playerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel;
        }
      }
    } catch {}

    return obj;
  }

  // --- Layer 1: JSON Response Cleaner ---

  // Hook window.ytInitialPlayerResponse
  try {
    let initialResponse = window.ytInitialPlayerResponse;
    if (initialResponse) {
      try {
        pruneAdData(initialResponse);
      } catch {}
    }

    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() {
        return initialResponse;
      },
      set(val) {
        try {
          initialResponse = pruneAdData(val);
        } catch {
          initialResponse = val;
        }
      }
    });
  } catch {}

  // Hook window.fetch for /youtubei/v1/player and /youtubei/v1/next ONLY
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (...args) {
        let url = '';
        try {
          const req = args[0];
          if (typeof req === 'string') {
            url = req;
          } else if (req && typeof req.url === 'string') {
            url = req.url;
          }
        } catch {}

        // Fast-path: Only intercept player and next endpoints. Pass all other requests (guide, browse, etc.) directly!
        const isTargetEndpoint =
          url && (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next'));

        if (!isTargetEndpoint) {
          return origFetch.apply(this, args);
        }

        // For player & next endpoints, handle JSON parsing with strict fallback to original response
        return origFetch.apply(this, args).then(async (response) => {
          try {
            if (!response || !response.ok) {
              return response;
            }

            const contentType = (response.headers?.get('content-type') || '').toLowerCase();
            if (contentType && !contentType.includes('application/json') && !contentType.includes('+json')) {
              return response;
            }

            const cloned = response.clone();
            const text = await cloned.text();
            if (!text || text.trim().length === 0) {
              return response;
            }

            const json = JSON.parse(text);
            pruneAdData(json);

            return new Response(JSON.stringify(json), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
          } catch {
            // In case of any cloning, text reading or JSON parsing error, ALWAYS return original response
            return response;
          }
        }).catch((err) => {
          throw err;
        });
      };
    }
  } catch {}

  // Hook XMLHttpRequest for /youtubei/v1/player and /youtubei/v1/next ONLY
  try {
    if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        try {
          this._ax_is_target = false;
          let strUrl = '';
          if (typeof url === 'string') {
            strUrl = url;
          } else if (url && url.toString) {
            strUrl = url.toString();
          }
          if (strUrl && (strUrl.includes('/youtubei/v1/player') || strUrl.includes('/youtubei/v1/next'))) {
            this._ax_is_target = true;
          }
        } catch {}
        return origOpen.apply(this, [method, url, ...rest]);
      };

      XMLHttpRequest.prototype.send = function (...args) {
        try {
          if (this._ax_is_target) {
            this.addEventListener(
              'readystatechange',
              function () {
                try {
                  if (this.readyState === 4 && this.status >= 200 && this.status < 300) {
                    const responseText = this.responseText;
                    if (responseText && typeof responseText === 'string') {
                      const parsed = JSON.parse(responseText);
                      pruneAdData(parsed);
                      const serialized = JSON.stringify(parsed);
                      Object.defineProperty(this, 'responseText', {
                        configurable: true,
                        value: serialized
                      });
                      Object.defineProperty(this, 'response', {
                        configurable: true,
                        value: serialized
                      });
                    }
                  }
                } catch {}
              },
              false
            );
          }
        } catch {}
        return origSend.apply(this, args);
      };
    }
  } catch {}

  // --- Layer 2: Fast-Skip Fallback ---
  let wasMutedByExtension = false;
  let adSkipAttempts = 0;

  function checkAndSkipAds() {
    try {
      const player =
        document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
      const video =
        document.querySelector('video.html5-main-video') ||
        document.querySelector('video');

      if (!player) return;

      const isAdShowing =
        player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting');

      const hasAdBadge = Boolean(
        document.querySelector(
          '.ytp-ad-text, .ytp-ad-preview-text, .ytp-ad-simple-ad-badge, .ytp-ad-player-overlay, .ytp-ad-module'
        )
      );

      if (isAdShowing || hasAdBadge) {
        adSkipAttempts++;

        // 1. Programmatically click skip buttons if visible
        const skipSelectors = [
          '.ytp-skip-ad-button',
          '.ytp-ad-skip-button',
          '.ytp-ad-skip-button-modern',
          '.ytp-ad-skip-button-slot button',
          'button.ytp-ad-skip-button-text',
          '.ytp-ad-skip-button-container button'
        ];
        let skipClicked = false;
        for (const sel of skipSelectors) {
          const btn = document.querySelector(sel);
          if (btn && typeof btn.click === 'function') {
            btn.click();
            skipClicked = true;
            break;
          }
        }

        if (video) {
          // Temporarily mute during active ad playback only if not already muted by user
          if (!video.muted && !wasMutedByExtension) {
            wasMutedByExtension = true;
            video.muted = true;
          }

          // If ad is short or has ad badge, fast-forward safely to avoid freezing the player
          if (Number.isFinite(video.duration) && video.duration > 0 && video.duration < 180) {
            try {
              video.playbackRate = 16.0;
              // Avoid exact duration which can hang YouTube's state machine; seek to near-end
              if (video.currentTime < video.duration - 0.2) {
                video.currentTime = Math.max(0, video.duration - 0.1);
              }
            } catch {}
          }
        }

        // If ad skip was clicked or video reached near end, or ad has lingered > 3s, clear ad classes immediately
        if (
          skipClicked ||
          (video && Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.5) ||
          adSkipAttempts >= 6
        ) {
          player.classList.remove('ad-showing', 'ad-interrupting');
          adSkipAttempts = 0;
          if (wasMutedByExtension && video) {
            video.muted = false;
            try {
              video.playbackRate = 1.0;
            } catch {}
            wasMutedByExtension = false;
          }
        }
      } else {
        adSkipAttempts = 0;
        // Restore sound and normal playback speed if muted by extension
        if (wasMutedByExtension) {
          if (video) {
            video.muted = false;
            try {
              video.playbackRate = 1.0;
            } catch {}
          }
          wasMutedByExtension = false;
        }
      }
    } catch {}
  }

  // Observe player mutations
  try {
    const observer = new MutationObserver(() => {
      checkAndSkipAds();
    });

    function initObserver() {
      try {
        const target =
          document.getElementById('movie_player') ||
          document.querySelector('#player') ||
          document.body;
        if (target) {
          observer.observe(target, {
            attributes: true,
            attributeFilter: ['class'],
            childList: true,
            subtree: true
          });
        }
      } catch {}
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initObserver);
    } else {
      initObserver();
    }

    // Lightweight 500ms safety interval
    setInterval(checkAndSkipAds, 500);
  } catch {}

  // --- Layer 3: Site-Safe Cosmetic Filtering ---
  try {
    const style = document.createElement('style');
    style.id = 'ax-youtube-shield-css';
    style.textContent = `
      ytd-ad-slot-renderer,
      ytd-in-feed-ad-layout-renderer,
      ytd-promoted-sparkles-web-renderer,
      ytd-display-ad-renderer,
      ytd-banner-promo-renderer,
      ytd-enforcement-message-view-model,
      #player-ads,
      .ytp-ad-overlay-container {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* Explicitly protect YouTube main layout & navigation sidebar */
      ytd-guide-renderer,
      tp-yt-app-drawer,
      #guide,
      #sections,
      ytd-mini-guide-renderer {
        visibility: visible !important;
      }

      /* Guarantee that YouTube player controls, seekbars, volume slider and buttons are ALWAYS interactive */
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
        cursor: pointer !important;
      }

      /* Protect YouTube HTML5 video element interactivity */
      .html5-video-player video,
      video.html5-main-video {
        pointer-events: auto !important;
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
  } catch {}

  console.info('[AX-YouTube] Video reklam kalkanı aktif');

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { pruneAdData };
  }
})();
