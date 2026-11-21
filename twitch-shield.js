/**
 * AX-Privacy Twitch Stream Shield (Manifest V3 - MAIN World - v2.2.1)
 * Robust SSAI / HLS Video-Swap Architecture for Twitch.tv
 * Hooks window.Worker and URL.createObjectURL to intercept Amazon IVS Player HLS Loader,
 * requests anonymous clean backup streams via GQL, and prevents player blackouts.
 */

(function () {
  'use strict';

  if (window.__AX_TWITCH_SHIELD_INITIALIZED__) return;
  window.__AX_TWITCH_SHIELD_INITIALIZED__ = true;

  // 1. Synchronously verify module state from localStorage (set by content.js bridge)
  try {
    if (window.localStorage.getItem('ax_privacy_twitch_shield') === 'disabled') {
      return;
    }
  } catch {
    // If localStorage read fails, proceed safely
  }

  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const PLAYER_TYPE_CANDIDATES = ['embed', 'popout', 'autoplay', 'frontpage'];

  /**
   * Evaluates whether a playlist text contains Server-Side Ad Insertion (SSAI) indicators
   */
  function isAdPlaylist(text) {
    if (!text || typeof text !== 'string') return false;
    return (
      text.includes('stitched-ad') ||
      text.includes('twitch-stitched-ad') ||
      text.includes('X-TV-TWITCH-AD') ||
      text.includes('amazon-adsystem') ||
      text.includes('CLASS="twitch-stitched-ad"')
    );
  }

  /**
   * Strips ad metadata and date ranges from playlist text to prevent player ad-UI triggers
   */
  function cleanAdTags(text) {
    if (!text) return text;
    return text
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (
          trimmed.startsWith('#EXT-X-DATERANGE:') &&
          (trimmed.includes('stitched-ad') ||
            trimmed.includes('amazon-adsystem') ||
            trimmed.includes('twitch-stitched-ad'))
        ) {
          return false;
        }
        if (trimmed.startsWith('#EXT-X-TWITCH-PREVIEWS:AD')) return false;
        if (trimmed.includes('X-TV-TWITCH-AD')) return false;
        return true;
      })
      .join('\n');
  }

  /**
   * Fetches an anonymous ad-free backup stream for a channel via GQL + usher
   */
  async function fetchCleanBackupStream(channel, fetchFn) {
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
            playerType: playerType,
            platform: 'web',
            playerBackend: 'mediaplayer'
          }
        };

        const gqlRes = await fetchFn('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: {
            'Client-Id': CLIENT_ID,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(gqlPayload),
          credentials: 'omit' // Anonymous request to avoid user-targeted SSAI ads
        });

        if (!gqlRes.ok) continue;

        const gqlData = await gqlRes.json();
        const tokenObj = gqlData?.data?.streamPlaybackAccessToken;
        if (!tokenObj?.value || !tokenObj?.signature) continue;

        const randomP = Math.floor(Math.random() * 999999);
        const usherUrl =
          `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(channel)}.m3u8` +
          `?client_id=${encodeURIComponent(CLIENT_ID)}` +
          `&token=${encodeURIComponent(tokenObj.value)}` +
          `&sig=${encodeURIComponent(tokenObj.signature)}` +
          `&allow_source=true&allow_audio_only=true&fast_bread=true&p=${randomP}`;

        const usherRes = await fetchFn(usherUrl, { credentials: 'omit' });
        if (!usherRes.ok) continue;

        const usherText = await usherRes.text();

        // If master playlist, extract media playlist URL
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
            const mediaRes = await fetchFn(mediaUrl, { credentials: 'omit' });
            if (mediaRes.ok) {
              const mediaText = await mediaRes.text();
              if (!isAdPlaylist(mediaText)) {
                console.info(
                  `[AX-Twitch] Yedek akış başarıyla uygulandı (playerType: ${playerType})`
                );
                return cleanAdTags(mediaText);
              } else {
                console.warn(
                  `[AX-Twitch] ${playerType} adayı reklam içeriyor, sonraki deneniyor...`
                );
              }
            }
          }
        } else if (!isAdPlaylist(usherText)) {
          console.info(
            `[AX-Twitch] Yedek akış başarıyla uygulandı (playerType: ${playerType})`
          );
          return cleanAdTags(usherText);
        }
      } catch {
        // Try next candidate
      }
    }

    return null;
  }

  /**
   * Source code string of the in-worker fetch interceptor
   * Injected into the Amazon IVS player Web Worker scope before any IVS code runs
   */
  const WORKER_HOOK_SOURCE = `
    (function() {
      if (self.__AX_WORKER_HOOKED__) return;
      self.__AX_WORKER_HOOKED__ = true;

      const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
      const PLAYER_TYPE_CANDIDATES = ['embed', 'popout', 'autoplay', 'frontpage'];

      let activeChannel = null;
      let isAdActive = false;

      function isAd(text) {
        if (!text || typeof text !== 'string') return false;
        return (
          text.includes('stitched-ad') ||
          text.includes('twitch-stitched-ad') ||
          text.includes('X-TV-TWITCH-AD') ||
          text.includes('amazon-adsystem') ||
          text.includes('CLASS="twitch-stitched-ad"')
        );
      }

      function cleanTags(text) {
        if (!text) return text;
        return text.split(/\\r?\\n/).filter(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('#EXT-X-DATERANGE:') && (
            trimmed.includes('stitched-ad') ||
            trimmed.includes('amazon-adsystem') ||
            trimmed.includes('twitch-stitched-ad')
          )) return false;
          if (trimmed.startsWith('#EXT-X-TWITCH-PREVIEWS:AD')) return false;
          if (trimmed.includes('X-TV-TWITCH-AD')) return false;
          return true;
        }).join('\\n');
      }

      async function getBackupStream(channel, fetchFn) {
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
                playerType: playerType,
                platform: 'web',
                playerBackend: 'mediaplayer'
              }
            };

            const gqlRes = await fetchFn('https://gql.twitch.tv/gql', {
              method: 'POST',
              headers: {
                'Client-Id': CLIENT_ID,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(gqlPayload),
              credentials: 'omit'
            });

            if (!gqlRes.ok) continue;
            const gqlData = await gqlRes.json();
            const tokenObj = gqlData?.data?.streamPlaybackAccessToken;
            if (!tokenObj?.value || !tokenObj?.signature) continue;

            const randomP = Math.floor(Math.random() * 999999);
            const usherUrl = 'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(channel) + '.m3u8' +
              '?client_id=' + encodeURIComponent(CLIENT_ID) +
              '&token=' + encodeURIComponent(tokenObj.value) +
              '&sig=' + encodeURIComponent(tokenObj.signature) +
              '&allow_source=true&allow_audio_only=true&fast_bread=true&p=' + randomP;

            const usherRes = await fetchFn(usherUrl, { credentials: 'omit' });
            if (!usherRes.ok) continue;

            const usherText = await usherRes.text();
            if (usherText.includes('#EXT-X-STREAM-INF')) {
              const lines = usherText.split(/\\r?\\n/);
              let mediaUrl = null;
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                  mediaUrl = lines[i + 1]?.trim();
                  break;
                }
              }
              if (mediaUrl) {
                const mediaRes = await fetchFn(mediaUrl, { credentials: 'omit' });
                if (mediaRes.ok) {
                  const mediaText = await mediaRes.text();
                  if (!isAd(mediaText)) {
                    console.info('[AX-Twitch][Worker] Yedek akış başarıyla uygulandı (playerType: ' + playerType + ')');
                    return cleanTags(mediaText);
                  }
                }
              }
            } else if (!isAd(usherText)) {
              console.info('[AX-Twitch][Worker] Yedek akış başarıyla uygulandı (playerType: ' + playerType + ')');
              return cleanTags(usherText);
            }
          } catch (e) {}
        }
        return null;
      }

      const origFetch = self.fetch;
      if (typeof origFetch === 'function') {
        self.fetch = async function(...args) {
          const req = args[0];
          let url = '';
          if (typeof req === 'string') url = req;
          else if (req && req.url) url = req.url;

          // Track channel from usher master playlist
          if (url && url.includes('usher.ttvnw.net/api/channel/hls/')) {
            const m = url.match(/\\/channel\\/hls\\/([^.?/]+)/i);
            if (m) activeChannel = m[1].toLowerCase();
          }

          // Intercept M3U8 playlist fetches
          if (url && (url.includes('.m3u8') || url.includes('ttvnw.net'))) {
            try {
              const response = await origFetch.apply(this, args);
              if (response && response.ok) {
                const cloned = response.clone();
                const text = await cloned.text();

                if (isAd(text)) {
                  if (!isAdActive) {
                    isAdActive = true;
                    console.info('[AX-Twitch][Worker] Reklam algılandı: ' + (activeChannel || url));
                  }

                  // Find channel if not already detected
                  if (!activeChannel) {
                    const match = url.match(/\\/playlist\\/([^.?/]+)/i) || url.match(/\\/channel[s]?\\/hls\\/([^.?/]+)/i);
                    if (match) activeChannel = match[1].toLowerCase();
                  }

                  const cleanPlaylist = await getBackupStream(activeChannel, origFetch);
                  if (cleanPlaylist && cleanPlaylist.length > 50) {
                    return new Response(cleanPlaylist, {
                      status: response.status,
                      statusText: response.statusText,
                      headers: response.headers
                    });
                  }
                } else if (isAdActive) {
                  isAdActive = false;
                  console.info('[AX-Twitch][Worker] Reklam sona erdi, orijinal akışa dönüldü: ' + activeChannel);
                }
              }
              return response;
            } catch (err) {
              return origFetch.apply(this, args);
            }
          }

          return origFetch.apply(this, args);
        };
      }
    })();
  `;

  // 2. Hook URL.createObjectURL to map JS Blob URLs for IVS Worker
  const origCreateObjectURL = URL.createObjectURL;
  const blobUrlMap = new Map();

  URL.createObjectURL = function (obj) {
    const url = origCreateObjectURL.call(URL, obj);
    try {
      if (obj instanceof Blob) {
        blobUrlMap.set(url, obj);
      }
    } catch {}
    return url;
  };

  // 3. Hook window.Worker to inject fetch hook into Amazon IVS player Web Worker
  const OrigWorker = window.Worker;
  window.Worker = function (scriptURL, options) {
    try {
      const scriptUrlStr =
        typeof scriptURL === 'string'
          ? scriptURL
          : scriptURL && scriptURL.toString
            ? scriptURL.toString()
            : '';

      if (scriptUrlStr) {
        // Prepend WORKER_HOOK_SOURCE before importing the original script
        const wrappedSource = `
          ${WORKER_HOOK_SOURCE}
          try {
            importScripts(${JSON.stringify(scriptUrlStr)});
          } catch(e) {
            console.warn('[AX-Twitch] importScripts hatası:', e);
          }
        `;

        const hookedBlob = new Blob([wrappedSource], { type: 'application/javascript' });
        const hookedUrl = origCreateObjectURL.call(URL, hookedBlob);
        console.info('[AX-Twitch] IVS Worker hook aktif');
        return new OrigWorker(hookedUrl, options);
      }
    } catch (e) {
      console.warn('[AX-Twitch] Worker hook oluşturulamadı, orijinal worker başlatılıyor:', e);
    }
    return new OrigWorker(scriptURL, options);
  };
  window.Worker.prototype = OrigWorker.prototype;

  // 4. Also hook main-thread window.fetch for playlists fetched outside workers
  try {
    const origWindowFetch = window.fetch;
    let mainThreadChannel = null;
    let mainThreadAdActive = false;

    window.fetch = async function (...args) {
      try {
        const req = args[0];
        let url = '';
        if (typeof req === 'string') url = req;
        else if (req && req.url) url = req.url;

        // Extract channel name from usher master playlist
        if (url.includes('usher.ttvnw.net/api/channel/hls/')) {
          const match = url.match(/\/channel\/hls\/([^.?/]+)/i);
          if (match) mainThreadChannel = match[1].toLowerCase();
        }

        // Intercept M3U8 responses in the main thread
        if (url && (url.includes('.m3u8') || url.includes('ttvnw.net'))) {
          const response = await origWindowFetch.apply(this, args);
          if (response && response.ok) {
            try {
              const cloned = response.clone();
              const text = await cloned.text();

              if (isAdPlaylist(text)) {
                if (!mainThreadAdActive) {
                  mainThreadAdActive = true;
                  console.info(
                    `[AX-Twitch] Reklam algılandı: ${mainThreadChannel || url}`
                  );
                }

                if (!mainThreadChannel) {
                  const match =
                    url.match(/\/playlist\/([^.?/]+)/i) ||
                    url.match(/\/channel[s]?\/hls\/([^.?/]+)/i);
                  if (match) mainThreadChannel = match[1].toLowerCase();
                }

                const cleanPlaylist = await fetchCleanBackupStream(
                  mainThreadChannel,
                  origWindowFetch
                );
                if (cleanPlaylist && cleanPlaylist.length > 50) {
                  return new Response(cleanPlaylist, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                  });
                }
              } else if (mainThreadAdActive) {
                mainThreadAdActive = false;
                console.info(
                  `[AX-Twitch] Reklam sona erdi, orijinal akışa dönüldü: ${mainThreadChannel}`
                );
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
      return origWindowFetch.apply(this, args);
    };
  } catch {}

  // 5. Visual suppression of Twitch ad banners & overlay interrupts
  try {
    const style = document.createElement('style');
    style.id = 'ax-twitch-shield-css';
    style.textContent = `
      .ad-interrupt,
      [data-test-selector="ad-banner-default-text"],
      [data-a-target="video-ad-label"],
      [data-a-target="video-ad-countdown"],
      .video-player__overlay [data-a-target*="ad-"],
      .video-player__overlay [data-test-selector*="ad-"] {
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
