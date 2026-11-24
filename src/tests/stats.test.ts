import { describe, expect, it, vi } from 'vitest';
import {
  HOST_PREFIX,
  classifyRulesets,
  daysAgo,
  estimateSavings,
  eachDay,
  summarize,
  localDay,
} from '../engines/core/stats.ts';
import { StatsRecorder, parseStatsDump } from '../background/stats.ts';

describe('calendar helpers', () => {
  it('walks UTC days inclusive', () => {
    expect(localDay(new Date(2026, 10, 1, 23, 30).getTime())).toBe('2026-11-01');
    expect(localDay(new Date(2026, 10, 2, 0, 30).getTime())).toBe('2026-11-02');
    expect(daysAgo(1, '2026-11-01')).toBe('2026-10-31');
    expect(eachDay('2026-10-30', '2026-11-01')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
});

describe('classifyRulesets', () => {
  it('uses list category, with security then privacy then ads', () => {
    expect(classifyRulesets([])).toBeNull();
    expect(classifyRulesets(['easylist'])).toBe('ads');
    expect(classifyRulesets(['ublock', 'adguard-tr'])).toBe('ads');
    expect(classifyRulesets(['easyprivacy'])).toBe('trackers');
    expect(classifyRulesets(['easylist', 'easyprivacy'])).toBe('trackers');
    expect(classifyRulesets(['urlhaus', 'easylist'])).toBe('security');
    expect(classifyRulesets(['_dynamic'])).toBe('other');
    expect(classifyRulesets(['Online Malicious URL Blocklist (URLhaus, alan adları)'])).toBe(
      'security',
    );
  });
});

describe('summarize', () => {
  it('fills empty days and ranks hosts', () => {
    const view = summarize(
      [
        { day: '2026-11-01', category: 'ads', count: 3 },
        { day: '2026-11-01', category: `${HOST_PREFIX}ads.example`, count: 2 },
        { day: '2026-11-01', category: `${HOST_PREFIX}track.example`, count: 5 },
        { day: '2026-11-03', category: 'pages', count: 1 },
        { day: '2026-10-01', category: 'ads', count: 99 },
      ],
      '2026-11-01',
      '2026-11-03',
      [
        {
          at: Date.parse('2026-11-02T00:00:00Z'),
          kind: 'page',
          url: 'https://bad.example/',
          list: 'urlhaus',
        },
        { at: Date.parse('2026-10-01T00:00:00Z'), kind: 'popup', url: 'https://old.example/' },
      ],
    );
    expect(view.days[0]).toMatchObject({ day: '2026-11-01', ads: 3, trackers: 0, pages: 0 });
    expect(view.days[1]?.ads).toBe(0);
    expect(view.days[2]?.pages).toBe(1);
    expect(view.totals.ads).toBe(3);
    expect(view.totals.pages).toBe(1);
    expect(view.totals.requests).toBe(3);
    expect(view.topHosts).toEqual([
      { host: 'track.example', count: 5 },
      { host: 'ads.example', count: 2 },
    ]);
    expect(view.events).toHaveLength(1);
  });
});

describe('parseStatsDump', () => {
  it('keeps well-formed rows and drops the rest', () => {
    expect(parseStatsDump(null)).toBeNull();
    expect(parseStatsDump({ rows: [], events: [] })).toEqual({ rows: [], events: [] });
    const dump = parseStatsDump({
      rows: [
        { day: '2026-11-01', category: 'ads', count: 2 },
        { day: 1, category: 'ads', count: 2 },
      ],
      events: [
        { at: 1, kind: 'page', url: 'https://a.example/' },
        { at: 1, kind: 'page' },
      ],
    });
    expect(dump?.rows).toEqual([{ day: '2026-11-01', category: 'ads', count: 2 }]);
    expect(dump?.events).toEqual([{ at: 1, kind: 'page', url: 'https://a.example/' }]);
  });
});

describe('private windows', () => {
  it('counts blocked pages and ad tabs but keeps their addresses out of the log', async () => {
    vi.useFakeTimers();
    const set = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { storage: { local: { get: () => Promise.resolve({}), set } } });
    const settle = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    const stats = new StatsRecorder();
    stats.popup('https://ads.example/', true);
    stats.page('https://bad.example/', 'easylist', true);
    await settle();
    expect(set).not.toHaveBeenCalled();
    stats.popup('https://ads.example/');
    await settle();
    expect(set).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe('savings estimate', () => {
  it('adds request sizes over the line speed and the time pop-ups and notices take', () => {
    const r = estimateSavings({
      ads: 100,
      trackers: 200,
      security: 0,
      other: 0,
      pages: 0,
      popups: 2,
      consent: 1,
    });
    expect(r.bytes).toBe(100 * 30_000 + 200 * 5_000);
    expect(r.seconds).toBe(Math.round(4_000_000 / 1_250_000 + 10 + 3));
  });
});
