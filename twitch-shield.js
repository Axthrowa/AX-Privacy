/**
 * AX-Privacy Twitch Stream Shield (Manifest V3 - MAIN World - v2.2.4)
 * Robust SSAI / HLS Video-Swap Architecture for Twitch.tv
 *
 * Key Architecture:
 *   1. Precise GQL PlaybackAccessToken Schema:
 *      - Uses clean GraphQL PlaybackAccessToken query without unused variables
 *      - Robust response parser handling single object and array responses
 *      - Detailed failure diagnosis (HTTP status, error message, forbiddenReasonCode)
 *   2. Main-Window GQL Header Capture & Worker Synchronization:
 *      - Captures Client-ID, Device-ID, Client-Version, Client-Session-Id, Client-Integrity
 *      - Relays headers to Web Worker via postMessage
 *      - Anonymous by default (credentials: 'omit'); retries with Client-Integrity if needed
 *   3. Multi-Candidate Matrix:
 *      - Tries in sequence: embed/web, embed/ios, popout/web, autoplay/web, site/ios, frontpage/web
 *      - Caches clean backupMediaUrl across the ad break; 2-poll hysteresis before ad end
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

  const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

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
   * Extracts headers from Headers instance, plain object, or array
   */
  function parseHeaders(inputHeaders) {
    const map = {};
    if (!inputHeaders) return map;
    try {
      if (typeof inputHeaders.forEach === 'function') {
        inputHeaders.forEach((val, key) => {
          map[key.toLowerCase()] = val;
        });
      } else if (Array.isArray(inputHeaders)) {
        for (const [k, v] of inputHeaders) {
          if (k) map[k.toLowerCase()] = v;
        }
      } else if (typeof inputHeaders === 'object') {
        for (const [k, v] of Object.entries(inputHeaders)) {
          if (k) map[k.toLowerCase()] = v;
        }
      }
    } catch {}
    return map;
  }

  // Captured GQL headers state in the main thread
  const capturedGqlHeaders = {
    clientId: DEFAULT_CLIENT_ID,
    deviceId: null,
    clientVersion: null,
    clientSessionId: null,
    clientIntegrity: null
  };

  const activeWorkers = new Set();

  function broadcastGqlHeadersToWorkers() {
    for (const worker of activeWorkers) {
      try {
        worker.postMessage({ type: 'AX_GQL_HEADERS', headers: capturedGqlHeaders });
      } catch {
        activeWorkers.delete(worker);
      }
    }
  }

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

  function updateCapturedGqlHeaders(rawHeaders) {
    const map = parseHeaders(rawHeaders);
    let changed = false;

    const cid = map['client-id'];
    if (cid && cid !== capturedGqlHeaders.clientId) {
      capturedGqlHeaders.clientId = cid;
      changed = true;
    }
    const did = map['device-id'] || map['x-device-id'];
    if (did && did !== capturedGqlHeaders.deviceId) {
      capturedGqlHeaders.deviceId = did;
      changed = true;
    }
    const cv = map['client-version'];
    if (cv && cv !== capturedGqlHeaders.clientVersion) {
      capturedGqlHeaders.clientVersion = cv;
      changed = true;
    }
    const csi = map['client-session-id'];
    if (csi && csi !== capturedGqlHeaders.clientSessionId) {
      capturedGqlHeaders.clientSessionId = csi;
      changed = true;
    }
    const ci = map['client-integrity'];
    if (ci && ci !== capturedGqlHeaders.clientIntegrity) {
      capturedGqlHeaders.clientIntegrity = ci;
      changed = true;
    }

    if (changed) {
      broadcastGqlHeadersToWorkers();
    }
  }

  /**
   * Source code string of the in-worker fetch interceptor
   * Injected into the Amazon IVS player Web Worker scope before any IVS code runs
   */
  const WORKER_HOOK_SOURCE = `
    (function() {
      if (self.__AX_WORKER_HOOKED__) return;
      self.__AX_WORKER_HOOKED__ = true;

      const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

      const GQL_QUERY = [
        'query PlaybackAccessToken($login: String!, $playerType: String!, $platform: String!) {',
        '  streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) {',
        '    value',
        '    signature',
        '    authorization { isForbidden forbiddenReasonCode }',
        '    __typename',
        '  }',
        '}'
      ].join('\\n');

      const CANDIDATE_MATRIX = [
        { playerType: 'embed', platform: 'web' },
        { playerType: 'embed', platform: 'ios' },
        { playerType: 'popout', platform: 'web' },
        { playerType: 'autoplay', platform: 'web' },
        { playerType: 'site', platform: 'ios' },
        { playerType: 'frontpage', platform: 'web' }
      ];

      let activeChannel = null;
      let workerGqlHeaders = {
        clientId: DEFAULT_CLIENT_ID,
        deviceId: null,
        clientVersion: null,
        clientSessionId: null,
        clientIntegrity: null
      };

      const playlistUrlToChannel = new Map();
      const channelState = new Map();

      function getOrCreateChannelState(ch) {
        let state = channelState.get(ch);
        if (!state) {
          state = {
            isAdActive: false,
            cleanStreak: 0,
            backupMediaUrl: null,
            activePlayerType: null,
            activePlatform: null,
            targetMediaUrl: null,
            pendingBackupPromise: null,
            retryAfter: 0
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

      // Synchronize channel name & GQL headers from main thread
      self.addEventListener('message', (e) => {
        if (e.data) {
          if (e.data.type === 'AX_SET_CHANNEL' && e.data.channel) {
            const ch = e.data.channel.toLowerCase();
            if (isValidChannel(ch)) {
              activeChannel = ch;
            }
          } else if (e.data.type === 'AX_GQL_HEADERS' && e.data.headers) {
            workerGqlHeaders = Object.assign(workerGqlHeaders, e.data.headers);
          }
        }
      });

      async function requestToken(channel, candidate, withIntegrity, fetchFn) {
        const reqHeaders = {
          'Client-Id': workerGqlHeaders.clientId || DEFAULT_CLIENT_ID,
          'Content-Type': 'application/json'
        };
        if (workerGqlHeaders.clientVersion) reqHeaders['Client-Version'] = workerGqlHeaders.clientVersion;
        if (workerGqlHeaders.clientSessionId) reqHeaders['Client-Session-Id'] = workerGqlHeaders.clientSessionId;
        if (workerGqlHeaders.deviceId) reqHeaders['X-Device-Id'] = workerGqlHeaders.deviceId;

        if (withIntegrity && workerGqlHeaders.clientIntegrity) {
          reqHeaders['Client-Integrity'] = workerGqlHeaders.clientIntegrity;
        }

        const gqlRes = await fetchFn('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify({
            operationName: 'PlaybackAccessToken',
            query: GQL_QUERY,
            variables: {
              login: channel,
              playerType: candidate.playerType,
              platform: candidate.platform
            }
          }),
          credentials: 'omit'
        });

        if (!gqlRes.ok) {
          return { ok: false, error: 'GQL HTTP ' + gqlRes.status };
        }

        const json = await gqlRes.json();
        const data = Array.isArray(json) ? json[0]?.data : json?.data;
        const tokenObj = data?.streamPlaybackAccessToken;

        if (!tokenObj) {
          const msg = Array.isArray(json) ? json[0]?.errors?.[0]?.message : json?.errors?.[0]?.message;
          return { ok: false, error: msg || 'Token bulunamadı' };
        }

        if (tokenObj.authorization && tokenObj.authorization.isForbidden) {
          const reason = tokenObj.authorization.forbiddenReasonCode || 'Forbidden';
          return { ok: false, error: 'authorization.isForbidden (' + reason + ')' };
        }

        if (!tokenObj.value || !tokenObj.signature) {
          return { ok: false, error: 'value/signature eksik' };
        }

        return { ok: true, value: tokenObj.value, signature: tokenObj.signature };
      }

      async function findCleanBackupStream(channel, fetchFn) {
        if (!isValidChannel(channel)) return null;

        for (const candidate of CANDIDATE_MATRIX) {
          try {
            // First attempt: anonymous request
            let tokenResult = await requestToken(channel, candidate, false, fetchFn);

            // If failed and we have Client-Integrity, retry with integrity header
            if (!tokenResult.ok && workerGqlHeaders.clientIntegrity) {
              tokenResult = await requestToken(channel, candidate, true, fetchFn);
            }

            if (!tokenResult.ok) {
              console.info('[AX-Twitch][Worker] Aday başarısız (' + candidate.playerType + '/' + candidate.platform + '): ' + tokenResult.error);
              continue;
            }

            const randomP = Math.floor(Math.random() * 999999);
            const usherUrl = 'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(channel) + '.m3u8' +
              '?allow_source=true&allow_audio_only=true&fast_bread=true' +
              '&sig=' + encodeURIComponent(tokenResult.signature) +
              '&token=' + encodeURIComponent(tokenResult.value) +
              '&p=' + randomP;

            const usherRes = await fetchFn(usherUrl, { credentials: 'omit' });
            if (!usherRes.ok) {
              console.info('[AX-Twitch][Worker] Aday başarısız (' + candidate.playerType + '/' + candidate.platform + '): Usher HTTP ' + usherRes.status);
              continue;
            }

            const usherText = await usherRes.text();

            if (usherText.includes('#EXT-X-STREAM-INF')) {
              const lines = usherText.split(/\\r?\\n/);
              const variantUrls = [];
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1]) {
                  const candidateUrl = lines[i + 1].trim();
                  if (candidateUrl && candidateUrl.startsWith('http')) {
                    variantUrls.push(candidateUrl);
                  }
                }
              }

              for (const mediaUrl of variantUrls) {
                const mediaRes = await fetchFn(mediaUrl, { credentials: 'omit' });
                if (mediaRes.ok) {
                  const mediaText = await mediaRes.text();
                  if (!isAd(mediaText) && mediaText.includes('#EXTINF:')) {
                    return {
                      mediaUrl: mediaUrl,
                      playerType: candidate.playerType,
                      platform: candidate.platform,
                      content: cleanTags(mediaText)
                    };
                  } else {
                    console.info('[AX-Twitch][Worker] Aday başarısız (' + candidate.playerType + '/' + candidate.platform + '): Reklam içeriyor');
                  }
                }
              }
            } else if (!isAd(usherText) && usherText.includes('#EXTINF:')) {
              return {
                mediaUrl: usherUrl,
                playerType: candidate.playerType,
                platform: candidate.platform,
                content: cleanTags(usherText)
              };
            }
          } catch (err) {
            console.info('[AX-Twitch][Worker] Aday hatası (' + candidate.playerType + '/' + candidate.platform + '): ' + err.message);
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

          // 1. Usher Master Playlist: Extract channel & map variant URLs
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

          // 2. M3U8 Media Playlist fetches
          if (url && (url.includes('.m3u8') || url.includes('ttvnw.net') || url.includes('playlist.ttvnw.net'))) {
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
                const cleanUrl = url.split('?')[0];

                if (hasAds) {
                  state.cleanStreak = 0;
                  state.targetMediaUrl = cleanUrl;
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
                      state.activePlatform = null;
                    } catch (e) {
                      state.backupMediaUrl = null;
                      state.activePlayerType = null;
                      state.activePlatform = null;
                    }
                  }

                  // In-flight promise lock or cooldown check
                  let backupResult = null;
                  if (state.pendingBackupPromise) {
                    backupResult = await state.pendingBackupPromise;
                  } else if (Date.now() < state.retryAfter) {
                    return response;
                  } else {
                    state.pendingBackupPromise = findCleanBackupStream(ch, origFetch);
                    try {
                      backupResult = await state.pendingBackupPromise;
                    } catch (err) {
                      backupResult = null;
                    } finally {
                      state.pendingBackupPromise = null;
                    }
                  }

                  if (backupResult && backupResult.content) {
                    state.backupMediaUrl = backupResult.mediaUrl;
                    state.activePlayerType = backupResult.playerType;
                    state.activePlatform = backupResult.platform;
                    state.retryAfter = 0;
                    console.info('[AX-Twitch][Worker] Yedek akış aktif (kanal: ' + ch + ', playerType: ' + backupResult.playerType + '/' + backupResult.platform + ')');

                    return new Response(backupResult.content, {
                      status: response.status,
                      statusText: response.statusText,
                      headers: response.headers
                    });
                  } else {
                    state.retryAfter = Date.now() + 5000;
                    console.info('[AX-Twitch][Worker] Tüm adaylar başarısız, orijinal akışa düşülüyor (kanal: ' + ch + ')');
                    return response;
                  }
                } else {
                  // No ads in this media playlist
                  if (state.isAdActive) {
                    // Audio/auxiliary playlists must not prematurely reset the ad state
                    if (state.targetMediaUrl && cleanUrl !== state.targetMediaUrl) {
                      return response;
                    }

                    state.cleanStreak++;
                    // Require 2 consecutive clean polls on the target media playlist to eliminate ad loop flapping
                    if (state.cleanStreak >= 2) {
                      state.isAdActive = false;
                      state.cleanStreak = 0;
                      state.backupMediaUrl = null;
                      state.activePlayerType = null;
                      state.activePlatform = null;
                      state.targetMediaUrl = null;
                      state.retryAfter = 0;
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

  // 2. Monitor SPA navigation (pushState, replaceState, popstate, hashchange)
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

  // 3. Hook window.fetch on main thread to capture GQL headers & channel info
  try {
    const origWindowFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        const req = args[0];
        let url = '';
        if (typeof req === 'string') url = req;
        else if (req && req.url) url = req.url;

        // Capture GQL headers (Client-ID, Device-ID, Client-Version, Client-Integrity)
        if (url && url.includes('gql.twitch.tv/gql')) {
          const init = args[1] || (req && typeof req === 'object' ? req : {});
          if (init && init.headers) {
            updateCapturedGqlHeaders(init.headers);
          }
        }
      } catch {}
      return origWindowFetch.apply(this, args);
    };
  } catch {}

  // 4. Hook URL.createObjectURL to capture Blob references
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

  // 5. Hook window.Worker to inject WORKER_HOOK_SOURCE before Amazon IVS player runs
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

        // Send current active channel and captured headers immediately
        setTimeout(() => {
          try {
            const initialChannel = getActiveChannelFromLocation();
            if (initialChannel) {
              worker.postMessage({ type: 'AX_SET_CHANNEL', channel: initialChannel });
            }
            worker.postMessage({ type: 'AX_GQL_HEADERS', headers: capturedGqlHeaders });
          } catch {}
        }, 0);

        return worker;
      }
    } catch (e) {
      console.warn('[AX-Twitch] Worker hook oluşturulamadı, orijinal worker başlatılıyor:', e);
    }
    return new OrigWorker(scriptURL, options);
  };
  window.Worker.prototype = OrigWorker.prototype;

  // 6. Visual suppression of Twitch ad banners & overlay interrupts
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
