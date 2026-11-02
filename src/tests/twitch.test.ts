import { afterEach, describe, expect, it, vi } from 'vitest';
import { playlistTools, twitchWorkerHook } from '../engines/video/twitch.ts';

const tools = playlistTools();

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1"
https://cdn.example/1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360,FRAME-RATE=30.000,CODECS="avc1"
https://cdn.example/360.m3u8`;
const AD_MEDIA = `#EXTM3U
#EXT-X-DATERANGE:ID="stitched-ad",X-TV-TWITCH-AD-URL="https://ads.example/x"
#EXT-X-TWITCH-PREFETCH:https://ads.example/next.ts
#EXTINF:2.000,
https://ads.example/seg1.ts
#EXTINF:2.000,live
https://cdn.example/live1.ts`;
const CLEAN_MEDIA = `#EXTM3U
#EXTINF:2.000,live
https://cdn.example/live2.ts`;

describe('Twitch playlist tools', () => {
  it('reads variants with their resolution', () => {
    expect(tools.variants(MASTER)).toEqual([
      { url: 'https://cdn.example/1080.m3u8', resolution: '1920x1080', frameRate: '60.000' },
      { url: 'https://cdn.example/360.m3u8', resolution: '640x360', frameRate: '30.000' },
    ]);
  });

  it('strips only ad segments and hints', () => {
    const ads = new Set<string>();
    const out = tools.stripAds(AD_MEDIA, ads);
    expect([...ads]).toEqual(['https://ads.example/seg1.ts']);
    expect(out).toContain('https://cdn.example/live1.ts');
    expect(out).not.toContain('next.ts');
    expect(out).not.toContain('ads.example/x');
  });

  it('prefers the exact variant, else the nearest size', () => {
    const options = tools.variants(MASTER);
    const want = { url: '', resolution: '640x360', frameRate: '30.000' };
    expect(tools.closest(options, want)?.url).toContain('360');
    expect(tools.closest(options, { ...want, resolution: '1920x1200' })?.url).toContain('1080');
    expect(tools.closest([], want)).toBeNull();
  });
});

describe('Twitch worker hook', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
  });

  function hooked(routes: Record<string, string>) {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('data:')) return new Response('blank');
      if (url.includes('gql.twitch.tv')) {
        return new Response(
          JSON.stringify({ data: { streamPlaybackAccessToken: { signature: 's', value: 'v' } } }),
        );
      }
      const hit = Object.keys(routes).find((k) => url.includes(k));
      return hit ? new Response(routes[hit]) : new Response('', { status: 404 });
    }) as typeof fetch;
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('postMessage', vi.fn());
    twitchWorkerHook(tools);
    return { calls, fetch: globalThis.fetch };
  }

  it('serves the ad-free backup playlist during an ad, without credentials', async () => {
    const { calls, fetch: f } = hooked({
      'sig=': MASTER.replaceAll('cdn.example', 'backup.example'),
      '/channel/hls/': MASTER,
      'backup.example/1080.m3u8': CLEAN_MEDIA,
      'cdn.example/1080.m3u8': AD_MEDIA,
    });
    await f('https://usher.ttvnw.net/api/channel/hls/somebody.m3u8?a=1');
    const media = await (await f('https://cdn.example/1080.m3u8')).text();
    expect(media).toBe(CLEAN_MEDIA);
    expect(calls.some((u) => u.includes('gql.twitch.tv'))).toBe(true);
    expect(calls.some((u) => u.includes('sig=s') && u.includes('somebody.m3u8'))).toBe(true);
  });

  it('falls back to swapping ad segments when no player type is ad-free', async () => {
    const { fetch: f } = hooked({
      '/channel/hls/': MASTER,
      'usher.ttvnw.net': MASTER,
      'cdn.example/1080.m3u8': AD_MEDIA,
    });
    await f('https://usher.ttvnw.net/api/channel/hls/somebody.m3u8');
    const media = await (await f('https://cdn.example/1080.m3u8')).text();
    expect(media).toContain('live1.ts');
    expect(await (await f('https://ads.example/seg1.ts')).text()).toBe('blank');
  });

  it('leaves playlists without ads and unrelated requests untouched', async () => {
    const { fetch: f } = hooked({
      '/channel/hls/': MASTER,
      'cdn.example/360.m3u8': CLEAN_MEDIA,
      'other.example/x': 'x',
    });
    await f('https://usher.ttvnw.net/api/channel/hls/somebody.m3u8');
    expect(await (await f('https://cdn.example/360.m3u8')).text()).toBe(CLEAN_MEDIA);
    expect(await (await f('https://other.example/x')).text()).toBe('x');
  });
});
