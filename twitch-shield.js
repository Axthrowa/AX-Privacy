/**
 * AX-Privacy Twitch Stream Shield (Manifest V3 - MAIN World)
 * Server-Side Ad Insertion (SSAI) Video-Swap Shield for Twitch.tv
 * Operates without external dependencies; gracefully falls back to avoid black screens.
 */

(function () {
  'use strict';

  // Prevent multiple executions in the same execution context
  if (window.__AX_TWITCH_SHIELD_INITIALIZED__) return;
  window.__AX_TWITCH_SHIELD_INITIALIZED__ = true;

  // 1. Status Check: Synchronously check if module is disabled by user or whitelist
  try {
    if (window.localStorage.getItem('ax_privacy_twitch_shield') === 'disabled') {
      return;
    }
  } catch {
    // If localStorage access fails, continue safely
  }

  const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  let capturedClientId = DEFAULT_CLIENT_ID;
  let capturedAuthToken = null;

  const PLAYER_TYPE_CANDIDATES = ['embed', 'popout', 'autoplay'];

  /**
   * Extract channel name from window.location.pathname
   */
  function getChannelName() {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        const candidate = parts[0].toLowerCase();
        const nonChannels = [
          'directory',
          'videos',
          'settings',
          'p',
          'downloads',
          'jobs',
          'turbo',
          'prime',
          'search'
        ];
        if (!nonChannels.includes(candidate)) {
          return candidate;
        }
      }
    } catch {}
    return null;
  }

  /**
   * Request an alternative stream playlist without stitched ads via GQL
   */
  async function fetchCleanStream(channel, fetchFn) {
    if (!channel) return null;

    for (const playerType of PLAYER_TYPE_CANDIDATES) {
      try {
        const gqlPayload = {
          operationName: 'PlaybackAccessToken',
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: '0828119ded1c1343796697d51487b8807adf946112d8a573ec991f8680166299'
            }
          },
          variables: {
            isLive: true,
            login: channel,
            isVod: false,
            vodID: '',
            playerType: playerType
          }
        };

        const headers = {
          'Client-Id': capturedClientId,
          'Content-Type': 'application/json'
        };
        if (capturedAuthToken) {
          headers['Authorization'] = capturedAuthToken;
        }

        const gqlRes = await fetchFn('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers,
          body: JSON.stringify(gqlPayload)
        });

        if (!gqlRes.ok) continue;

        const gqlData = await gqlRes.json();
        const tokenObj = gqlData?.data?.streamPlaybackAccessToken;
        if (!tokenObj?.value || !tokenObj?.signature) continue;

        const usherUrl =
          `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(channel)}.m3u8` +
          `?client_id=${encodeURIComponent(capturedClientId)}` +
          `&token=${encodeURIComponent(tokenObj.value)}` +
          `&sig=${encodeURIComponent(tokenObj.signature)}` +
          `&allow_source=true&allow_audio_only=true&fast_bread=true`;

        const usherRes = await fetchFn(usherUrl);
        if (!usherRes.ok) continue;

        const usherText = await usherRes.text();

        // If master playlist with variants, extract highest stream
        if (usherText.includes('#EXT-X-STREAM-INF')) {
          const lines = usherText.split(/\r?\n/);
          let mediaUrl = null;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
              mediaUrl = lines[i + 1]?.trim();
              break;
            }
          }
          if (mediaUrl) {
            const mediaRes = await fetchFn(mediaUrl);
            if (mediaRes.ok) {
              const mediaText = await mediaRes.text();
              if (
                !mediaText.includes('stitched-ad') &&
                !mediaText.includes('twitch-stitched-ad')
              ) {
                return mediaText;
              }
            }
          }
        } else if (
          !usherText.includes('stitched-ad') &&
          !usherText.includes('twitch-stitched-ad')
        ) {
          return usherText;
        }
      } catch {
        // Try next candidate
      }
    }

    return null;
  }

  /**
   * Process and swap HLS M3U8 playlist when stitched ads are detected
   */
  async function processM3u8(originalText, originalUrl, fetchFn) {
    try {
      const isAdStitched =
        originalText.includes('stitched-ad') ||
        originalText.includes('twitch-stitched-ad') ||
        originalText.includes('X-TV-TWITCH-AD');

      if (!isAdStitched) {
        return originalText;
      }

      // Ad detected! Attempt clean video swap
      let channel = getChannelName();
      if (!channel && originalUrl) {
        const match = originalUrl.match(/channel[s]?\/hls\/([^.?]+)/i);
        if (match) channel = match[1];
      }

      if (channel) {
        const cleanPlaylist = await fetchCleanStream(channel, fetchFn);
        if (cleanPlaylist && cleanPlaylist.length > 50) {
          return cleanPlaylist;
        }
      }
    } catch {
      // On any error, return originalText to prevent black screens
    }
    return originalText;
  }

  // 2. Inject Worker fetch wrapper into any JavaScript Blobs created by Twitch (Amazon IVS Player)
  try {
    const OrigBlob = window.Blob;
    const workerHookCode = `
      (function() {
        if (self.__AX_WORKER_HOOKED__) return;
        self.__AX_WORKER_HOOKED__ = true;
        const origFetch = self.fetch;
        if (typeof origFetch === 'function') {
          self.fetch = async function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
            const response = await origFetch.apply(this, args);
            if (url && (url.includes('.m3u8') || url.includes('ttvnw.net'))) {
              try {
                const text = await response.clone().text();
                if (text && (text.includes('stitched-ad') || text.includes('twitch-stitched-ad'))) {
                  // Pass through or sanitize
                }
              } catch (e) {}
            }
            return response;
          };
        }
      })();
    `;

    window.Blob = function (parts, options) {
      try {
        if (
          parts &&
          Array.isArray(parts) &&
          options &&
          (options.type === 'application/javascript' || options.type === 'text/javascript')
        ) {
          return new OrigBlob([workerHookCode, ...parts], options);
        }
      } catch {}
      return new OrigBlob(parts, options);
    };
    window.Blob.prototype = OrigBlob.prototype;
  } catch {}

  // 3. Main-thread window.fetch interceptor
  try {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        const req = args[0];
        let url = '';

        if (typeof req === 'string') {
          url = req;
        } else if (req && req.url) {
          url = req.url;
        }

        // Capture GQL Client-Id and Authorization headers
        if (url.includes('gql.twitch.tv/gql')) {
          const init = args[1] || (req && typeof req === 'object' ? req : {});
          const headers = init.headers;
          if (headers) {
            if (typeof headers.get === 'function') {
              const cid = headers.get('Client-Id');
              if (cid) capturedClientId = cid;
              const auth = headers.get('Authorization');
              if (auth) capturedAuthToken = auth;
            } else if (typeof headers === 'object') {
              const cid = headers['Client-Id'] || headers['client-id'];
              if (cid) capturedClientId = cid;
              const auth = headers['Authorization'] || headers['authorization'];
              if (auth) capturedAuthToken = auth;
            }
          }
        }

        // Intercept M3U8 playlist responses
        if (url && (url.includes('.m3u8') || url.includes('usher.ttvnw.net'))) {
          const response = await origFetch.apply(this, args);
          if (response && response.ok) {
            try {
              const cloned = response.clone();
              const text = await cloned.text();
              const modifiedText = await processM3u8(text, url, origFetch);

              if (modifiedText !== text) {
                return new Response(modifiedText, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers
                });
              }
            } catch {
              // Return original response
            }
          }
          return response;
        }
      } catch {
        // Fall back to original fetch
      }
      return origFetch.apply(this, args);
    };
  } catch {}

  // 4. Visual suppression of lingering Twitch video ad banners
  try {
    const style = document.createElement('style');
    style.id = 'ax-twitch-shield-css';
    style.textContent = `
      .ad-interrupt,
      [data-test-selector="ad-banner-default-text"],
      [data-a-target="video-ad-label"],
      [data-a-target="video-ad-countdown"],
      .video-player__overlay [data-a-target*="ad-"] {
        display: none !important;
        opacity: 0 !important;
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
  } catch {}
})();
