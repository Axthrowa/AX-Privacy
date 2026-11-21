/**
 * AX-Privacy Twitch Stream Shield (Manifest V3 - MAIN World - v2.2.2)
 * Robust SSAI / HLS Video-Swap Architecture for Twitch.tv
 *
 * Key Architecture:
 *   1. Precise Channel Resolution:
 *      - Extracts real channel from usher.ttvnw.net/api/channel/hls/{channel}.m3u8
 *      - Maps variant URLs in master playlist to channel name
 *      - Synchronizes main-window location.pathname to Web Worker via postMessage
 *      - Rejects invalid / token filenames with strict regex ^[a-z0-9_]{2,25}$
 *   2. Per-Channel State & Cache (Eliminates Ad Loop Flapping):
 *      - Only true media playlists (#EXTINF:) update ad state
 *      - Caches clean backupMediaUrl and candidate playerType across the ad break
 *      - 2-poll hysteresis before confirming ad completion
 *   3. Anonymous GQL PlaybackAccessToken:
 *      - Fetches with credentials: 'omit' to bypass user-targeted SSAI ads
 *      - Cleans ad tags from returned playlist to prevent player UI muting/miniplayer
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

  const SYSTEM_PATHS = new Set([
    'directory',
    'videos',
    'clips',
    'downloads',
    'jobs',
    'settings',
    'subscriptions',
    'inventory',
    'drops',
    'wallet',
    'u',
    'p',
    'search',
    'turbo',
    'prime',
    'moderator',
    'messages',
    'friends'
  ]);

  /**
   * Validates if a string is a legitimate Twitch channel name (not a base64 token or system path)
   */
  function isValidChannel(channel) {
    if (!channel || typeof channel !== 'string') return false;
    const lower = channel.toLowerCase();
    if (SYSTEM_PATHS.has(lower)) return false;
    return /^[a-z0-9_]{2,25}$/.test(lower);
  }

  /**
   * Extracts active channel name from window.location.pathname
   */
  function getActiveChannelFromLocation() {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        const first = parts[0].toLowerCase();
        if (isValidChannel(first)) {
          return first;
        }
      }
    } catch {}
    return null;
  }

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
      const playlistUrlToChannel = new Map();

      // Per-channel state to prevent ad detection / end flapping
      const channelState = new Map();

      function getOrCreateChannelState(ch) {
        let state = channelState.get(ch);
        if (!state) {
          state = {
            isAdActive: false,
            cleanStreak: 0,
            backupMediaUrl: null,
            activePlayerType: null
          };
          channelState.set(ch, state);
        }
        return state;
      }

      function isValidChannel(ch) {
        if (!ch || typeof ch !== 'string') return false;
        return /^[a-z0-9_]{2,25}$/.test(ch.toLowerCase());
      }

      function resolveChannel(url) {
        if (!url) return null;
        if (playlistUrlToChannel.has(url)) return playlistUrlToChannel.get(url);
        const noQuery = url.split('?')[0];
        if (playlistUrlToChannel.has(noQuery)) return playlistUrlToChannel.get(noQuery);

        if (isValidChannel(activeChannel)) {
          return activeChannel;
        }
        return null;
      }

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

      // Synchronize channel name from main thread
      self.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'AX_SET_CHANNEL' && e.data.channel) {
          const ch = e.data.channel.toLowerCase();
          if (isValidChannel(ch)) {
            activeChannel = ch;
          }
        }
      });

      async function findCleanBackupStream(channel, fetchFn) {
        if (!isValidChannel(channel)) return null;

        for (const candidate of PLAYER_TYPE_CANDIDATES) {
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
                playerType: candidate,
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

            if (!gqlRes.ok) {
              console.warn('[AX-Twitch][Worker] Aday başarısız (' + candidate + '): GQL HTTP ' + gqlRes.status);
              continue;
            }

            const gqlData = await gqlRes.json();
            const tokenObj = gqlData?.data?.streamPlaybackAccessToken;
            if (!tokenObj?.value || !tokenObj?.signature) {
              console.warn('[AX-Twitch][Worker] Aday başarısız (' + candidate + '): Token bulunamadı');
              continue;
            }

            const randomP = Math.floor(Math.random() * 999999);
            const usherUrl = 'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(channel) + '.m3u8' +
              '?client_id=' + encodeURIComponent(CLIENT_ID) +
              '&token=' + encodeURIComponent(tokenObj.value) +
              '&sig=' + encodeURIComponent(tokenObj.signature) +
              '&allow_source=true&allow_audio_only=true&fast_bread=true&p=' + randomP;

            const usherRes = await fetchFn(usherUrl, { credentials: 'omit' });
            if (!usherRes.ok) {
              console.warn('[AX-Twitch][Worker] Aday başarısız (' + candidate + '): Usher HTTP ' + usherRes.status);
              continue;
            }

            const usherText = await usherRes.text();

            if (usherText.includes('#EXT-X-STREAM-INF')) {
              const lines = usherText.split(/\\r?\\n/);
              let mediaUrl = null;
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1]) {
                  mediaUrl = lines[i + 1].trim();
                  break;
                }
              }

              if (mediaUrl) {
                const mediaRes = await fetchFn(mediaUrl, { credentials: 'omit' });
                if (mediaRes.ok) {
                  const mediaText = await mediaRes.text();
                  if (!isAd(mediaText) && mediaText.includes('#EXTINF:')) {
                    return {
                      mediaUrl: mediaUrl,
                      playerType: candidate,
                      content: cleanTags(mediaText)
                    };
                  } else {
                    console.warn('[AX-Twitch][Worker] Aday başarısız (' + candidate + '): Reklam içeriyor');
                  }
                }
              }
            } else if (!isAd(usherText) && usherText.includes('#EXTINF:')) {
              return {
                mediaUrl: usherUrl,
                playerType: candidate,
                content: cleanTags(usherText)
              };
            }
          } catch (err) {
            console.warn('[AX-Twitch][Worker] Aday deneme hatası (' + candidate + '): ' + err.message);
          }
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

          // 1. Intercept Usher Master Playlist: Extract channel & map variant URLs
          if (url && url.includes('usher.ttvnw.net/api/channel/hls/')) {
            const m = url.match(/\\/channel\\/hls\\/([a-z0-9_]{2,25})/i);
            if (m) {
              const ch = m[1].toLowerCase();
              activeChannel = ch;

              try {
                const usherResponse = await origFetch.apply(this, args);
                if (usherResponse && usherResponse.ok) {
                  const cloned = usherResponse.clone();
                  cloned.text().then(body => {
                    const lines = body.split(/\\r?\\n/);
                    for (let i = 0; i < lines.length; i++) {
                      if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1]) {
                        const variantUrl = lines[i + 1].trim();
                        if (variantUrl) {
                          playlistUrlToChannel.set(variantUrl, ch);
                          playlistUrlToChannel.set(variantUrl.split('?')[0], ch);
                        }
                      }
                    }
                  }).catch(() => {});
                }
                return usherResponse;
              } catch (e) {
                return origFetch.apply(this, args);
              }
            }
          }

          // 2. Intercept M3U8 Media Playlist fetches
          if (url && (url.includes('.m3u8') || url.includes('tttnw.net') || url.includes('playlist.ttvnw.net'))) {
            try {
              const response = await origFetch.apply(this, args);
              if (response && response.ok) {
                const cloned = response.clone();
                const text = await cloned.text();

                // ONLY true media playlists containing #EXTINF: update the ad state
                if (!text.includes('#EXTINF:')) {
                  return response;
                }

                const ch = resolveChannel(url);
                if (!ch || !isValidChannel(ch)) {
                  // Never parse base64 tokens as channels
                  return response;
                }

                const state = getOrCreateChannelState(ch);
                const hasAds = isAd(text);

                if (hasAds) {
                  state.cleanStreak = 0;
                  if (!state.isAdActive) {
                    state.isAdActive = true;
                    console.info('[AX-Twitch][Worker] Reklam algılandı (kanal: ' + ch + ')');
                  }

                  // Check if we have an active clean backup media URL cached
                  if (state.backupMediaUrl) {
                    try {
                      const cachedRes = await origFetch(state.backupMediaUrl, { credentials: 'omit' });
                      if (cachedRes.ok) {
                        const cachedText = await cachedRes.text();
                        if (!isAd(cachedText) && cachedText.includes('#EXTINF:')) {
                          return new Response(cleanTags(cachedText), {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers
                          });
                        }
                      }
                      // Cached backup is invalid or has ads, clear it
                      state.backupMediaUrl = null;
                      state.activePlayerType = null;
                    } catch (e) {
                      state.backupMediaUrl = null;
                      state.activePlayerType = null;
                    }
                  }

                  // No valid cached backup stream, find a new clean candidate
                  const backupResult = await findCleanBackupStream(ch, origFetch);
                  if (backupResult && backupResult.content) {
                    state.backupMediaUrl = backupResult.mediaUrl;
                    state.activePlayerType = backupResult.playerType;
                    console.info('[AX-Twitch][Worker] Yedek akış aktif (kanal: ' + ch + ', playerType: ' + backupResult.playerType + ')');

                    return new Response(backupResult.content, {
                      status: response.status,
                      statusText: response.statusText,
                      headers: response.headers
                    });
                  } else {
                    console.warn('[AX-Twitch][Worker] Yedek akış alınamadı, orijinal akışa düşülüyor (kanal: ' + ch + ')');
                  }
                } else {
                  // No ads in this media playlist
                  if (state.isAdActive) {
                    state.cleanStreak++;
                    // Require 2 consecutive clean polls to eliminate ad loop flapping
                    if (state.cleanStreak >= 2) {
                      state.isAdActive = false;
                      state.cleanStreak = 0;
                      state.backupMediaUrl = null;
                      state.activePlayerType = null;
                      console.info('[AX-Twitch][Worker] Reklam sona erdi, orijinal akışa dönüldü (kanal: ' + ch + ')');
                      return response;
                    } else if (state.backupMediaUrl) {
                      // During streak 1, maintain backup stream to prevent brief ad flashes
                      try {
                        const cachedRes = await origFetch(state.backupMediaUrl, { credentials: 'omit' });
                        if (cachedRes.ok) {
                          const cachedText = await cachedRes.text();
                          if (!isAd(cachedText) && cachedText.includes('#EXTINF:')) {
                            return new Response(cleanTags(cachedText), {
                              status: response.status,
                              statusText: response.statusText,
                              headers: response.headers
                            });
                          }
                        }
                      } catch (e) {}
                    }
                  }
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

  // 2. Track active workers created in the main window
  const activeWorkers = new Set();

  function broadcastChannelToWorkers(channel) {
    if (!isValidChannel(channel)) return;
    for (const worker of activeWorkers) {
      try {
        worker.postMessage({ type: 'AX_SET_CHANNEL', channel });
      } catch {
        activeWorkers.delete(worker);
      }
    }
  }

  // Monitor SPA navigation (pushState, popstate, hashchange)
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    const res = origPushState.apply(this, args);
    setTimeout(() => {
      const ch = getActiveChannelFromLocation();
      if (ch) broadcastChannelToWorkers(ch);
    }, 50);
    return res;
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const res = origReplaceState.apply(this, args);
    setTimeout(() => {
      const ch = getActiveChannelFromLocation();
      if (ch) broadcastChannelToWorkers(ch);
    }, 50);
    return res;
  };

  window.addEventListener('popstate', () => {
    const ch = getActiveChannelFromLocation();
    if (ch) broadcastChannelToWorkers(ch);
  });
  window.addEventListener('hashchange', () => {
    const ch = getActiveChannelFromLocation();
    if (ch) broadcastChannelToWorkers(ch);
  });

  // 3. Hook URL.createObjectURL to capture Blob references
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

  // 4. Hook window.Worker to inject WORKER_HOOK_SOURCE before IVS player runs
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

        const worker = new OrigWorker(hookedUrl, options);
        activeWorkers.add(worker);

        // Send current active channel immediately
        const initialChannel = getActiveChannelFromLocation();
        if (initialChannel) {
          setTimeout(() => {
            try {
              worker.postMessage({ type: 'AX_SET_CHANNEL', channel: initialChannel });
            } catch {}
          }, 0);
        }

        return worker;
      }
    } catch (e) {
      console.warn('[AX-Twitch] Worker hook oluşturulamadı, orijinal worker başlatılıyor:', e);
    }
    return new OrigWorker(scriptURL, options);
  };
  window.Worker.prototype = OrigWorker.prototype;

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
