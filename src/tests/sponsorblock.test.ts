import { describe, expect, it } from 'vitest';
import {
  SPONSORBLOCK_API,
  hashPrefix,
  segmentsFor,
  segmentsUrl,
  skipTarget,
  videoIdFrom,
} from '../engines/video/sponsorblock.ts';

const ID = 'dQw4w9WgXcQ';

describe('hash prefix', () => {
  it('is the first 4 hex characters of SHA-256 and never contains the ID', async () => {
    // sha256("dQw4w9WgXcQ") = 5f6b0b4e…, computed independently with OpenSSL.
    expect(await hashPrefix(ID)).toBe('5f6b');
    const url = await segmentsUrl(ID);
    expect(url).toBe(
      `${SPONSORBLOCK_API}/api/skipSegments/5f6b?categories=${encodeURIComponent('["sponsor"]')}`,
    );
    expect(url).not.toContain(ID);
  });
});

describe('segmentsFor', () => {
  const body = [
    { videoID: 'otherVideo1', segments: [{ category: 'sponsor', segment: [1, 9] }] },
    {
      videoID: ID,
      segments: [
        { category: 'sponsor', actionType: 'skip', segment: [60, 90] },
        { category: 'sponsor', actionType: 'skip', segment: [10, 20.5] },
        { category: 'sponsor', actionType: 'mute', segment: [30, 40] },
        { category: 'selfpromo', actionType: 'skip', segment: [100, 110] },
        { category: 'sponsor', actionType: 'skip', segment: [200, 200.2] },
        { category: 'sponsor', segment: ['x', 5] },
        { category: 'sponsor', segment: [-1, 5] },
      ],
    },
  ];
  it("keeps only this video's sponsor skips, sorted", () => {
    expect(segmentsFor(body, ID)).toEqual([
      [10, 20.5],
      [60, 90],
    ]);
  });
  it('returns nothing for unknown videos or malformed bodies', () => {
    expect(segmentsFor(body, 'aaaaaaaaaaa')).toEqual([]);
    expect(segmentsFor({ videoID: ID }, ID)).toEqual([]);
    expect(segmentsFor(null, ID)).toEqual([]);
  });
});

describe('skipTarget', () => {
  const segs: [number, number][] = [
    [10, 20],
    [60, 90],
  ];
  it('seeks to the end of the segment once, then lets it play', () => {
    const done = new Set<number>();
    expect(skipTarget(5, segs, done)).toBeNull();
    expect(skipTarget(10.2, segs, done)).toBe(20);
    expect(skipTarget(12, segs, done)).toBeNull();
    expect(skipTarget(61, segs, done)).toBe(90);
  });
  it('does not skip in the last half second', () => {
    expect(skipTarget(19.7, segs, new Set())).toBeNull();
  });
});

describe('videoIdFrom', () => {
  it('reads watch and embed pages only', () => {
    expect(videoIdFrom(`https://www.youtube.com/watch?v=${ID}&t=3`)).toBe(ID);
    expect(videoIdFrom(`https://www.youtube-nocookie.com/embed/${ID}?x=1`)).toBe(ID);
    expect(videoIdFrom(`https://www.youtube.com/shorts/${ID}`)).toBeNull();
    expect(videoIdFrom('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(videoIdFrom('not a url')).toBeNull();
  });
});
