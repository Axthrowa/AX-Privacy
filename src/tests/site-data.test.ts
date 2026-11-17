import { describe, expect, it } from 'vitest';
import { keptOrigins } from '../background/site-data.ts';
import { parseMessage } from '../shared/messages.ts';
import { siteList } from '../shared/site.ts';
import { DEFAULT_SITE_PROFILE, defaultSettings } from '../storage/settings.ts';

describe('site data clearing', () => {
  it('keeps open tabs, kept sites and sites with privacy off', () => {
    const d = defaultSettings();
    const s = {
      ...d,
      privacy: { ...d.privacy, clearSiteData: true, keepSiteData: ['github.com'] },
      pausedSites: ['paused.example'],
      siteProfiles: { 'off.example': { ...DEFAULT_SITE_PROFILE, privacy: false } },
    };
    const kept = keptOrigins(s, [
      'https://news.example.com.tr/a?b=1',
      'chrome://newtab/',
      'http://192.168.1.1/admin',
    ]);
    expect(kept).toEqual(
      expect.arrayContaining([
        'https://news.example.com.tr',
        'https://example.com.tr',
        'https://www.example.com.tr',
        'http://192.168.1.1',
        'https://github.com',
        'https://www.github.com',
        'https://paused.example',
        'https://off.example',
      ]),
    );
    expect(kept.some((o) => o.startsWith('chrome'))).toBe(false);
  });

  it('accepts only valid sites in the keep list', () => {
    expect(siteList([' GitHub.com ', 'github.com', 'not a site', 5, 'mail.google.com'])).toEqual([
      'github.com',
      'mail.google.com',
    ]);
    expect(siteList('github.com')).toEqual([]);
    expect(
      parseMessage({ type: 'privacy/set', privacy: { keepSiteData: ['a.com', 'bad site'] } }),
    ).toEqual({ type: 'privacy/set', privacy: { keepSiteData: ['a.com'] } });
    expect(parseMessage({ type: 'privacy/set', privacy: { keepSiteData: 'a.com' } })).toBeNull();
  });
});
