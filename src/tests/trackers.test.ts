import { describe, expect, it } from 'vitest';
import {
  hasIdParam,
  learnedDomains,
  looksLikeId,
  MAX_TRACKERS,
  observe,
  prune,
  stateOf,
  TRACKER_TTL_MS,
  type TrackerRecord,
} from '../engines/brain/trackers.ts';

const sites = (n: number) => Array.from({ length: n }, (_, i) => `site${i}.com`);
const state = (m: Map<string, TrackerRecord>, d: string) => {
  const r = m.get(d);
  if (!r) throw new Error(`${d} not recorded`);
  return stateOf(r);
};

describe('AX-Brain layer 2: tracker learning', () => {
  it('watches, then drops cookies on 3 sites, then blocks on repeat', () => {
    const m = new Map<string, TrackerRecord>();
    const [a, b, c, d, e, f] = sites(6) as [string, string, string, string, string, string];
    expect(observe(m, 'trk.net', a, 'cookie', 1)).toBe(false);
    observe(m, 'trk.net', b, 'cookie', 2);
    expect(state(m, 'trk.net')).toBe('watch');
    expect(observe(m, 'trk.net', c, 'cookie', 3)).toBe(true);
    expect(state(m, 'trk.net')).toBe('cookie');
    for (const s of [d, e, f]) observe(m, 'trk.net', s, 'cookie', 4);
    // One kind of signal is not enough to block.
    expect(state(m, 'trk.net')).toBe('cookie');
    expect(observe(m, 'trk.net', a, 'id-param', 5)).toBe(true);
    expect(learnedDomains(m.values())).toEqual({ cookie: [], block: ['trk.net'] });
  });

  it('never learns first parties, protected or platform domains', () => {
    const m = new Map<string, TrackerRecord>();
    observe(m, 'a.com', 'a.com', 'cookie', 1);
    observe(m, 'stripe.com', 'a.com', 'cookie', 1);
    observe(m, 'youtube.com', 'a.com', 'cookie', 1);
    expect(m.size).toBe(0);
  });

  it('keeps needed CDNs at cookie-only', () => {
    const m = new Map<string, TrackerRecord>();
    for (const s of sites(8)) {
      observe(m, 'amazonaws.com', s, 'cookie', 1);
      observe(m, 'amazonaws.com', s, 'id-param', 1);
    }
    expect(state(m, 'amazonaws.com')).toBe('cookie');
  });

  it('forgets after 60 days and keeps at most 2,000 by last use', () => {
    const m = new Map<string, TrackerRecord>();
    observe(m, 'old.net', 'a.com', 'cookie', 0);
    for (let i = 0; i <= MAX_TRACKERS; i++) observe(m, `t${i}.net`, 'a.com', 'cookie', 10 + i);
    const now = TRACKER_TTL_MS + 5;
    const dropped = prune(m, now);
    expect(m.has('old.net')).toBe(false);
    expect(m.has('t0.net')).toBe(false);
    expect(m.size).toBe(MAX_TRACKERS);
    expect(dropped.map((r) => r.domain)).toEqual(['old.net', 't0.net']);
  });

  it('tells IDs from ordinary query values', () => {
    expect(looksLikeId('a8F3kL9qZ2xV7mN4pR1t')).toBe(true);
    expect(looksLikeId('1.2.3')).toBe(false);
    expect(looksLikeId('1700000000000000')).toBe(false);
    expect(looksLikeId('aaaaaaaaaaaaaaaa1')).toBe(false);
    expect(looksLikeId('international-news')).toBe(false);
    expect(hasIdParam('https://t.net/p?uid=a8F3kL9qZ2xV7mN4pR1t&v=2')).toBe(true);
    expect(hasIdParam('https://cdn.net/app.js?v=12')).toBe(false);
  });
});
