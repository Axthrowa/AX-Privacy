import { describe, expect, it, vi } from 'vitest';
import { TabReports } from '../background/tab-report.ts';

function memoryStore() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: vi.fn(async (k: string) => structuredClone(data.get(k)) as never),
    set: vi.fn(async (k: string, v: unknown) => void data.set(k, structuredClone(v))),
    remove: vi.fn(async (k: string) => void data.delete(k)),
  };
}

describe('TabReports', () => {
  it('counts loaded and blocked requests per host and splits first from third party', async () => {
    const onBlocked = vi.fn();
    const r = new TabReports(memoryStore(), onBlocked);
    r.navigated(1, 'https://www.news.example/article');
    await r.request(1, 'https://cdn.news.example/app.js');
    await r.request(1, 'https://tracker.test/p.gif', 'net::ERR_BLOCKED_BY_CLIENT');
    await r.request(1, 'https://tracker.test/q.gif', 'net::ERR_BLOCKED_BY_CLIENT');
    await r.request(1, 'https://fonts.test/a.woff2');
    await r.request(1, 'https://flaky.test/x', 'net::ERR_CONNECTION_RESET');
    expect(await r.report(1)).toEqual({
      site: 'news.example',
      url: 'https://www.news.example/article',
      consent: null,
      insecurePassword: false,
      hosts: [
        { host: 'tracker.test', thirdParty: true, loaded: 0, blocked: 2 },
        { host: 'fonts.test', thirdParty: true, loaded: 1, blocked: 0 },
        // Seen but neither loaded nor blocked: a network error is not a block.
        { host: 'flaky.test', thirdParty: true, loaded: 0, blocked: 0 },
        { host: 'cdn.news.example', thirdParty: false, loaded: 1, blocked: 0 },
      ],
    });
    expect(onBlocked).toHaveBeenCalledTimes(2);
    expect(onBlocked).toHaveBeenCalledWith('tracker.test');
  });

  it('starts over on navigation and survives a service worker restart', async () => {
    const store = memoryStore();
    const a = new TabReports(store);
    a.navigated(2, 'https://a.example/');
    await a.request(2, 'https://t.test/x');
    await a.consent(2, { cmp: 'Onetrust', result: true });
    await a.insecurePassword(2);
    await a.flush();

    const b = new TabReports(store);
    expect((await b.report(2)).hosts).toHaveLength(1);
    expect((await b.report(2)).consent).toEqual({ cmp: 'Onetrust', result: true });
    expect((await b.report(2)).insecurePassword).toBe(true);

    b.navigated(2, 'https://b.example/');
    expect(await b.report(2)).toEqual({
      site: 'b.example',
      url: 'https://b.example/',
      hosts: [],
      consent: null,
      insecurePassword: false,
    });
    await b.closed(2);
    expect(store.data.size).toBe(0);
  });

  it('keeps a successful opt-out when another frame fails', async () => {
    const r = new TabReports(memoryStore());
    r.navigated(3, 'https://a.example/');
    await r.consent(3, { cmp: 'X', result: true });
    await r.consent(3, { cmp: 'Y', result: false });
    expect((await r.report(3)).consent).toEqual({ cmp: 'X', result: true });
  });
});
