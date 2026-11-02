import { describe, expect, it } from 'vitest';
import { pruneAds } from '../engines/video/youtube.ts';

const ad = (isAd: boolean) => ({
  command: { reelWatchEndpoint: { videoId: isAd ? 'ad' : 'v', adClientParams: { isAd } } },
});

describe('pruneAds', () => {
  it('drops ad schedules from player responses and keeps the video', () => {
    const r = {
      videoDetails: { videoId: 'abc' },
      streamingData: { formats: [1] },
      adPlacements: [{}],
      adSlots: [{}],
      playerAds: [{}],
      adBreakHeartbeatParams: 'x',
    };
    expect(pruneAds(r)).toBe(true);
    expect(r).toEqual({ videoDetails: { videoId: 'abc' }, streamingData: { formats: [1] } });
  });

  it('handles nested playerResponse and watch-page arrays', () => {
    const page = [{ page: 'watch' }, { playerResponse: { adPlacements: [], videoDetails: {} } }];
    expect(pruneAds(page)).toBe(true);
    expect(page[1]).toEqual({ playerResponse: { videoDetails: {} } });
  });

  it('removes Shorts ad entries only', () => {
    const top = { entries: [ad(false), ad(true), {}] };
    const nested = { reelWatchSequenceResponse: { entries: [ad(true)] } };
    expect(pruneAds(top)).toBe(true);
    expect(pruneAds(nested)).toBe(true);
    expect(top.entries).toEqual([ad(false), {}]);
    expect(nested.reelWatchSequenceResponse.entries).toEqual([]);
  });

  it('leaves unrelated values untouched', () => {
    for (const v of [null, 1, 'adPlacements', [], { a: 1 }, { entries: [ad(false)] }]) {
      const before = structuredClone(v);
      expect(pruneAds(v)).toBe(false);
      expect(v).toEqual(before);
    }
  });
});
