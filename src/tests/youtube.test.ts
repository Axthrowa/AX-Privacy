import { describe, expect, it } from 'vitest';
import { pruneAds, pruneAdsText, sponsoredCss, YT_DATA } from '../engines/video/youtube.ts';

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

describe('YouTube data file', () => {
  it('holds only names and plain selectors, no code', () => {
    const field = /^[A-Za-z]\w*$/;
    const path = /^\/[\w/]+$/;
    // Element names, classes and simple descendant steps; no braces, quotes, URLs or scripts.
    const selector = /^[a-z][\w-]*$|^(\.[\w-]+|[a-z][\w-]*)( (\.[\w-]+|[a-z][\w-]*))*$/;
    expect(YT_DATA.playerKeys.every((k) => field.test(k))).toBe(true);
    expect(YT_DATA.xhrPaths.every((p) => path.test(p))).toBe(true);
    for (const list of [
      YT_DATA.skipButtons,
      YT_DATA.blockerWarning,
      YT_DATA.cardContainers,
      YT_DATA.cardAdMarkers,
      YT_DATA.cardNested,
    ]) {
      expect(list.length).toBeGreaterThan(0);
      for (const s of list) expect(s).toMatch(selector);
    }
  });
});

describe('pruneAdsText', () => {
  it('prunes a player response read as text, keeping the guard line', () => {
    const body = { videoDetails: { videoId: 'x' }, adPlacements: [1], playerAds: [] };
    expect(JSON.parse(pruneAdsText(JSON.stringify(body)))).toEqual({
      videoDetails: { videoId: 'x' },
    });
    const guarded = pruneAdsText(`)]}'\n${JSON.stringify(body)}`);
    expect(guarded.startsWith(`)]}'\n`)).toBe(true);
    expect(JSON.parse(guarded.slice(5))).toEqual({ videoDetails: { videoId: 'x' } });
  });
  it('returns anything else unchanged, byte for byte', () => {
    const plain = '{ "videoDetails": {"videoId": "x"} }';
    expect(pruneAdsText(plain)).toBe(plain);
    expect(pruneAdsText('not json')).toBe('not json');
    expect(pruneAdsText('')).toBe('');
  });
});

describe('sponsoredCss', () => {
  it('marks or hides the same cards', () => {
    const mark = sponsoredCss('mark');
    const hide = sponsoredCss('hide');
    for (const css of [mark, hide]) {
      expect(css).toContain(':has(ytd-ad-slot-renderer');
      expect(css).not.toMatch(/url\(|@import|expression/);
    }
    expect(mark).toContain("content: 'Sponsorlu · AX'");
    expect(mark).not.toContain('display: none');
    expect(hide).toContain('display: none !important');
  });
});
