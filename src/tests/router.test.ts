import { describe, expect, it, vi } from 'vitest';
import {
  BRIEF_PAUSE_MS,
  createRouter,
  MAX_USER_LISTS,
  type SenderContext,
} from '../background/router.ts';
import type { ListsView, Settings } from '../shared/types.ts';
import { defaultSettings } from '../storage/settings.ts';

function setup(initial: Partial<Settings> = {}) {
  let stored: Settings = { ...defaultSettings(), ...initial };
  const deps = {
    updateLists: vi.fn(async () => undefined),
    schedulePauseEnd: vi.fn(async () => undefined),
    startPicker: vi.fn<(tabId: number) => Promise<void>>(async () => undefined),
    takePicker: vi.fn<(tabId: number) => Promise<boolean>>(async () => false),
    load: vi.fn(async () => structuredClone(stored)),
    save: vi.fn(async (s: Settings) => {
      stored = structuredClone(s);
    }),
    apply: vi.fn(async () => undefined),
    applyFilters: vi.fn(async () => undefined),
    listsView: vi.fn(
      async (s: Settings) => ({ enabledLists: s.enabledLists }) as unknown as ListsView,
    ),
    refreshUserList: vi.fn(async () => undefined),
    forgetUserList: vi.fn(async () => undefined),
    customRulesReport: vi.fn(async () => ({ network: 0, cosmetic: 0, rejected: [] })),
    cosmeticStart: vi.fn(async () => [{ id: 1, ast: {} }]),
    cosmeticDom: vi.fn(async () => []),
    noteUserOpen: vi.fn(),
    tabReport: vi.fn(async () => ({
      site: null,
      url: null,
      hosts: [],
      consent: null,
      risk: { level: 'none' as const, findings: [] },
    })),
    consent: vi.fn(async () => ({ type: 'initResp' })),
    proceed: vi.fn(async () => undefined),
    pageList: vi.fn(async (): Promise<string | null> => 'Özel kurallar'),
    insecurePassword: vi.fn(async () => undefined),
    sponsorSegments: vi.fn(async (): Promise<[number, number][]> => [[1, 5]]),
    statsView: vi.fn(async () => ({
      days: [],
      totals: {
        ads: 0,
        trackers: 0,
        security: 0,
        other: 0,
        pages: 0,
        popups: 0,
        consent: 0,
        requests: 0,
      },
      topHosts: [],
      events: [],
    })),
    clearStats: vi.fn(async () => ({
      days: [],
      totals: {
        ads: 0,
        trackers: 0,
        security: 0,
        other: 0,
        pages: 0,
        popups: 0,
        consent: 0,
        requests: 0,
      },
      topHosts: [],
      events: [],
    })),
    exportSettings: vi.fn((s: Settings) => ({
      nexus: 1 as const,
      exportedAt: 't',
      settings: { ...s, isBrave: undefined } as never,
    })),
    restoreStats: vi.fn(async () => undefined),
    importSettings: vi.fn((raw: unknown, current: Settings) => {
      const r = raw as { nexus?: number; settings?: Partial<Settings> };
      if (r.nexus !== 1 || !r.settings) return null;
      return { ...current, ...r.settings };
    }),
  };
  return { route: createRouter(deps), deps, get: () => stored };
}

const ui: SenderContext = { kind: 'ui', url: 'chrome-extension://x/popup.html' };
const page = (url: string, tabUrl = url): SenderContext => ({ kind: 'content', url, tabUrl });

describe('router', () => {
  it('reports popup state for the current site', async () => {
    const { route } = setup({ pausedSites: ['example.com'] });
    await expect(
      route({ type: 'popup/state', url: 'https://www.example.com/a' }, ui),
    ).resolves.toEqual({
      enabled: true,
      site: 'example.com',
      paused: true,
      isBrave: null,
    });
  });

  it('pauses and resumes a site, applying only control state', async () => {
    const { route, deps, get } = setup();
    await route({ type: 'site/setPaused', site: 'b.com', paused: true }, ui);
    await route({ type: 'site/setPaused', site: 'a.com', paused: true }, ui);
    await route({ type: 'site/setPaused', site: 'a.com', paused: true }, ui);
    expect(get().pausedSites).toEqual(['a.com', 'b.com']);
    await route({ type: 'site/setPaused', site: 'b.com', paused: false }, ui);
    expect(get().pausedSites).toEqual(['a.com']);
    expect(deps.apply).toHaveBeenCalledTimes(4);
    expect(deps.applyFilters).not.toHaveBeenCalled();
  });

  it('stores a site profile and drops an all-on one', async () => {
    const { route, deps, get } = setup();
    await route({ type: 'site/setProfile', site: 'a.com', profile: { network: false } }, ui);
    expect(get().siteProfiles['a.com']).toEqual({
      network: false,
      privacy: true,
      video: true,
      security: true,
    });
    expect(deps.apply).toHaveBeenCalledOnce();
    await route({ type: 'site/setProfile', site: 'a.com', profile: { network: true } }, ui);
    expect(get().siteProfiles).toEqual({});
  });

  it('serializes concurrent updates without losing writes', async () => {
    const { route, get } = setup();
    await Promise.all(
      ['a.com', 'b.com', 'c.com', 'd.com'].map((site) =>
        route({ type: 'site/setPaused', site, paused: true }, ui),
      ),
    );
    expect(get().pausedSites).toEqual(['a.com', 'b.com', 'c.com', 'd.com']);
  });

  it('keeps working after a failed apply', async () => {
    const { route, deps, get } = setup();
    deps.apply.mockRejectedValueOnce(new Error('quota'));
    await expect(route({ type: 'global/set', enabled: false }, ui)).rejects.toThrow('quota');
    await route({ type: 'site/setPaused', site: 'a.com', paused: true }, ui);
    expect(get().pausedSites).toEqual(['a.com']);
  });

  it('stores custom rules and applies filters, not control state', async () => {
    const { route, deps, get } = setup();
    await route({ type: 'rules/setCustom', text: '##.ad\n||ads.example^' }, ui);
    expect(get().customRules).toBe('##.ad\n||ads.example^');
    expect(deps.applyFilters).toHaveBeenCalledOnce();
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.customRulesReport).toHaveBeenCalledWith(get());
  });

  it('saves one picked rule only after the popup started the picker, in the top frame', async () => {
    let armed = false;
    const { route, deps, get } = setup();
    deps.startPicker.mockImplementation(async () => {
      armed = true;
    });
    deps.takePicker.mockImplementation(async () => {
      const was = armed;
      armed = false;
      return was;
    });
    const content = {
      kind: 'content',
      url: 'https://a.example/',
      tabUrl: 'https://a.example/',
      tabId: 5,
      frameId: 0,
    } as SenderContext;
    const msg = { type: 'picker/add', selector: '.ad' } as const;

    await expect(route(msg, content)).rejects.toThrow('başlatılmamış');
    expect(get().customRules).toBe('');
    await expect(route({ type: 'picker/start', tabId: 5 }, content)).rejects.toThrow('not allowed');

    await route({ type: 'picker/start', tabId: 5 }, ui);
    await expect(route({ type: 'picker/add', selector: '.a{}' }, content)).rejects.toThrow('kural');
    await expect(route(msg, { ...content, frameId: 3 })).rejects.toThrow('başlatılmamış');
    expect(armed).toBe(true);
    await route(msg, content);
    expect(get().customRules).toBe('a.example##.ad');
    expect(deps.applyFilters).toHaveBeenCalled();
    await expect(route(msg, content)).rejects.toThrow('başlatılmamış');
  });

  it('pauses a site for a while and brings protection back by itself', async () => {
    const { route, deps, get } = setup();
    await route({ type: 'site/pauseBriefly', site: 'a.example' }, ui);
    expect(get().pausedSites).toEqual(['a.example']);
    expect(deps.schedulePauseEnd).toHaveBeenCalledExactlyOnceWith(get().pauseUntil['a.example']);

    await route({ type: 'site/expirePauses' }, ui);
    expect(get().pausedSites).toEqual(['a.example']);

    vi.useFakeTimers({ now: Date.now() + BRIEF_PAUSE_MS + 1 });
    try {
      await route({ type: 'site/expirePauses' }, ui);
    } finally {
      vi.useRealTimers();
    }
    expect(get().pausedSites).toEqual([]);
    expect(get().pauseUntil).toEqual({});
  });

  it('keeps a pause the user chose, even over a temporary one', async () => {
    const { route, get } = setup();
    await route({ type: 'site/pauseBriefly', site: 'a.example' }, ui);
    await route({ type: 'site/setPaused', site: 'a.example', paused: true }, ui);
    expect(get().pauseUntil).toEqual({});
    await route({ type: 'site/expirePauses' }, ui);
    expect(get().pausedSites).toEqual(['a.example']);
  });

  it('removes one custom rule, and only from the extension UI', async () => {
    const { route, deps, get } = setup({ customRules: 'a.example##.x\nb.example##.y' });
    await expect(
      route({ type: 'rules/removeLine', line: 'a.example##.x' }, page('https://a.example/')),
    ).rejects.toThrow('not allowed');
    await route({ type: 'rules/removeLine', line: 'a.example##.x' }, ui);
    expect(get().customRules).toBe('b.example##.y');
    expect(deps.applyFilters).toHaveBeenCalled();
  });

  it('toggles built-in lists and rejects unknown ids', async () => {
    const { route, deps, get } = setup();
    await route({ type: 'lists/setEnabled', id: 'ublock', enabled: false }, ui);
    expect(get().enabledLists).not.toContain('ublock');
    expect(get().enabledLists).toContain('easylist');
    await route({ type: 'lists/setEnabled', id: 'ublock', enabled: true }, ui);
    expect(get().enabledLists).toContain('ublock');
    await expect(
      route({ type: 'lists/setEnabled', id: 'evil', enabled: true }, ui),
    ).rejects.toThrow();
    expect(deps.applyFilters).toHaveBeenCalledTimes(2);
  });

  it('adds, toggles and removes user lists', async () => {
    const { route, deps, get } = setup();
    const url = 'https://lists.example/l.txt';
    await route({ type: 'userList/add', url }, ui);
    await route({ type: 'userList/add', url }, ui);
    expect(get().userLists).toEqual([{ url, enabled: true }]);
    expect(deps.refreshUserList).toHaveBeenCalledOnce();
    await route({ type: 'userList/setEnabled', url, enabled: false }, ui);
    expect(get().userLists).toEqual([{ url, enabled: false }]);
    await route({ type: 'userList/remove', url }, ui);
    expect(get().userLists).toEqual([]);
    expect(deps.forgetUserList).toHaveBeenCalledWith(url);
  });

  it('refuses insecure list URLs and too many lists', async () => {
    const { route } = setup({
      userLists: Array.from({ length: MAX_USER_LISTS }, (_, i) => ({
        url: `https://l.example/${i}`,
        enabled: true,
      })),
    });
    await expect(route({ type: 'userList/add', url: 'http://l.example/x' }, ui)).rejects.toThrow();
    await expect(route({ type: 'userList/add', url: 'https://l.example/new' }, ui)).rejects.toThrow(
      'En fazla',
    );
  });

  it('refreshes every user list, then re-applies filters once', async () => {
    const { route, deps } = setup({
      userLists: [
        { url: 'https://a.example/l', enabled: true },
        { url: 'https://b.example/l', enabled: false },
      ],
    });
    await route({ type: 'userList/refresh' }, ui);
    expect(deps.refreshUserList).toHaveBeenCalledTimes(2);
    expect(deps.applyFilters).toHaveBeenCalledOnce();
  });

  it('serves cosmetic rules to content scripts only on protected top-level sites', async () => {
    const { route, deps } = setup({ pausedSites: ['paused.com'] });
    await expect(route({ type: 'cosmetic/start' }, page('https://ok.com/'))).resolves.toEqual({
      extended: [{ id: 1, ast: {} }],
    });
    await expect(
      route({ type: 'cosmetic/start' }, page('https://ads.net/frame', 'https://paused.com/')),
    ).resolves.toEqual({ extended: [] });
    await expect(
      route({ type: 'cosmetic/dom', classes: ['ad'], ids: [], hrefs: [] }, page('https://ok.com/')),
    ).resolves.toEqual({ extended: [] });
    expect(deps.cosmeticStart).toHaveBeenCalledOnce();
    expect(deps.cosmeticDom).toHaveBeenCalledOnce();
  });

  it('records explicit new-tab clicks against the sending tab', async () => {
    const { route, deps } = setup();
    await route(
      { type: 'popup/userOpen', url: 'https://x.example/' },
      { ...page('https://ok.com/'), tabId: 7 },
    );
    expect(deps.noteUserOpen).toHaveBeenCalledWith(7, 'https://x.example/');
  });

  it('serves nothing while protection is globally off', async () => {
    const { route, deps } = setup({ enabled: false });
    await expect(route({ type: 'cosmetic/start' }, page('https://ok.com/'))).resolves.toEqual({
      extended: [],
    });
    expect(deps.cosmeticStart).not.toHaveBeenCalled();
  });

  it('merges privacy settings and applies control state', async () => {
    const { route, deps, get } = setup();
    await route({ type: 'privacy/set', privacy: { fingerprint: 'strict' } }, ui);
    await route({ type: 'privacy/set', privacy: { blockThirdPartyCookies: true } }, ui);
    expect(get().privacy).toMatchObject({
      blockThirdPartyCookies: true,
      cookieAutoReject: false,
      fingerprint: 'strict',
    });
    expect(deps.apply).toHaveBeenCalledTimes(2);
    expect(deps.applyFilters).not.toHaveBeenCalled();
  });

  it('merges video settings and applies control state', async () => {
    const { route, deps, get } = setup();
    await route({ type: 'video/set', video: { nocookieEmbeds: true } }, ui);
    expect(get().video).toMatchObject({ youtubeAds: true, nocookieEmbeds: true, adMute: false });
    expect(deps.apply).toHaveBeenCalledOnce();
    await expect(
      route({ type: 'video/set', video: { youtubeAds: false } }, page('https://evil.com/')),
    ).rejects.toThrow('not allowed');
  });

  it('looks up sponsor segments only when SponsorBlock is on and the site is protected', async () => {
    const msg = { type: 'video/segments', videoId: 'dQw4w9WgXcQ' } as const;
    const yt = page('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const off = setup();
    await expect(off.route(msg, yt)).resolves.toEqual([]);
    expect(off.deps.sponsorSegments).not.toHaveBeenCalled();

    const video = { ...defaultSettings().video, sponsorSkip: true };
    const on = setup({ video });
    await expect(on.route(msg, yt)).resolves.toEqual([[1, 5]]);
    expect(on.deps.sponsorSegments).toHaveBeenCalledWith('dQw4w9WgXcQ');

    const paused = setup({ video, pausedSites: ['youtube.com'] });
    await expect(paused.route(msg, yt)).resolves.toEqual([]);
    expect(paused.deps.sponsorSegments).not.toHaveBeenCalled();
  });

  it('runs autoconsent only when enabled, on protected sites, with the sender frame', async () => {
    const msg = {
      type: 'consent/msg',
      msg: { type: 'init', url: 'https://spoof.example/' },
    } as const;
    const ctx = { ...page('https://ok.com/'), tabId: 3, frameId: 0 };
    const off = setup();
    await expect(off.route(msg, ctx)).resolves.toBeNull();
    expect(off.deps.consent).not.toHaveBeenCalled();

    const on = setup({
      pausedSites: ['paused.com'],
      privacy: { ...defaultSettings().privacy, cookieAutoReject: true },
    });
    await expect(on.route(msg, { ...ctx, ...page('https://paused.com/') })).resolves.toBeNull();
    await expect(on.route(msg, ctx)).resolves.toEqual({ type: 'initResp' });
    expect(on.deps.consent).toHaveBeenCalledExactlyOnceWith(msg.msg, {
      tabId: 3,
      frameId: 0,
      url: 'https://ok.com/',
    });
  });

  it('lets the warning page proceed, and records http password fields from top frames', async () => {
    const { route, deps } = setup();
    await route({ type: 'security/proceed', url: 'https://bad.example/' }, ui);
    expect(deps.proceed).toHaveBeenCalledWith('https://bad.example/');
    deps.pageList.mockResolvedValueOnce(null);
    await expect(
      route({ type: 'security/proceed', url: 'https://ok.example/' }, ui),
    ).rejects.toThrow('listesinde değil');
    expect(deps.proceed).toHaveBeenCalledOnce();

    const msg = { type: 'security/insecurePassword' } as const;
    await route(msg, { ...page('http://login.example/'), tabId: 4, frameId: 0 });
    await route(msg, { ...page('https://login.example/'), tabId: 4, frameId: 0 });
    await route(msg, { ...page('http://frame.example/'), tabId: 4, frameId: 2 });
    expect(deps.insecurePassword).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('serves stats and imports only a valid backup', async () => {
    const { route, deps, get } = setup();
    await route({ type: 'stats/get', days: 7 }, ui);
    expect(deps.statsView).toHaveBeenCalledWith(7);
    await route({ type: 'theme/set', theme: 'light' }, ui);
    expect(get().theme).toBe('light');
    expect(deps.apply).not.toHaveBeenCalled();
    await expect(route({ type: 'settings/import', data: { enabled: false } }, ui)).rejects.toThrow(
      'Geçersiz',
    );
    await route(
      {
        type: 'settings/import',
        data: { nexus: 1, settings: { enabled: false }, stats: { rows: [], events: [] } },
      },
      ui,
    );
    expect(get().enabled).toBe(false);
    expect(deps.restoreStats).toHaveBeenCalledWith({ rows: [], events: [] });
    expect(deps.apply).toHaveBeenCalledOnce();
    expect(deps.applyFilters).toHaveBeenCalledOnce();
    await expect(route({ type: 'stats/get', days: 7 }, page('https://evil.com/'))).rejects.toThrow(
      'not allowed',
    );
  });

  it('refuses privileged messages from content scripts', async () => {
    const { route, deps } = setup();
    await expect(
      route({ type: 'security/proceed', url: 'https://evil.com/' }, page('https://evil.com/')),
    ).rejects.toThrow('not allowed');
    await expect(
      route({ type: 'global/set', enabled: false }, page('https://evil.com/')),
    ).rejects.toThrow('not allowed');
    await expect(route({ type: 'settings/get' }, page('https://evil.com/'))).rejects.toThrow();
    await expect(
      route({ type: 'tab/report', tabId: 1 }, page('https://evil.com/')),
    ).rejects.toThrow();
    await expect(
      route({ type: 'privacy/set', privacy: { fingerprint: 'off' } }, page('https://evil.com/')),
    ).rejects.toThrow();
    await expect(
      route({ type: 'userList/add', url: 'https://evil.com/l' }, page('https://evil.com/')),
    ).rejects.toThrow('not allowed');
    expect(deps.save).not.toHaveBeenCalled();
  });
});
