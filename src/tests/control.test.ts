import { describe, expect, it } from 'vitest';
import {
  ALWAYS_EXCLUDED,
  CONTROL_PRIORITY,
  COOKIE_RULE_PRIORITY,
  RULE_CAMPAIGN_PARAMS,
  RULE_CLIENT_HINTS,
  RULE_CLICK_TO_LOAD,
  RULE_EMPTY_VAST,
  EMBED_ALLOW_PRIORITY,
  EMBED_BLOCK_PRIORITY,
  EMBED_REGEXES,
  CONTROL_RULE_IDS,
  RULE_CDN_COOKIES,
  RULE_GPC,
  RULE_LOCALE,
  RULE_ROTATING_ADS,
  RULE_ROTATING_AD_HOST,
  RULE_GLOBAL_OFF,
  RULE_GLOBAL_OFF_FRAMELESS,
  RULE_NOCOOKIE_EMBEDS,
  RULE_PAUSED_SITES,
  RULE_SITE_NETWORK,
  RULE_SITE_SECURITY,
  RULE_THIRD_PARTY_COOKIES,
  FP_SEED_DIGITS,
  FP_SEED_LENGTH,
  contentScripts,
  controlRules,
  isProtected,
  newFpSeed,
} from '../engines/core/control.ts';
import { PRIORITY } from '../engines/adblock/network.ts';
import { DEFAULT_SETTINGS } from '../storage/settings.ts';
import { PROCEED_PRIORITY } from '../background/security.ts';

/** Everything but the always-on loader rule, which has its own test. */
const otherRules = (s: Parameters<typeof controlRules>[0]) =>
  controlRules(s).filter((r) => r.id !== RULE_ROTATING_ADS && r.id !== RULE_ROTATING_AD_HOST);

const noVideo = {
  youtubeAds: false,
  twitchAds: false,
  markSponsored: false,
  hideSponsored: false,
  autoSkipAds: false,
  genericPlayers: false,
  nocookieEmbeds: false,
  adMute: false,
  adSpeedUp: false,
  sponsorSkip: false,
  sponsorModes: DEFAULT_SETTINGS.video.sponsorModes,
  sponsorChannels: [],
};
const on = {
  ...DEFAULT_SETTINGS,
  video: noVideo,
  privacy: {
    ...DEFAULT_SETTINGS.privacy,
    gpc: false,
    cleanLinks: false,
    cdnCookies: false,
    cookieAutoReject: false,
    limitClientHints: false,
    fingerprint: 'off' as const,
  },
};

describe('controlRules', () => {
  it('outranks every filter priority without hitting the 2^24 browser limit', () => {
    expect(CONTROL_PRIORITY).toBeGreaterThan(PRIORITY.allow + PRIORITY.important);
    expect(CONTROL_PRIORITY).toBeLessThan(2 ** 24);
  });
  it('adds no rules when protection is fully on', () => {
    expect(otherRules(on)).toEqual([]);
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
    expect(otherRules({ ...on, pausedSites: ['a.com', '10.0.0.1'] })).toEqual([
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
    expect(otherRules({ ...on, privacy })).toEqual([
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
    expect(otherRules({ ...on, siteProfiles })).toEqual([
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
  it('keeps every script off payment, bank, captcha and sign-in pages', () => {
    for (const p of [
      '*://challenges.cloudflare.com/*',
      '*://*.stripe.com/*',
      '*://*.turkiye.gov.tr/*',
      '*://accounts.google.com/*',
      '*://www.google.com/recaptcha/*',
    ]) {
      expect(ALWAYS_EXCLUDED).toContain(p);
    }
    const video = { ...noVideo, youtubeAds: true, twitchAds: true };
    for (const script of contentScripts({ ...DEFAULT_SETTINGS, video })) {
      expect(script.excludeMatches).toEqual(expect.arrayContaining(ALWAYS_EXCLUDED));
    }
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
    expect(contentScripts(on).map((s) => s.id)).toEqual([
      'cosmetic',
      'brain-scan',
      'popups',
      'scriptlets',
    ]);
    const scripts = contentScripts({
      ...on,
      pausedSites: ['a.com'],
      privacy: { ...on.privacy, cookieAutoReject: true, fingerprint: 'strict' },
    });
    expect(scripts.map((s) => s.id)).toEqual([
      'cosmetic',
      'brain-scan',
      'popups',
      'scriptlets',
      'consent',
      'consent-eval',
      'fp-noise',
      'fp-strict',
    ]);
    for (const s of scripts) expect(s.excludeMatches).toContain('*://a.com/*');
    const fp = scripts.filter((s) => s.id.startsWith('fp-'));
    for (const s of fp) expect(s).toMatchObject({ world: 'MAIN', matchOriginAsFallback: true });
    const consent = scripts.find((s) => s.id === 'consent');
    expect(consent?.world).toBeUndefined();
    // The rules file runs first, in the same pass.
    expect(consent?.js).toEqual(['content/consent-rules.js', 'content/consent.js']);
    expect(scripts.find((s) => s.id === 'consent-eval')?.world).toBe('MAIN');
    const standard = { ...on.privacy, fingerprint: 'standard' as const };
    expect(contentScripts({ ...on, privacy: standard }).map((s) => s.id)).toEqual([
      'cosmetic',
      'brain-scan',
      'popups',
      'scriptlets',
      'fp-noise',
    ]);
  });
  it('spells the session fingerprint seed with files that run before the noise script', () => {
    const privacy = { ...on.privacy, fingerprint: 'standard' as const };
    const noise = contentScripts({ ...on, privacy }, [3, 10]).find((s) => s.id === 'fp-noise');
    expect(noise?.js).toEqual([
      'content/fp-seed/3.js',
      'content/fp-seed/a.js',
      'content/fp-noise.js',
    ]);
    const seed = newFpSeed();
    expect(seed).toHaveLength(FP_SEED_LENGTH);
    expect(new Set(seed).size).toBe(FP_SEED_LENGTH);
    for (const d of seed) expect(d >= 0 && d < FP_SEED_DIGITS).toBe(true);
  });
  it('runs the YouTube scripts on YouTube sites only', () => {
    const video = { ...noVideo, youtubeAds: true, markSponsored: true, autoSkipAds: true };
    const scripts = contentScripts({ ...on, pausedSites: ['a.com'], video });
    expect(scripts.map((s) => s.id)).toEqual([
      'cosmetic',
      'brain-scan',
      'popups',
      'scriptlets',
      'yt-ads',
      'yt-guard',
      'yt-autoskip',
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
    expect(yt[1]).toMatchObject({ js: ['content/yt-guard.js'] });
    expect(yt[2]).toMatchObject({ js: ['content/yt-autoskip.js'] });
    expect(yt[3]).toMatchObject({ css: ['content/yt-sponsored.css'] });
    expect(yt[3]?.js).toBeUndefined();
    // Hiding replaces marking: one stylesheet, never both.
    const hidden = contentScripts({ ...on, video: { ...video, hideSponsored: true } });
    expect(hidden.filter((s) => s.id === 'yt-sponsored').map((s) => s.css)).toEqual([
      ['content/yt-sponsored-hide.css'],
    ]);
  });
  it('adds the opt-in SponsorBlock and ad-muting scripts in the isolated world', () => {
    const video = { ...noVideo, sponsorSkip: true, adMute: true };
    const scripts = contentScripts({ ...on, video });
    expect(scripts.map((s) => s.id)).toEqual([
      'cosmetic',
      'brain-scan',
      'popups',
      'scriptlets',
      'yt-skip',
      'video-ads',
    ]);
    expect(scripts[4]).toMatchObject({ js: ['content/yt-skip.js'] });
    expect(scripts[4]?.matches).toContain('*://*.youtube.com/*');
    expect(scripts[4]?.matches).not.toContain('*://*.twitch.tv/*');
    expect(scripts[5]?.matches).toEqual([
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
    // Each chosen job is spelled by a file that runs before the script.
    expect(scripts[5]?.js).toEqual(['content/ad-mode/mute.js', 'content/video-ads.js']);
    const both = contentScripts({ ...on, video: { ...video, adSpeedUp: true } });
    expect(both.find((s) => s.id === 'video-ads')?.js).toEqual([
      'content/ad-mode/mute.js',
      'content/ad-mode/speed.js',
      'content/video-ads.js',
    ]);
    const speedOnly = contentScripts({ ...on, video: { ...noVideo, adSpeedUp: true } });
    expect(speedOnly.find((s) => s.id === 'video-ads')?.js).toEqual([
      'content/ad-mode/speed.js',
      'content/video-ads.js',
    ]);
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
  it('strips high-entropy Client Hints from third-party requests when on', () => {
    const s = { ...on, privacy: { ...on.privacy, limitClientHints: true }, pausedSites: ['a.com'] };
    const rule = controlRules(s).find((r) => r.id === RULE_CLIENT_HINTS);
    expect(rule?.condition.domainType).toBe('thirdParty');
    expect(rule?.condition.excludedInitiatorDomains).toEqual(['a.com']);
    expect(rule?.action.requestHeaders).toContainEqual({
      header: 'sec-ch-ua-full-version-list',
      operation: 'remove',
    });
    expect(rule?.action.responseHeaders).toContainEqual({
      header: 'accept-ch',
      operation: 'remove',
    });
    expect(controlRules(on).some((r) => r.id === RULE_CLIENT_HINTS)).toBe(false);
  });
  it('holds back embed scripts and frames for click-to-load, never on their own sites', () => {
    expect(controlRules(on).some((r) => r.id === RULE_CLICK_TO_LOAD)).toBe(false);
    const s = { ...on, privacy: { ...on.privacy, clickToLoad: true }, pausedSites: ['a.com'] };
    const rules = controlRules(s).filter(
      (r) => r.id >= RULE_CLICK_TO_LOAD && r.id < RULE_CLICK_TO_LOAD + EMBED_REGEXES.length,
    );
    expect(rules).toHaveLength(EMBED_REGEXES.length);
    for (const rule of rules) {
      expect(CONTROL_RULE_IDS).toContain(rule.id);
      expect(rule.action.type).toBe('block');
      expect(rule.condition.resourceTypes).toEqual(['script', 'sub_frame']);
      expect(rule.condition.excludedInitiatorDomains).toEqual(
        expect.arrayContaining(['facebook.com', 'x.com', 'disqus.com', 'a.com']),
      );
    }
    // Above list exceptions, below a warning-page proceed; a click outranks the block.
    expect(EMBED_BLOCK_PRIORITY).toBeGreaterThan(PRIORITY.allow + PRIORITY.important);
    expect(EMBED_ALLOW_PRIORITY).toBeGreaterThan(EMBED_BLOCK_PRIORITY);
    expect(EMBED_ALLOW_PRIORITY).toBeLessThan(PROCEED_PRIORITY);
    const re = { test: (url: string) => EMBED_REGEXES.some((r) => new RegExp(r).test(url)) };
    for (const url of [
      'https://connect.facebook.net/en_US/sdk.js',
      'https://www.facebook.com/plugins/post.php?href=x',
      'https://www.facebook.com/v18.0/plugins/video.php',
      'https://platform.twitter.com/widgets.js',
      'https://platform.twitter.com/embed/Tweet.html?id=1',
      'https://platform.x.com/widgets.js',
      'https://example.disqus.com/embed.js',
    ]) {
      expect(re.test(url), url).toBe(true);
    }
    for (const url of [
      'https://www.facebook.com/login',
      'https://example.disqus.com/count.js',
      'https://evilconnect.facebook.net/en_US/sdk.js',
      'https://connect.facebookXnet/en_US/sdk.js',
    ]) {
      expect(re.test(url), url).toBe(false);
    }
    const script = contentScripts(s).find((c) => c.id === 'click-to-load');
    expect(script?.allFrames).toBe(false);
    expect(contentScripts(on).some((c) => c.id === 'click-to-load')).toBe(false);
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
  it('reports US English and UTC only when asked, never on paused sites', () => {
    const s = { ...on, privacy: { ...on.privacy, hideLocale: true }, pausedSites: ['a.com'] };
    const rule = controlRules(s).find((r) => r.id === RULE_LOCALE);
    expect(rule?.action.requestHeaders).toEqual([
      { header: 'accept-language', operation: 'set', value: 'en-US,en;q=0.9' },
    ]);
    expect(rule?.condition.excludedRequestDomains).toEqual(['a.com']);
    const script = contentScripts(s).find((c) => c.id === 'locale');
    expect(script?.world).toBe('MAIN');
    expect(script?.excludeMatches).toEqual(expect.arrayContaining(['*://a.com/*']));
    expect(controlRules(on).some((r) => r.id === RULE_LOCALE)).toBe(false);
    expect(contentScripts(on).some((c) => c.id === 'locale')).toBe(false);
  });
  it('blocks rotating ad loaders by their address shape only', () => {
    const rules = controlRules(on).filter(
      (r) => r.id === RULE_ROTATING_ADS || r.id === RULE_ROTATING_AD_HOST,
    );
    const res = rules.map((r) => new RegExp(r.condition.regexFilter ?? '$^'));
    const re = { test: (url: string) => res.some((x) => x.test(url)) };
    const rule = rules[1];
    expect(re.test('https://quietmapleharbor.com/on.js')).toBe(true);
    expect(re.test('https://brightorchardlantern.com/bn.js')).toBe(true);
    expect(re.test('https://cdn.example.com/on.js')).toBe(false);
    expect(re.test('https://qwertyuiopas.in/lwaokza')).toBe(true);
    expect(re.test('https://qwertyuiopas.in/ca/tanock/ohhkucck')).toBe(true);
    expect(re.test('https://qwertyuiopas.in/static/app.js')).toBe(false);
    expect(re.test('https://shop.in/lwaokza')).toBe(false);
    expect(re.test('https://quietmapleharbor.com/on.js?v=1')).toBe(false);
    expect(rule?.condition.domainType).toBe('thirdParty');
    expect(rules).toHaveLength(2);
    expect(controlRules({ ...on, enabled: false }).some((r) => r.id === RULE_ROTATING_ADS)).toBe(
      false,
    );
  });
  it('drops the standard campaign tags from page addresses, never on paused sites', () => {
    const s = { ...on, privacy: { ...on.privacy, cleanLinks: true }, pausedSites: ['a.com'] };
    const rule = controlRules(s).find((r) => r.id === RULE_CAMPAIGN_PARAMS);
    expect(rule?.action.redirect?.transform?.queryTransform?.removeParams).toContain('utm_source');
    expect(rule?.priority).toBe(PRIORITY.block);
    expect(rule?.condition.resourceTypes).toEqual(['main_frame']);
    expect(rule?.condition.excludedRequestDomains).toEqual(['a.com']);
    expect(controlRules(on).some((r) => r.id === RULE_CAMPAIGN_PARAMS)).toBe(false);
  });
  it('answers FreeWheel and SpotX ad requests with an empty VAST only in the beta layer', () => {
    expect(controlRules(on).some((r) => r.id === RULE_EMPTY_VAST)).toBe(false);
    const s = { ...on, video: { ...on.video, genericPlayers: true }, pausedSites: ['a.com'] };
    const rule = controlRules(s).find((r) => r.id === RULE_EMPTY_VAST);
    expect(rule?.action.redirect?.extensionPath).toBe('/surrogates/noop-vast3.xml');
    // Beats a list's block, loses to its exceptions.
    expect(rule?.priority).toBe(PRIORITY.redirect);
    expect(rule?.condition.excludedInitiatorDomains).toEqual(['a.com']);
    const re = new RegExp(rule?.condition.regexFilter ?? '$^');
    expect(re.test('https://abc.v.fwmrm.net/ad/g/1?prof=x')).toBe(true);
    expect(re.test('https://search.spotxchange.com/vast/2.0/85394')).toBe(true);
    expect(re.test('https://fwmrm.net.example/ad/g/1')).toBe(false);
    const generic = contentScripts(s).find((c) => c.id === 'video-generic');
    expect(generic).toMatchObject({ world: 'MAIN', js: ['content/video-generic.js'] });
    expect(generic?.excludeMatches).toEqual(
      expect.arrayContaining(['*://a.com/*', '*://*.youtube.com/*', '*://*.twitch.tv/*']),
    );
    expect(contentScripts(on).some((c) => c.id === 'video-generic')).toBe(false);
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
    expect(otherRules({ ...on, video })).toEqual([
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
