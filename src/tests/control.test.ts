import { describe, expect, it } from 'vitest';
import {
  ALWAYS_EXCLUDED,
  CONTROL_PRIORITY,
  COOKIE_RULE_PRIORITY,
  RULE_CDN_COOKIES,
  RULE_GPC,
  RULE_GLOBAL_OFF,
  RULE_GLOBAL_OFF_FRAMELESS,
  RULE_NOCOOKIE_EMBEDS,
  RULE_PAUSED_SITES,
  RULE_SITE_NETWORK,
  RULE_SITE_SECURITY,
  RULE_THIRD_PARTY_COOKIES,
  contentScripts,
  controlRules,
  isProtected,
} from '../engines/core/control.ts';
import { PRIORITY } from '../engines/adblock/network.ts';
import { DEFAULT_SETTINGS } from '../storage/settings.ts';

const noVideo = {
  youtubeAds: false,
  twitchAds: false,
  markSponsored: false,
  nocookieEmbeds: false,
  adMute: false,
  sponsorSkip: false,
};
const on = {
  ...DEFAULT_SETTINGS,
  video: noVideo,
  privacy: { ...DEFAULT_SETTINGS.privacy, gpc: false, cleanLinks: false, cdnCookies: false },
};

describe('controlRules', () => {
  it('outranks every filter priority without hitting the 2^24 browser limit', () => {
    expect(CONTROL_PRIORITY).toBeGreaterThan(PRIORITY.allow + PRIORITY.important);
    expect(CONTROL_PRIORITY).toBeLessThan(2 ** 24);
  });
  it('adds no rules when protection is fully on', () => {
    expect(controlRules(on)).toEqual([]);
  });
  it('allows everything in every frame when globally off', () => {
    expect(controlRules({ ...on, enabled: false })).toEqual([
      {
        id: RULE_GLOBAL_OFF,
        priority: CONTROL_PRIORITY,
        action: { type: 'allowAllRequests' },
        condition: { resourceTypes: ['main_frame', 'sub_frame'] },
      },
      {
        id: RULE_GLOBAL_OFF_FRAMELESS,
        priority: CONTROL_PRIORITY,
        action: { type: 'allow' },
        condition: {},
      },
    ]);
  });
  it('allows paused sites at top level only', () => {
    expect(controlRules({ ...on, pausedSites: ['a.com', '10.0.0.1'] })).toEqual([
      {
        id: RULE_PAUSED_SITES,
        priority: CONTROL_PRIORITY,
        action: { type: 'allowAllRequests' },
        condition: { requestDomains: ['a.com', '10.0.0.1'], resourceTypes: ['main_frame'] },
      },
      {
        id: RULE_SITE_NETWORK,
        priority: CONTROL_PRIORITY,
        action: { type: 'allow' },
        condition: {
          initiatorDomains: ['10.0.0.1', 'a.com'],
          excludedResourceTypes: ['main_frame'],
        },
      },
    ]);
  });
  it('strips third-party cookies on request, below pausing but above filter exceptions', () => {
    const privacy = { ...on.privacy, blockThirdPartyCookies: true };
    expect(controlRules({ ...on, privacy })).toEqual([
      {
        id: RULE_THIRD_PARTY_COOKIES,
        priority: COOKIE_RULE_PRIORITY,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'cookie', operation: 'remove' }],
          responseHeaders: [{ header: 'set-cookie', operation: 'remove' }],
        },
        condition: { domainType: 'thirdParty', excludedResourceTypes: ['main_frame'] },
      },
    ]);
    expect(COOKIE_RULE_PRIORITY).toBeGreaterThan(PRIORITY.allow + PRIORITY.important);
    expect(COOKIE_RULE_PRIORITY).toBeLessThan(CONTROL_PRIORITY);
    expect(controlRules({ ...on, enabled: false, privacy }).map((r) => r.id)).toEqual([
      RULE_GLOBAL_OFF,
      RULE_GLOBAL_OFF_FRAMELESS,
    ]);
  });
  it('lifts network filters for a site without disabling page blocks', () => {
    const siteProfiles = {
      'a.com': { network: false, privacy: true, video: true, security: true },
    };
    expect(controlRules({ ...on, siteProfiles })).toEqual([
      {
        id: RULE_SITE_NETWORK,
        priority: CONTROL_PRIORITY,
        action: { type: 'allow' },
        condition: { initiatorDomains: ['a.com'], excludedResourceTypes: ['main_frame'] },
      },
    ]);
    const locked = {
      'evil.com': { network: true, privacy: true, video: true, security: false },
    };
    expect(controlRules({ ...on, siteProfiles: locked })[0]?.id).toBe(RULE_SITE_SECURITY);
  });
});

describe('contentScripts', () => {
  it('registers nothing when globally off', () => {
    expect(contentScripts({ ...on, enabled: false })).toEqual([]);
  });
  it('always excludes Cloudflare challenges and paused sites', () => {
    const [script] = contentScripts({ ...on, pausedSites: ['a.com', '10.0.0.1'] });
    expect(script?.excludeMatches).toEqual([
      ...ALWAYS_EXCLUDED,
      '*://10.0.0.1/*',
      '*://a.com/*',
      '*://*.a.com/*',
    ]);
    expect(script?.runAt).toBe('document_start');
    expect(script?.js).toEqual(['content/generic-tokens.js', 'content/cosmetic.js']);
  });
  it('adds consent and main-world fingerprint scripts only when chosen', () => {
    expect(contentScripts(on).map((s) => s.id)).toEqual(['cosmetic', 'popups', 'scriptlets']);
    const scripts = contentScripts({
      ...on,
      pausedSites: ['a.com'],
      privacy: { ...on.privacy, cookieAutoReject: true, fingerprint: 'strict' },
    });
    expect(scripts.map((s) => s.id)).toEqual([
      'cosmetic',
      'popups',
      'scriptlets',
      'consent',
      'fp-noise',
      'fp-strict',
    ]);
    for (const s of scripts) expect(s.excludeMatches).toContain('*://a.com/*');
    const fp = scripts.filter((s) => s.id.startsWith('fp-'));
    for (const s of fp) expect(s).toMatchObject({ world: 'MAIN', matchOriginAsFallback: true });
    expect(scripts.find((s) => s.id === 'consent')?.world).toBeUndefined();
    const standard = { ...on.privacy, fingerprint: 'standard' as const };
    expect(contentScripts({ ...on, privacy: standard }).map((s) => s.id)).toEqual([
      'cosmetic',
      'popups',
      'scriptlets',
      'fp-noise',
    ]);
  });
  it('runs the YouTube scripts on YouTube sites only', () => {
    const video = { ...noVideo, youtubeAds: true, markSponsored: true };
    const scripts = contentScripts({ ...on, pausedSites: ['a.com'], video });
    expect(scripts.map((s) => s.id)).toEqual([
      'cosmetic',
      'popups',
      'scriptlets',
      'yt-ads',
      'yt-sponsored',
    ]);
    const yt = scripts.filter((s) => s.id.startsWith('yt'));
    for (const s of yt) {
      expect(s.matches).toEqual([
        '*://youtube.com/*',
        '*://*.youtube.com/*',
        '*://youtube-nocookie.com/*',
        '*://*.youtube-nocookie.com/*',
        '*://youtubekids.com/*',
        '*://*.youtubekids.com/*',
      ]);
      expect(s.excludeMatches).toContain('*://a.com/*');
    }
    expect(yt[0]).toMatchObject({ world: 'MAIN', js: ['content/yt-ads.js'], allFrames: true });
    expect(yt[1]).toMatchObject({ css: ['content/yt-sponsored.css'] });
    expect(yt[1]?.js).toBeUndefined();
  });
  it('adds the opt-in SponsorBlock and ad-muting scripts in the isolated world', () => {
    const video = { ...noVideo, sponsorSkip: true, adMute: true };
    const scripts = contentScripts({ ...on, video });
    expect(scripts.map((s) => s.id)).toEqual([
      'cosmetic',
      'popups',
      'scriptlets',
      'yt-skip',
      'video-ads',
    ]);
    expect(scripts[3]).toMatchObject({ js: ['content/yt-skip.js'] });
    expect(scripts[3]?.matches).toContain('*://*.youtube.com/*');
    expect(scripts[3]?.matches).not.toContain('*://*.twitch.tv/*');
    expect(scripts[4]?.matches).toEqual([
      '*://youtube.com/*',
      '*://*.youtube.com/*',
      '*://youtube-nocookie.com/*',
      '*://*.youtube-nocookie.com/*',
      '*://twitch.tv/*',
      '*://*.twitch.tv/*',
    ]);
    for (const s of scripts) {
      if (s.id === 'popups' || s.id === 'scriptlets') expect(s.world).toBe('MAIN');
      else expect(s.world).toBeUndefined();
    }
  });
  it('loads list data before the scriptlet runner, for enabled lists only', () => {
    const js = contentScripts({ ...on, enabledLists: ['ublock', 'easylist'] }).find(
      (s) => s.id === 'scriptlets',
    )?.js;
    expect(js).toEqual(['scriptlets/ublock.js', 'content/scriptlets.js']);
  });
  it('drops the token table when custom rules could use other words', () => {
    const js = (s: Partial<typeof on>) =>
      contentScripts({ ...on, ...s }).find((c) => c.id === 'cosmetic')?.js;
    expect(js({ customRules: '##.mine' })).toEqual(['content/cosmetic.js']);
    expect(js({ customRules: '~a.example##.mine' })).toEqual(['content/cosmetic.js']);
    expect(js({ customRules: 'a.example##.picked\n||ads.example^' })).toContain(
      'content/generic-tokens.js',
    );
    expect(js({ userLists: [{ url: 'https://a.example/l.txt', enabled: true }] })).toEqual([
      'content/cosmetic.js',
    ]);
    expect(js({ userLists: [{ url: 'https://a.example/l.txt', enabled: false }] })).toContain(
      'content/generic-tokens.js',
    );
  });
  it('sends Global Privacy Control as a header and a page signal when on', () => {
    const s = { ...on, privacy: { ...on.privacy, gpc: true }, pausedSites: ['a.com'] };
    const rule = controlRules(s).find((r) => r.id === RULE_GPC);
    expect(rule?.action.requestHeaders).toEqual([
      { header: 'sec-gpc', operation: 'set', value: '1' },
    ]);
    expect(rule?.priority).toBeGreaterThan(PRIORITY.allow + PRIORITY.important);
    expect(rule?.condition.excludedRequestDomains).toEqual(['a.com']);
    expect(contentScripts(s).map((c) => c.id)).toContain('gpc');
    expect(controlRules(on).some((r) => r.id === RULE_GPC)).toBe(false);
    expect(rule?.condition.resourceTypes).toEqual(['main_frame', 'sub_frame']);
    expect(controlRules({ ...s, isBrave: true }).some((r) => r.id === RULE_GPC)).toBe(false);
  });
  it('cleans links in top frames only, and honors the site profile', () => {
    const s = { ...on, privacy: { ...on.privacy, cleanLinks: true }, pausedSites: ['a.com'] };
    const script = contentScripts(s).find((c) => c.id === 'link-clean');
    expect(script?.allFrames).toBe(false);
    expect(script?.excludeMatches).toContain('*://a.com/*');
  });
  it('drops cookies of listed hosts, third-party only, keeping sign-in hosts out', () => {
    const s = { ...on, privacy: { ...on.privacy, cdnCookies: true }, pausedSites: ['a.com'] };
    const rule = controlRules(s).find((r) => r.id === RULE_CDN_COOKIES);
    expect(rule?.condition.domainType).toBe('thirdParty');
    expect(rule?.condition.excludedInitiatorDomains).toEqual(['a.com']);
    expect(rule?.condition.requestDomains?.length).toBeGreaterThan(100);
    for (const host of ['accounts.google.com', 'www.paypal.com', 'accounts.spotify.com']) {
      expect(rule?.condition.requestDomains).not.toContain(host);
    }
    const all = { ...s, privacy: { ...s.privacy, blockThirdPartyCookies: true } };
    expect(controlRules(all).some((r) => r.id === RULE_CDN_COOKIES)).toBe(false);
  });
  it('runs the Twitch filter on Twitch only, in the page world', () => {
    const tw = contentScripts({ ...on, video: { ...noVideo, twitchAds: true } }).find(
      (c) => c.id === 'tw-ads',
    );
    expect(tw).toMatchObject({ world: 'MAIN', matches: ['*://twitch.tv/*', '*://*.twitch.tv/*'] });
  });
  it('excludes only the matching module from content scripts', () => {
    const scripts = contentScripts({
      ...on,
      siteProfiles: {
        'a.com': { network: false, privacy: true, video: true, security: true },
        'b.com': { network: true, privacy: false, video: true, security: true },
      },
      privacy: { ...on.privacy, cookieAutoReject: true },
    });
    const cosmetic = scripts.find((s) => s.id === 'cosmetic');
    const consent = scripts.find((s) => s.id === 'consent');
    expect(cosmetic?.excludeMatches).toContain('*://a.com/*');
    expect(cosmetic?.excludeMatches).not.toContain('*://b.com/*');
    expect(consent?.excludeMatches).toContain('*://b.com/*');
    expect(consent?.excludeMatches).not.toContain('*://a.com/*');
  });
});

describe('nocookie embeds', () => {
  it('moves third-party YouTube embeds to youtube-nocookie.com when chosen', () => {
    const video = { ...noVideo, nocookieEmbeds: true };
    expect(controlRules({ ...on, video })).toEqual([
      {
        id: RULE_NOCOOKIE_EMBEDS,
        priority: COOKIE_RULE_PRIORITY,
        action: { type: 'redirect', redirect: { transform: { host: 'www.youtube-nocookie.com' } } },
        condition: {
          requestDomains: ['youtube.com'],
          urlFilter: '/embed/',
          resourceTypes: ['sub_frame'],
          excludedInitiatorDomains: ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com'],
        },
      },
    ]);
    expect(controlRules({ ...on, enabled: false, video }).map((r) => r.id)).toEqual([
      RULE_GLOBAL_OFF,
      RULE_GLOBAL_OFF_FRAMELESS,
    ]);
  });
});

describe('isProtected', () => {
  it('is false for paused sites, non-web pages and when globally off', () => {
    expect(isProtected(on, 'a.com')).toBe(true);
    expect(isProtected({ ...on, pausedSites: ['a.com'] }, 'a.com')).toBe(false);
    expect(isProtected(on, null)).toBe(false);
    expect(isProtected({ ...on, enabled: false }, 'a.com')).toBe(false);
  });
});
