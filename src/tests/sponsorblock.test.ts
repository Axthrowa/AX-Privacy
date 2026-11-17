import { describe, expect, it } from 'vitest';
import {
  SPONSORBLOCK_API,
  hashPrefix,
  matchingDuration,
  planFor,
  segmentAt,
  segmentsFor,
  segmentsUrl,
  videoIdFrom,
} from '../engines/video/sponsorblock.ts';
import {
  channelKey,
  channelList,
  DEFAULT_SPONSOR_MODES,
  SPONSOR_CATEGORIES,
} from '../shared/sponsor.ts';

const ID = 'dQw4w9WgXcQ';

describe('hash prefix', () => {
  it('is the first 4 hex characters of SHA-256 and never contains the ID', async () => {
    // sha256("dQw4w9WgXcQ") = 5f6b0b4e…, computed independently with OpenSSL.
    expect(await hashPrefix(ID)).toBe('5f6b');
    const url = new URL(await segmentsUrl(ID));
    expect(`${url.origin}${url.pathname}`).toBe(`${SPONSORBLOCK_API}/api/skipSegments/5f6b`);
    // The same categories for everyone: the URL does not tell the server what a user switched on.
    expect(JSON.parse(url.searchParams.get('categories') ?? '')).toEqual([...SPONSOR_CATEGORIES]);
    expect(JSON.parse(url.searchParams.get('actionTypes') ?? '')).toEqual([
      'skip',
      'mute',
      'full',
      'poi',
      'chapter',
    ]);
    expect(url.href).not.toContain(ID);
  });
});

describe('segmentsFor', () => {
  const body = [
    { videoID: 'otherVideo1', segments: [{ category: 'sponsor', segment: [1, 9] }] },
    {
      videoID: ID,
      segments: [
        { category: 'sponsor', actionType: 'skip', segment: [60, 90], videoDuration: 212 },
        { category: 'sponsor', actionType: 'skip', segment: [10, 20.5] },
        { category: 'selfpromo', actionType: 'mute', segment: [30, 40] },
        { category: 'poi_highlight', actionType: 'poi', segment: [100, 100] },
        { category: 'exclusive_access', actionType: 'full', segment: [0, 0] },
        { category: 'sponsor', actionType: 'skip', segment: [200, 200.2] },
        { category: 'sponsor', actionType: 'launch', segment: [1, 5] },
        { category: 'unknown', segment: [1, 5] },
        { category: 'sponsor', segment: ['x', 5] },
        { category: 'sponsor', segment: [-1, 5] },
        { category: 'sponsor', segment: [9, 5] },
      ],
    },
  ];
  it("keeps this video's well-formed segments of known kinds, sorted", () => {
    expect(segmentsFor(body, ID)).toEqual([
      { start: 0, end: 0, category: 'exclusive_access', action: 'full', duration: 0 },
      { start: 10, end: 20.5, category: 'sponsor', action: 'skip', duration: 0 },
      { start: 30, end: 40, category: 'selfpromo', action: 'mute', duration: 0 },
      { start: 60, end: 90, category: 'sponsor', action: 'skip', duration: 212 },
      { start: 100, end: 100, category: 'poi_highlight', action: 'poi', duration: 0 },
    ]);
  });
  it('returns nothing for unknown videos or malformed bodies', () => {
    expect(segmentsFor(body, 'aaaaaaaaaaa')).toEqual([]);
    expect(segmentsFor({ videoID: ID }, ID)).toEqual([]);
    expect(segmentsFor(null, ID)).toEqual([]);
  });
});

describe('planFor and matchingDuration', () => {
  const seg = (category: 'sponsor' | 'hook' | 'intro', duration = 0) => ({
    start: 1,
    end: 5,
    category,
    action: 'skip' as const,
    duration,
  });
  it('drops categories switched off and carries each mode', () => {
    expect(planFor([seg('sponsor'), seg('hook'), seg('intro')], DEFAULT_SPONSOR_MODES)).toEqual([
      { ...seg('sponsor'), mode: 'auto' },
      { ...seg('intro'), mode: 'manual' },
    ]);
  });
  it('drops segments made for a video more than 2 seconds longer or shorter', () => {
    const list = [seg('sponsor', 300), seg('sponsor', 301.5), seg('sponsor', 310), seg('sponsor')];
    expect(matchingDuration(list, 300.4)).toEqual([list[0], list[1], list[3]]);
    expect(matchingDuration(list, NaN)).toEqual(list);
  });
});

describe('segmentAt', () => {
  const segs = [
    { start: 10, end: 20 },
    { start: 60, end: 90 },
  ];
  it('finds the segment once, skips handled ones and leaves the last half second', () => {
    expect(segmentAt(5, segs, new Set())).toBeNull();
    expect(segmentAt(10.2, segs, new Set())).toBe(0);
    expect(segmentAt(12, segs, new Set([0]))).toBeNull();
    expect(segmentAt(61, segs, new Set([0]))).toBe(1);
    expect(segmentAt(19.7, segs, new Set())).toBeNull();
  });
});

describe('videoIdFrom', () => {
  it('reads watch (YouTube Music too) and embed pages only', () => {
    expect(videoIdFrom(`https://www.youtube.com/watch?v=${ID}&t=3`)).toBe(ID);
    expect(videoIdFrom(`https://music.youtube.com/watch?v=${ID}&list=x`)).toBe(ID);
    expect(videoIdFrom(`https://www.youtube-nocookie.com/embed/${ID}?x=1`)).toBe(ID);
    expect(videoIdFrom(`https://www.youtube.com/shorts/${ID}`)).toBeNull();
    expect(videoIdFrom('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(videoIdFrom('not a url')).toBeNull();
  });
});

describe('channel exceptions', () => {
  it('stores handles in lower case and channel IDs as they are', () => {
    expect(channelKey('@SomeOne')).toBe('@someone');
    expect(channelKey('https://www.youtube.com/@Some.One_1/videos')).toBe('@some.one_1');
    expect(channelKey('/channel/UCabcdefghijklmnopqrstuv')).toBe('UCabcdefghijklmnopqrstuv');
    expect(channelKey('someone')).toBeNull();
    expect(channelKey('@ab')).toBeNull();
    expect(channelList(['@a1b', '@A1B', 'x', 3])).toEqual(['@a1b']);
  });
});
