import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  exportSettings,
  importSettings,
  isValidListUrl,
  normalizeSettings,
} from '../storage/settings.ts';

describe('normalizeSettings', () => {
  it('returns defaults for empty or corrupt storage', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({ enabled: 'yes', pausedSites: 'a.com', isBrave: 1, enabledLists: 'x' }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('enables every built-in list except the cookie-banner list by default', () => {
    expect(DEFAULT_SETTINGS.enabledLists).toEqual([
      'easylist',
      'easyprivacy',
      'ublock',
      'ublock-unbreak',
      'ublock-quick-fixes',
      'brave-unbreak',
      'ublock-privacy',
      'pgl',
      'adguard-tr',
      'adguard-urltracking',
      'ublock-badware',
      'urlhaus',
    ]);
  });

  it('switches on lists added in version 3 once, and respects a later choice', () => {
    const old = normalizeSettings({ version: 2, enabledLists: ['easylist'] });
    expect(old.enabledLists).toContain('ublock-unbreak');
    expect(old.enabledLists).not.toContain('ublock');
    const later = normalizeSettings({ version: 3, enabledLists: ['easylist'] });
    expect(later.enabledLists).toEqual(['easylist']);
  });

  it('keeps every privacy feature that can break sites off by default', () => {
    expect(DEFAULT_SETTINGS.privacy).toEqual({
      blockThirdPartyCookies: false,
      cookieAutoReject: false,
      fingerprint: 'off',
      gpc: true,
      cleanLinks: true,
      cdnCookies: true,
      detailedReports: false,
    });
    expect(
      normalizeSettings({
        privacy: { blockThirdPartyCookies: 'yes', cookieAutoReject: true, fingerprint: 'max' },
      }).privacy,
    ).toEqual({ ...DEFAULT_SETTINGS.privacy, cookieAutoReject: true });
  });

  it('keeps valid fields, dedupes and sorts sites, drops invalid ones', () => {
    expect(
      normalizeSettings({
        version: 3,
        enabled: false,
        pausedSites: ['b.com', 'a.com', 'b.com', '*.evil', 5],
        enabledLists: ['ublock', 'nope', 'easylist'],
        customRules: '||ads.example^',
        userLists: [
          { url: 'https://lists.example/a.txt', enabled: false },
          { url: 'https://lists.example/a.txt' },
          { url: 'http://insecure.example/b.txt' },
          { url: 'http://127.0.0.1:8080/c.txt' },
          null,
        ],
        isBrave: true,
      }),
    ).toEqual({
      version: 3,
      autoUpdateLists: true,
      pauseUntil: {},
      enabled: false,
      pausedSites: ['a.com', 'b.com'],
      enabledLists: ['easylist', 'ublock'],
      customRules: '||ads.example^',
      userLists: [
        { url: 'https://lists.example/a.txt', enabled: false },
        { url: 'http://127.0.0.1:8080/c.txt', enabled: true },
      ],
      isBrave: true,
      privacy: DEFAULT_SETTINGS.privacy,
      video: DEFAULT_SETTINGS.video,
      theme: 'dark',
      siteProfiles: {},
    });
  });

  it('turns YouTube ad removal and marking on by default, the rest off', () => {
    expect(DEFAULT_SETTINGS.video).toEqual({
      youtubeAds: true,
      twitchAds: true,
      markSponsored: true,
      nocookieEmbeds: false,
      adMute: false,
      sponsorSkip: false,
    });
    expect(
      normalizeSettings({
        video: { youtubeAds: false, nocookieEmbeds: 'yes', sponsorSkip: true, x: 1 },
      }).video,
    ).toEqual({
      youtubeAds: false,
      twitchAds: true,
      markSponsored: true,
      nocookieEmbeds: false,
      adMute: false,
      sponsorSkip: true,
    });
  });

  it('migrates version 1 element-hiding rules into custom rules', () => {
    const s = normalizeSettings({
      version: 1,
      enabled: true,
      pausedSites: [],
      customCosmetic: '##.ad',
    });
    expect(s.customRules).toBe('##.ad');
    expect(s.enabledLists).toEqual(DEFAULT_SETTINGS.enabledLists);
    expect(s).not.toHaveProperty('customCosmetic');
  });

  it('keeps a valid theme and falls back to dark', () => {
    expect(normalizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(normalizeSettings({ theme: 'neon' }).theme).toBe('dark');
  });

  it('exports settings without the Brave flag and imports only our envelope', () => {
    const s = normalizeSettings({ enabled: false, theme: 'light', isBrave: true });
    const bag = exportSettings(s);
    expect(bag.nexus).toBe(1);
    expect(bag.settings).not.toHaveProperty('isBrave');
    expect(bag.settings.enabled).toBe(false);
    const current = normalizeSettings({ isBrave: false });
    expect(importSettings(bag, current)).toMatchObject({
      enabled: false,
      theme: 'light',
      isBrave: false,
    });
    expect(importSettings({ enabled: false }, current)).toBeNull();
    expect(importSettings({ nexus: 1, settings: { enabled: false } }, current)?.enabled).toBe(
      false,
    );
    expect(
      normalizeSettings({
        siteProfiles: { 'a.com': { network: false }, 'bad site': { network: false } },
      }).siteProfiles,
    ).toEqual({ 'a.com': { network: false, privacy: true, video: true, security: true } });
  });

  it('does not share default arrays between calls', () => {
    const a = normalizeSettings(undefined);
    a.pausedSites.push('x.com');
    a.enabledLists.pop();
    const b = normalizeSettings(undefined);
    expect(b.pausedSites).toEqual([]);
    expect(b.enabledLists).toEqual(DEFAULT_SETTINGS.enabledLists);
  });
});

describe('isValidListUrl', () => {
  it('accepts https and local http only', () => {
    expect(isValidListUrl('https://example.com/list.txt')).toBe(true);
    expect(isValidListUrl('http://localhost:3000/l.txt')).toBe(true);
    expect(isValidListUrl('http://example.com/list.txt')).toBe(false);
    expect(isValidListUrl('file:///C:/list.txt')).toBe(false);
    expect(isValidListUrl('javascript:alert(1)')).toBe(false);
    expect(isValidListUrl('not a url')).toBe(false);
    expect(isValidListUrl(`https://e.com/${'a'.repeat(2048)}`)).toBe(false);
  });
});

describe('site profiles', () => {
  it('keeps every site, however many', () => {
    const siteProfiles = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`s${i}.example`, { network: false }]),
    );
    expect(Object.keys(normalizeSettings({ siteProfiles }).siteProfiles)).toHaveLength(60);
  });
});
