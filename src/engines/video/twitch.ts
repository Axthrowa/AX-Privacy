/**
 * Twitch stitches ads into the HLS playlist the player's worker downloads. Same idea as Twitch
 * Adblock / TwitchAdSolutions (MIT, pixeltris), rewritten: during an ad the worker gets the playlist
 * of an ad-free player type instead, or failing that the ad segments are swapped for an empty clip.
 * No session is reused: backup playlists are requested anonymously, with no login token or cookie.
 *
 * Both functions below are serialized into the worker, so they may only use their own scope.
 */

export interface Variant {
  url: string;
  resolution: string;
  frameRate: string;
}

export function playlistTools() {
  const lines = (m3u8: string) => m3u8.replaceAll('\r', '').split('\n');
  const attr = (line: string, name: string) =>
    new RegExp(`[:,]${name}=("[^"]*"|[^,]*)`).exec(line)?.[1]?.replaceAll('"', '') ?? '';
  return {
    hasAds: (m3u8: string) => m3u8.includes('stitched'),

    /** Remembers ad segment URLs (the fetch hook answers them) and drops ad prefetch hints. */
    stripAds(m3u8: string, adUrls: Set<string>): string {
      const rows = lines(m3u8);
      return rows
        .map((row, i) => {
          const next = rows[i + 1];
          if (row.startsWith('#EXTINF') && !row.includes(',live') && next) adUrls.add(next);
          if (row.startsWith('#EXT-X-TWITCH-PREFETCH:')) return '';
          return row.replace(/(X-TV-TWITCH-AD-[A-Z-]*URL=")[^"]*"/g, '$1https://twitch.tv"');
        })
        .join('\n');
    },

    variants(master: string): Variant[] {
      const rows = lines(master);
      const out: Variant[] = [];
      rows.forEach((row, i) => {
        const url = rows[i + 1];
        if (row.startsWith('#EXT-X-STREAM-INF') && url?.includes('.m3u8')) {
          out.push({
            url,
            resolution: attr(row, 'RESOLUTION'),
            frameRate: attr(row, 'FRAME-RATE'),
          });
        }
      });
      return out;
    },

    /** Same resolution and frame rate if offered, else the closest picture size. */
    closest(options: readonly Variant[], want: Variant): Variant | null {
      const size = (v: Variant) => v.resolution.split('x').reduce((a, b) => a * Number(b), 1);
      const ranked = [...options].sort(
        (a, b) => Math.abs(size(a) - size(want)) - Math.abs(size(b) - size(want)),
      );
      return (
        options.find((v) => v.resolution === want.resolution && v.frameRate === want.frameRate) ??
        ranked[0] ??
        null
      );
    },
  };
}

/** Runs first inside the player's worker. */
export function twitchWorkerHook(tools: ReturnType<typeof playlistTools>): void {
  // A silent empty fMP4, so the player keeps its timeline while an ad segment would have played.
  const BLANK =
    'data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA';
  // Twitch's public web client ID and the query of its own player; no account is involved.
  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const TOKEN_QUERY = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
  const BACKUP_PLAYERS = ['embed', 'popout', 'autoplay'];
  const MAX_AD_URLS = 300;

  interface Stream {
    login: string;
    params: string;
    showingAd: boolean;
    backups: Map<string, string>;
  }
  const nativeFetch = self.fetch.bind(self);
  const adUrls = new Set<string>();
  const streams = new Map<string, { stream: Stream; variant: Variant }>();
  const deviceId = crypto.randomUUID().replaceAll('-', '');

  async function backupMaster(stream: Stream, player: string): Promise<string | null> {
    const cached = stream.backups.get(player);
    if (cached) return cached;
    const gql = await nativeFetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Client-ID': CLIENT_ID, 'X-Device-Id': deviceId },
      body: JSON.stringify({
        operationName: 'PlaybackAccessToken',
        variables: {
          isLive: true,
          login: stream.login,
          isVod: false,
          vodID: '',
          playerType: player,
          platform: player === 'autoplay' ? 'android' : 'web',
        },
        extensions: { persistedQuery: { version: 1, sha256Hash: TOKEN_QUERY } },
      }),
    });
    if (!gql.ok) return null;
    const token = ((await gql.json()) as { data?: { streamPlaybackAccessToken?: never } }).data
      ?.streamPlaybackAccessToken as { signature: string; value: string } | undefined;
    if (!token) return null;
    const url = new URL(
      `https://usher.ttvnw.net/api/channel/hls/${stream.login}.m3u8${stream.params}`,
    );
    url.searchParams.set('sig', token.signature);
    url.searchParams.set('token', token.value);
    const res = await nativeFetch(url.href);
    if (!res.ok) return null;
    const master = await res.text();
    stream.backups.set(player, master);
    return master;
  }

  async function adFree(stream: Stream, variant: Variant): Promise<string | null> {
    for (const player of BACKUP_PLAYERS) {
      try {
        const master = await backupMaster(stream, player);
        const pick = master && tools.closest(tools.variants(master), variant);
        if (!pick) continue;
        const res = await nativeFetch(pick.url);
        const media = res.ok ? await res.text() : '';
        if (media && !tools.hasAds(media)) return media;
      } catch {
        // Next player type; the segment swap below still removes the ad.
      }
    }
    return null;
  }

  async function cleanMedia(url: string, text: string): Promise<string> {
    const known = streams.get(url);
    if (!known) return text;
    const { stream, variant } = known;
    if (!tools.hasAds(text)) {
      if (stream.showingAd) {
        stream.showingAd = false;
        stream.backups.clear();
        // The player drifts behind live on a different playlist; the page jumps it back.
        self.postMessage({ nexusTwitch: 'ad-end' });
      }
      return text;
    }
    stream.showingAd = true;
    const clean = (await adFree(stream, variant)) ?? tools.stripAds(text, adUrls);
    for (const old of adUrls) {
      if (adUrls.size <= MAX_AD_URLS) break;
      adUrls.delete(old);
    }
    return clean;
  }

  self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = (
      typeof input === 'string' ? input : String((input as Request).url ?? input)
    ).trim();
    if (adUrls.has(url)) return nativeFetch(BLANK);
    if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
      const res = await nativeFetch(input, init);
      if (!res.ok) return res;
      const master = await res.clone().text();
      const parsed = new URL(url);
      const stream: Stream = {
        login: /([^/]+)\.m3u8$/.exec(parsed.pathname)?.[1] ?? '',
        params: parsed.search,
        showingAd: false,
        backups: new Map(),
      };
      for (const variant of tools.variants(master)) streams.set(variant.url, { stream, variant });
      return res;
    }
    if (streams.has(url)) {
      const res = await nativeFetch(input, init);
      if (!res.ok) return res;
      return new Response(await cleanMedia(url, await res.text()), {
        status: res.status,
        headers: res.headers,
      });
    }
    return nativeFetch(input, init);
  };
}
