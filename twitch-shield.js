/**
 * AX-Privacy Twitch Stream Shield (Manifest V3 - MAIN World - v2.2.5)
 * Robust SSAI / HLS Video-Swap Architecture for Twitch.tv
 *
 * Key Architecture:
 *   1. Precise GQL PlaybackAccessToken Schema:
 *      - Clean GraphQL PlaybackAccessToken query without unused variables
 *      - Completely anonymous token request on round 1 (no identity leak)
 *      - Detailed failure diagnosis (HTTP status, error message, forbiddenReasonCode)
 *   2. Strict SSAI Ad Matching & Auto-Mute Fallback:
 *      - Matches exact SSAI markers (twitch-stitched-ad, stitched-ad, amazon-adsystem, EXTINF:Amazon)
 *      - Logs matched ad keyword on candidate rejection
 *      - Auto-mutes video when ad plays on original stream if all candidates fail
 *   3. Multi-Candidate Matrix & Max 2 Variant Testing:
 *      - Sequence: embed/web, thunderdome/web, picture-by-picture/web, autoplay/web, embed/android
 *      - Tests only highest and lowest resolution variants (source + 480p/360p)
 *      - 15s retryAfter cooldown on failure
 *   4. Optional Custom Playlist Proxy Support
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
    if (text.includes('twitch-stitched-ad')) return true;
    if (text.includes('CLASS="twitch-stitched-ad"')) return true;
    if (text.includes('stitched-ad')) return true;
    if (text.includes('amazon-adsystem')) return true;
    if (text.includes('X-TV-TWITCH-AD')) return true;
    if (text.includes('#EXT-X-TWITCH-PREVIEWS:AD')) return true;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('#EXT-X-DATERANGE:') && (
        line.includes('stitched') ||
        line.includes('amazon') ||
        /cue="(PRE|MID|POST)"/i.test(line)
      )) {
        return true;
      }
      if (line.startsWith('#EXTINF:') && (/amazon/i.test(line) || /stitched/i.test(line))) {
        return true;
      }
    }
    return false;
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
          (trimmed.includes('stitched') ||
            trimmed.includes('amazon') ||
            /cue="(PRE|MID|POST)"/i.test(trimmed))
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
        { playerType: 'embed', platform: 'web', clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
        { playerType: 'popout', platform: 'web', clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
        { playerType: 'frontpage', platform: 'web', clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
        { playerType: 'thunderdome', platform: 'web', clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
        { playerType: 'picture-by-picture', platform: 'web', clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
        { playerType: 'autoplay', platform: 'web', clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
        { playerType: 'embed', platform: 'android', clientId: 'ue6666qo983tsx6so1t0vnawi233wa' }
      ];

      const BLANK_MP4_CHUNK = 'data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA';

      const adSegmentCache = new Map();
      const pendingGqlRequests = new Map();

      let blankChunkBytes = null;
      function getBlankMp4Response() {
        if (!blankChunkBytes) {
          try {
            const bin = atob(BLANK_MP4_CHUNK.split(',')[1]);
            blankChunkBytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
              blankChunkBytes[i] = bin.charCodeAt(i);
            }
          } catch (e) {
            return origFetch(BLANK_MP4_CHUNK);
          }
        }
        return new Response(blankChunkBytes.buffer.slice(0), {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(blankChunkBytes.byteLength)
          }
        });
      }

      let activeChannel = null;
      let workerProxyUrl = null;
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

      function getAdMatchReason(text) {
        if (!text || typeof text !== 'string') return null;
        if (text.includes('twitch-stitched-ad')) return 'twitch-stitched-ad';
        if (text.includes('CLASS="twitch-stitched-ad"')) return 'CLASS="twitch-stitched-ad"';
        if (text.includes('stitched-ad')) return 'stitched-ad';
        if (text.includes('amazon-adsystem')) return 'amazon-adsystem';
        if (text.includes('X-TV-TWITCH-AD')) return 'X-TV-TWITCH-AD';
        if (text.includes('#EXT-X-TWITCH-PREVIEWS:AD')) return '#EXT-X-TWITCH-PREVIEWS:AD';
        const lines = text.split(/\\r?\\n/);
        for (const line of lines) {
          if (line.startsWith('#EXT-X-DATERANGE:') && (
            line.includes('stitched') ||
            line.includes('amazon') ||
            /cue="(PRE|MID|POST)"/i.test(line)
          )) {
            return 'EXT-X-DATERANGE:AdCue';
          }
          if (line.startsWith('#EXTINF:') && (/amazon/i.test(line) || /stitched/i.test(line))) {
            return 'EXTINF:Amazon';
          }
        }
        return null;
      }

      function isAd(text) {
        return Boolean(getAdMatchReason(text));
      }

      function cleanTags(text) {
        if (!text) return text;
        return text.split(/\\r?\\n/).filter(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('#EXT-X-DATERANGE:') && (
            trimmed.includes('stitched') ||
            trimmed.includes('amazon') ||
            /cue="(PRE|MID|POST)"/i.test(trimmed)
          )) return false;
          if (trimmed.startsWith('#EXT-X-TWITCH-PREVIEWS:AD')) return false;
          if (trimmed.includes('X-TV-TWITCH-AD')) return false;
          return true;
        }).join('\\n');
      }

      // Synchronize channel name, GQL headers, proxy & GQL responses from main thread
      self.addEventListener('message', (e) => {
        if (!e.data) return;
        if (e.data.type === 'AX_SET_CHANNEL' && e.data.channel) {
          const ch = e.data.channel.toLowerCase();
          if (isValidChannel(ch)) {
            activeChannel = ch;
          }
        } else if (e.data.type === 'AX_GQL_HEADERS' && e.data.headers) {
          workerGqlHeaders = Object.assign(workerGqlHeaders, e.data.headers);
        } else if (e.data.type === 'AX_SET_PROXY_URL') {
          workerProxyUrl = typeof e.data.proxyUrl === 'string' ? e.data.proxyUrl.trim() : null;
        } else if (e.data.type === 'AX_GQL_RES') {
          const req = pendingGqlRequests.get(e.data.id);
          if (req) {
            pendingGqlRequests.delete(e.data.id);
            if (e.data.error) {
              req.resolve({ ok: false, error: e.data.error });
            } else {
              try {
                const res = new Response(e.data.body, {
                  status: e.data.status || 200,
                  statusText: e.data.statusText || 'OK',
                  headers: e.data.headers || {}
                });
                req.resolve({ ok: true, response: res });
              } catch (err) {
                req.resolve({ ok: false, error: err.message });
              }
            }
          }
        }
      });

      function workerGqlFetch(url, options) {
        return new Promise((resolve) => {
          let timer = null;
          let finished = false;
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

          timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            if (controller) controller.abort();
            bridgeGqlFetch(url, options).then(resolve);
          }, 3000);

          origFetch(url, Object.assign({}, options, controller ? { signal: controller.signal } : {}))
            .then((res) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              if (res.ok) {
                resolve({ ok: true, response: res });
              } else {
                bridgeGqlFetch(url, options).then(resolve);
              }
            })
            .catch(() => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              bridgeGqlFetch(url, options).then(resolve);
            });
        });
      }

      function bridgeGqlFetch(url, options) {
        return new Promise((resolve) => {
          const id = 'gql_' + Math.random().toString(36).substring(2, 10);
          const timeout = setTimeout(() => {
            pendingGqlRequests.delete(id);
            resolve({ ok: false, error: 'GQL Bridge timeout' });
          }, 4000);

          pendingGqlRequests.set(id, {
            resolve: (res) => {
              clearTimeout(timeout);
              resolve(res);
            }
          });

          self.postMessage({
            type: 'AX_GQL_REQ',
            id: id,
            url: url,
            options: {
              method: options.method || 'POST',
              headers: options.headers || {},
              body: options.body || null
            }
          });
        });
      }

      async function requestToken(channel, candidate, withIntegrity) {
        const clientId = candidate.clientId || workerGqlHeaders.clientId || DEFAULT_CLIENT_ID;
        const reqHeaders = {
          'Client-Id': clientId,
          'Content-Type': 'text/plain;charset=UTF-8'
        };

        // ONLY send Client-Integrity & Device-ID if withIntegrity is explicitly requested in retry
        if (withIntegrity && workerGqlHeaders.clientIntegrity) {
          reqHeaders['Client-Integrity'] = workerGqlHeaders.clientIntegrity;
          if (workerGqlHeaders.deviceId) {
            reqHeaders['X-Device-Id'] = workerGqlHeaders.deviceId;
          }
        }

        const gqlResult = await workerGqlFetch('https://gql.twitch.tv/gql', {
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

        if (!gqlResult.ok || !gqlResult.response) {
          return { ok: false, error: gqlResult.error || 'GQL request failed' };
        }

        const gqlRes = gqlResult.response;
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

        // 1. Optional Custom Playlist Proxy Check
        if (workerProxyUrl && workerProxyUrl.startsWith('https://')) {
          try {
            const pUrl = workerProxyUrl
              .replace(/\{channel\}/gi, encodeURIComponent(channel))
              .replace(/\{channelName\}/gi, encodeURIComponent(channel))
              .replace(/\{login\}/gi, encodeURIComponent(channel));

            const pRes = await fetchFn(pUrl, { credentials: 'omit' });
            if (pRes.ok) {
              const pText = await pRes.text();
              const pAdReason = getAdMatchReason(pText);
              if (!pAdReason && pText.includes('#EXTINF:')) {
                console.info('[AX-Twitch][Worker] Özel proxy akışı aktif (kanal: ' + channel + ')');
                return {
                  mediaUrl: pUrl,
                  playerType: 'custom-proxy',
                  platform: 'proxy',
                  content: cleanTags(pText)
                };
              }
            }
          } catch (e) {
            console.info('[AX-Twitch][Worker] Özel proxy başarısız, yerel adaylara geçiliyor: ' + e.message);
          }
        }

        // 2. Local Candidate Matrix Check
        for (const candidate of CANDIDATE_MATRIX) {
          try {
            // First attempt: anonymous request (zero identity leakage)
            let tokenResult = await requestToken(channel, candidate, false);

            // If failed and we have Client-Integrity, retry with integrity header
            if (!tokenResult.ok && workerGqlHeaders.clientIntegrity) {
              tokenResult = await requestToken(channel, candidate, true);
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

              // Test at most 2 variants: highest (source - first) and lowest (last - 480p/360p)
              const selectedVariants = [];
              if (variantUrls.length > 0) {
                selectedVariants.push(variantUrls[0]);
              }
              if (variantUrls.length > 1) {
                selectedVariants.push(variantUrls[variantUrls.length - 1]);
              }

              for (const mediaUrl of selectedVariants) {
                const mediaRes = await fetchFn(mediaUrl, { credentials: 'omit' });
                if (mediaRes.ok) {
                  const mediaText = await mediaRes.text();
                  const adReason = getAdMatchReason(mediaText);
                  if (!adReason && mediaText.includes('#EXTINF:')) {
                    return {
                      mediaUrl: mediaUrl,
                      playerType: candidate.playerType,
                      platform: candidate.platform,
                      content: cleanTags(mediaText)
                    };
                  } else {
                    console.info('[AX-Twitch][Worker] Aday başarısız (' + candidate.playerType + '/' + candidate.platform + '): Reklam içeriyor [eşleşen: ' + (adReason || 'EXTINF eksik') + ']');
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
            } else if (usherText.includes('#EXTINF:')) {
              const adReason = getAdMatchReason(usherText);
              console.info('[AX-Twitch][Worker] Aday başarısız (' + candidate.playerType + '/' + candidate.platform + '): Reklam içeriyor [eşleşen: ' + (adReason || 'reklam') + ']');
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

          // 0. Blank out ad video segments immediately
          if (url && (adSegmentCache.has(url) || adSegmentCache.has(url.split('?')[0]))) {
            return getBlankMp4Response();
          }

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
                const cleanUrl = url.split('?')[0];

                // Detect whether this media playlist contains ads
                const hasAds = isAd(text);
                const lines = text.split(/\\r?\\n/);

                // ONLY extract ad segments if the playlist is confirmed to contain ads
                if (hasAds) {
                  for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.startsWith('#EXTINF:') && i < lines.length - 1) {
                      const isAdSeg = !line.includes(',live') || /amazon/i.test(line) || /stitched/i.test(line);
                      if (isAdSeg) {
                        const segUrl = lines[i + 1].trim();
                        if (segUrl && !segUrl.startsWith('#')) {
                          adSegmentCache.set(segUrl, Date.now());
                          adSegmentCache.set(segUrl.split('?')[0], Date.now());
                        }
                      }
                    }
                  }
                }

                // Prune expired ad segments (> 120s)
                const now = Date.now();
                for (const [sUrl, sTime] of adSegmentCache.entries()) {
                  if (now - sTime > 120000) {
                    adSegmentCache.delete(sUrl);
                  }
                }

                if (hasAds) {
                  state.cleanStreak = 0;
                  state.targetMediaUrl = cleanUrl;
                  if (!state.isAdActive) {
                    state.isAdActive = true;
                    console.info('[AX-Twitch][Worker] Reklam algılandı (kanal: ' + ch + ')');
                  }

                  // 1. Check if cached backup media stream is still valid & clean
                  if (state.backupMediaUrl) {
                    try {
                      const cachedRes = await origFetch(state.backupMediaUrl, { credentials: 'omit' });
                      if (cachedRes.ok) {
                        const cachedText = await cachedRes.text();
                        if (!isAd(cachedText) && cachedText.includes('#EXTINF:')) {
                          self.postMessage({ type: 'AX_AD_MUTE_STATE', active: false });
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

                  // 2. Query backup candidate stream if not on cooldown
                  let backupResult = null;
                  if (state.pendingBackupPromise) {
                    backupResult = await state.pendingBackupPromise;
                  } else if (Date.now() >= state.retryAfter) {
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
                    self.postMessage({ type: 'AX_AD_MUTE_STATE', active: false });

                    return new Response(backupResult.content, {
                      status: response.status,
                      statusText: response.statusText,
                      headers: response.headers
                    });
                  } else {
                    // Fallback: Strip ad tags & prefetch, nullify segments to blank MP4
                    state.retryAfter = Date.now() + 15000;
                    console.info('[AX-Twitch][Worker] Adaylar başarısız, reklam segmentleri nötrleniyor (kanal: ' + ch + ')');
                    self.postMessage({ type: 'AX_AD_MUTE_STATE', active: true });

                    const strippedLines = lines.filter(l => !l.startsWith('#EXT-X-TWITCH-PREFETCH:'));
                    const cleanedFallback = cleanTags(strippedLines.join('\\n'));

                    return new Response(cleanedFallback, {
                      status: response.status,
                      statusText: response.statusText,
                      headers: response.headers
                    });
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
                      adSegmentCache.clear();
                      console.info('[AX-Twitch][Worker] Reklam sona erdi, orijinal akışa dönüldü (kanal: ' + ch + ')');
                      self.postMessage({ type: 'AX_AD_MUTE_STATE', active: false });
                      return response;
                    } else if (state.backupMediaUrl) {
                      // During streak 1, maintain backup stream to prevent brief ad flashes
                      try {
                        const cachedRes = await origFetch(state.backupMediaUrl, { credentials: 'omit' });
                        if (cachedRes.ok) {
                          const cachedText = await cachedRes.text();
                          if (!isAd(cachedText) && cachedText.includes('#EXTINF:')) {
                            self.postMessage({ type: 'AX_AD_MUTE_STATE', active: false });
                            return new Response(cleanTags(cachedText), {
                              status: response.status,
                              statusText: response.statusText,
                              headers: response.headers
                            });
                          }
                        }
                      } catch (e) {}
                    }
                  } else {
                    // Guarantee that mute state is inactive on clean normal broadcasts
                    self.postMessage({ type: 'AX_AD_MUTE_STATE', active: false });
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
      handleAdMuteState(false);
      const ch = getActiveChannelFromLocation();
      if (ch) broadcastChannelToWorkers(ch);
    }, 50);
    return res;
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const res = origReplaceState.apply(this, args);
    setTimeout(() => {
      handleAdMuteState(false);
      const ch = getActiveChannelFromLocation();
      if (ch) broadcastChannelToWorkers(ch);
    }, 50);
    return res;
  };

  window.addEventListener('popstate', () => {
    handleAdMuteState(false);
    const ch = getActiveChannelFromLocation();
    if (ch) broadcastChannelToWorkers(ch);
  });
  window.addEventListener('hashchange', () => {
    handleAdMuteState(false);
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

        // Clean ad tags from any playlist fetched in window scope
        if (url && (url.includes('.m3u8') || url.includes('playlist.ttvnw.net'))) {
          const res = await origWindowFetch.apply(this, args);
          if (res && res.ok) {
            const cloned = res.clone();
            const text = await cloned.text();
            if (text.includes('#EXTINF:') && isAdPlaylist(text)) {
              return new Response(cleanAdTags(text), {
                status: res.status,
                statusText: res.statusText,
                headers: res.headers
              });
            }
          }
          return res;
        }
      } catch {}
      return origWindowFetch.apply(this, args);
    };
  } catch {}

  // 4. Hook URL.createObjectURL and URL.revokeObjectURL to protect hooked Web Workers
  const origCreateObjectURL = URL.createObjectURL;
  const origRevokeObjectURL = URL.revokeObjectURL;
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

  URL.revokeObjectURL = function (url) {
    // Delay revocation of blob URLs so that hooked Web Workers have adequate time to importScripts
    setTimeout(() => {
      try {
        origRevokeObjectURL.call(URL, url);
      } catch {}
    }, 15000);
  };

  // 5. Auto-Mute Fallback and Notification Management
  let wasMutedByExtension = false;

  function showMuteNotice() {
    if (document.getElementById('ax-ad-mute-notice')) return;
    const notice = document.createElement('div');
    notice.id = 'ax-ad-mute-notice';
    notice.textContent = 'AX-Privacy: Reklam sessize alındı 🔇';
    Object.assign(notice.style, {
      position: 'absolute',
      bottom: '64px',
      left: '16px',
      zIndex: '9999999',
      backgroundColor: 'rgba(11, 17, 32, 0.88)',
      color: '#38bdf8',
      fontSize: '12px',
      fontWeight: '600',
      padding: '6px 12px',
      borderRadius: '8px',
      border: '1px solid rgba(56, 189, 248, 0.3)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
      pointerEvents: 'none',
      transition: 'opacity 0.2s ease',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });
    const playerContainer =
      document.querySelector('.video-player__container') ||
      document.querySelector('[data-a-target="video-player"]') ||
      document.querySelector('.video-player') ||
      document.body;
    playerContainer.appendChild(notice);
  }

  function hideMuteNotice() {
    const el = document.getElementById('ax-ad-mute-notice');
    if (el) el.remove();
  }

  function handleAdMuteState(active) {
    const video = document.querySelector('video');
    if (active) {
      if (video && !video.muted) {
        wasMutedByExtension = true;
        video.muted = true;
        showMuteNotice();
      } else if (video && wasMutedByExtension) {
        showMuteNotice();
      }
    } else {
      if (wasMutedByExtension) {
        if (video) video.muted = false;
        wasMutedByExtension = false;
      }
      hideMuteNotice();
    }
  }

  // Listen for storage changes in the main window for real-time proxy URL sync
  window.addEventListener('storage', (e) => {
    if (e.key === 'ax_privacy_twitch_proxy') {
      const pUrl = e.newValue || '';
      for (const w of activeWorkers) {
        try {
          w.postMessage({ type: 'AX_SET_PROXY_URL', proxyUrl: pUrl });
        } catch {
          activeWorkers.delete(w);
        }
      }
    }
  });

  // 6. Hook window.Worker to inject WORKER_HOOK_SOURCE before Amazon IVS player runs
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
          (function() {
            function __ax_getWorkerCode(url) {
              try {
                const req = new XMLHttpRequest();
                req.open('GET', url, false);
                req.overrideMimeType('text/javascript');
                req.send();
                return req.responseText;
              } catch (e) {
                return null;
              }
            }
            const __ax_scriptUrl = ${JSON.stringify(scriptUrlStr)};
            const __ax_workerSrc = __ax_getWorkerCode(__ax_scriptUrl);
            if (__ax_workerSrc) {
              try {
                (0, eval)(__ax_workerSrc);
              } catch (err) {
                new Function(__ax_workerSrc)();
              }
            } else {
              try {
                importScripts(__ax_scriptUrl);
              } catch (e) {
                console.warn('[AX-Twitch] Worker importScripts fallback hatası:', e);
              }
            }
          })();
        `;

        const hookedBlob = new Blob([wrappedSource], { type: 'application/javascript' });
        const hookedUrl = origCreateObjectURL.call(URL, hookedBlob);
        console.info('[AX-Twitch] IVS Worker hook aktif');

        const worker = new OrigWorker(hookedUrl, options);
        activeWorkers.add(worker);

        // Listen for worker messages (auto-mute triggers & GQL bridge requests)
        worker.addEventListener('message', async (e) => {
          if (!e.data) return;
          if (e.data.type === 'AX_AD_MUTE_STATE') {
            handleAdMuteState(Boolean(e.data.active));
          } else if (e.data.type === 'AX_GQL_REQ') {
            const req = e.data;
            try {
              const res = await origWindowFetch(req.url, req.options);
              const body = await res.text();
              const headers = {};
              if (res.headers && typeof res.headers.forEach === 'function') {
                res.headers.forEach((v, k) => {
                  headers[k] = v;
                });
              }
              worker.postMessage({
                type: 'AX_GQL_RES',
                id: req.id,
                status: res.status,
                statusText: res.statusText,
                headers: headers,
                body: body
              });
            } catch (err) {
              worker.postMessage({
                type: 'AX_GQL_RES',
                id: req.id,
                error: err.message || 'Window fetch failed'
              });
            }
          }
        });

        // Send current active channel, captured headers and optional proxy immediately
        setTimeout(() => {
          try {
            const initialChannel = getActiveChannelFromLocation();
            if (initialChannel) {
              worker.postMessage({ type: 'AX_SET_CHANNEL', channel: initialChannel });
            }
            worker.postMessage({ type: 'AX_GQL_HEADERS', headers: capturedGqlHeaders });
            const initialProxy = window.localStorage.getItem('ax_privacy_twitch_proxy');
            if (initialProxy) {
              worker.postMessage({ type: 'AX_SET_PROXY_URL', proxyUrl: initialProxy });
            }
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

  // 7. Visual suppression of Twitch ad banners & overlay interrupts
  try {
    const style = document.createElement('style');
    style.id = 'ax-twitch-shield-css';
    style.textContent = `
      /* Hide all Twitch video ad overlays, banners, and interrupt layers */
      .ad-interrupt,
      [data-test-selector="ad-banner-default-text"],
      [data-test-selector="sad-overlay"],
      [data-test-selector="sda-wrapper"],
      [data-a-target="video-ad-label"],
      [data-a-target="video-ad-countdown"],
      [data-a-target="ad-feedback-button"],
      [data-a-target="player-overlay-ad"],
      [data-a-target="video-ad-overlay"],
      [data-a-target*="video-ad-"],
      .stream-display-ad__wrapper,
      .video-player__overlay [data-a-target*="video-ad-"],
      .video-player__overlay [data-a-target="player-overlay-ad"] {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }

      /* Guarantee that Twitch player controls, seekbars, settings, and buttons are ALWAYS interactive */
      .video-player__default-player,
      .video-player__default-player *,
      .player-controls,
      .player-controls *,
      [data-a-target="player-controls"],
      [data-a-target="player-controls"] *,
      [data-a-target="player-play-pause-button"],
      [data-a-target="player-fullscreen-button"],
      [data-a-target="player-settings-button"],
      [data-a-target="player-theatre-mode-button"],
      [data-a-target="player-volume-slider"],
      [data-a-target="player-settings-menu"],
      [data-a-target="player-settings-menu"] *,
      .player-settings-menu,
      .player-settings-menu *,
      .video-player button,
      .video-player [role="button"],
      .video-player [role="slider"],
      .video-player [role="menu"],
      .video-player [role="menuitem"],
      .video-player [role="menuitemradio"],
      .video-player [role="menuitemcheckbox"] {
        pointer-events: auto !important;
        cursor: pointer;
      }

      .video-player__default-player,
      .player-controls,
      [data-a-target="player-controls"] {
        z-index: 50 !important;
        position: relative !important;
      }

      [data-a-target="player-settings-menu"],
      .player-settings-menu,
      .video-player [role="menu"] {
        z-index: 99999 !important;
        pointer-events: auto !important;
        display: block !important;
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
