import { describe, expect, it } from 'vitest';
import { pruneJwConfig, stripAdBreaks } from '../engines/video/generic.ts';

describe('pruneJwConfig', () => {
  it('drops the player and per-item ad schedules, nothing else', () => {
    const config = {
      file: 'a.m3u8',
      advertising: { client: 'vast', schedule: [] },
      playlist: [{ file: 'b.mp4', adschedule: [{ offset: 'pre' }] }, { file: 'c.mp4' }],
    };
    expect(pruneJwConfig(config)).toBe(true);
    expect(config).toEqual({ file: 'a.m3u8', playlist: [{ file: 'b.mp4' }, { file: 'c.mp4' }] });
    expect(pruneJwConfig(config)).toBe(false);
    expect(pruneJwConfig(null)).toBe(false);
    expect(pruneJwConfig('x')).toBe(false);
  });
});

describe('stripAdBreaks', () => {
  const head = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n';
  it('drops the segments between CUE-OUT and CUE-IN', () => {
    const list = `${head}#EXTINF:6,\nc1.ts\n#EXT-X-DISCONTINUITY\n#EXT-X-CUE-OUT:12\n#EXTINF:6,\nad1.ts\n#EXT-X-CUE-OUT-CONT:6/12\n#EXTINF:6,\nad2.ts\n#EXT-X-CUE-IN\n#EXT-X-DISCONTINUITY\n#EXTINF:6,\nc2.ts\n#EXT-X-ENDLIST`;
    const out = stripAdBreaks(list);
    expect(out).not.toContain('ad1.ts');
    expect(out).not.toContain('ad2.ts');
    expect(out).toContain('c1.ts');
    expect(out).toContain('c2.ts');
    expect(out).toContain('#EXT-X-ENDLIST');
  });
  it('drops interstitial and SCTE-35 date ranges', () => {
    const list = `${head}#EXT-X-DATERANGE:ID="ad1",CLASS="com.apple.hls.interstitial",X-ASSET-URI="https://ads.example/a.m3u8"\n#EXT-X-DATERANGE:ID="b",SCTE35-OUT=0xFC\n#EXT-X-DATERANGE:ID="chapter",START-DATE="2026-01-01"\n#EXTINF:6,\nc1.ts`;
    const out = stripAdBreaks(list);
    expect(out).not.toContain('interstitial');
    expect(out).not.toContain('SCTE35-OUT');
    expect(out).toContain('ID="chapter"');
  });
  it('leaves unmarked, master and all-ad playlists exactly as they were', () => {
    const plain = `${head}#EXTINF:6,\nc1.ts\n`;
    expect(stripAdBreaks(plain)).toBe(plain);
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8';
    expect(stripAdBreaks(master)).toBe(master);
    // A live window that is all ad: emptying it would stall the player, so keep it.
    const allAd = `${head}#EXT-X-CUE-OUT:30\n#EXTINF:6,\nad1.ts\n#EXTINF:6,\nad2.ts`;
    expect(stripAdBreaks(allAd)).toBe(allAd);
    expect(stripAdBreaks('not a playlist')).toBe('not a playlist');
  });
});
