import { BUILTIN_LISTS } from '../../filters/catalog.ts';
import type { Settings, SiteProfile } from '../../shared/types.ts';
import { DEFAULT_SITE_PROFILE, PROFILE_KEYS } from '../../storage/settings.ts';
import { isIp } from '../../shared/url.ts';
import { AD_MUTE_SITES } from '../video/ad-state.ts';
import { VAST_REQUEST_REGEX } from '../video/generic.ts';
import { TWITCH_SITES, YOUTUBE_SITES } from '../video/youtube.ts';
import { CDN_COOKIE_HOSTS } from './cdn-cookies.ts';
import { MATRIX_FIRST_ID, MAX_MATRIX_RULES, matrixRules, parseMatrix } from './matrix.ts';
import { PROTECTED_HOSTS, PROTECTED_PATTERNS } from './protected-hosts.ts';

/** Client Hints that tell device details beyond the default ones (brand, mobile, platform). */
export const HIGH_ENTROPY_HINTS = [
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-full-version',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-model',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-wow64',
  'sec-ch-ua-form-factors',
  'device-memory',
  'sec-ch-device-memory',
];

/** Dynamic rule IDs 1–999 are reserved for control rules; filter rules start at 1000. */
export const RULE_GLOBAL_OFF = 1;
export const RULE_PAUSED_SITES = 2;
export const RULE_THIRD_PARTY_COOKIES = 3;
export const RULE_NOCOOKIE_EMBEDS = 4;
export const RULE_SITE_NETWORK = 5;
export const RULE_SITE_SECURITY = 6;
export const RULE_GPC = 7;
export const RULE_CDN_COOKIES = 8;
export const RULE_GLOBAL_OFF_FRAMELESS = 9;
export const RULE_LOCALE = 10;
export const RULE_ROTATING_ADS = 11;
export const RULE_ROTATING_AD_HOST = 12;
export const RULE_CAMPAIGN_PARAMS = 13;
export const RULE_EMPTY_VAST = 14;
export const RULE_CLIENT_HINTS = 15;
/** Click-to-load: one rule per embed regex, 16 to 19. */
export const RULE_CLICK_TO_LOAD = 16;
/** AX-Brain layer 2: one rule per action over every learned tracker. */
export const RULE_LEARNED_COOKIES = 20;
export const RULE_LEARNED_BLOCK = 21;
/** Paranoid profile: scripts from other sites, except on sites the user allowed. */
export const RULE_THIRD_PARTY_SCRIPTS = 22;
export const CONTROL_RULE_IDS = [
  RULE_GLOBAL_OFF,
  RULE_PAUSED_SITES,
  RULE_THIRD_PARTY_COOKIES,
  RULE_NOCOOKIE_EMBEDS,
  RULE_SITE_NETWORK,
  RULE_SITE_SECURITY,
  RULE_GPC,
  RULE_CDN_COOKIES,
  RULE_GLOBAL_OFF_FRAMELESS,
  RULE_LOCALE,
  RULE_ROTATING_ADS,
  RULE_ROTATING_AD_HOST,
  RULE_CAMPAIGN_PARAMS,
  RULE_EMPTY_VAST,
  RULE_CLIENT_HINTS,
  RULE_CLICK_TO_LOAD,
  RULE_CLICK_TO_LOAD + 1,
  RULE_CLICK_TO_LOAD + 2,
  RULE_CLICK_TO_LOAD + 3,
  RULE_LEARNED_COOKIES,
  RULE_LEARNED_BLOCK,
  RULE_THIRD_PARTY_SCRIPTS,
  ...Array.from({ length: MAX_MATRIX_RULES }, (_, i) => MATRIX_FIRST_ID + i),
];
/** Above list exceptions, so an unbreak rule does not quietly let every script through. */
export const SCRIPT_RULE_PRIORITY = 50;
/** Above filter-list exceptions (which would otherwise skip header removal), below pausing. */
export const COOKIE_RULE_PRIORITY = 100;
/**
 * Above any priority a filter list compiles to, so pausing always wins. Must stay below 2^24:
 * Chromium shifts the priority 8 bits into a 32-bit key, and larger values silently lose.
 */
export const CONTROL_PRIORITY = 1_000_000;
/**
 * Embed scripts and frames that click-to-load holds back: the Facebook SDK and post frames, X's
 * widget script and frames, Disqus's loader. Above list exceptions (unbreak lists allow the SDKs),
 * below a warning-page proceed; a click allows them in its tab one step higher. Separate regexes:
 * Chromium refuses the joined one as too large, and then every control rule fails.
 */
export const EMBED_REGEXES = [
  '^https://connect\\.facebook\\.net/[^/]+/(?:sdk|all)\\.js',
  '^https://www\\.facebook\\.com/(?:v[0-9.]+/)?plugins/',
  '^https://platform\\.(?:twitter|x)\\.com/(?:widgets\\.js|embed/)',
  '^https://[a-z0-9-]+\\.disqus\\.com/embed\\.js',
];
/** What a click lets through in its tab: the hosts behind those regexes. */
export const EMBED_HOSTS = [
  'connect.facebook.net',
  'www.facebook.com',
  'platform.twitter.com',
  'platform.x.com',
  'disqus.com',
];
export const EMBED_BLOCK_PRIORITY = 40;
export const EMBED_ALLOW_PRIORITY = 45;
/** The embeds' own sites use them as first party. */
const EMBED_OWNERS = ['facebook.com', 'twitter.com', 'x.com', 'disqus.com'];

export const CONTENT_SCRIPT_FILES = {
  cosmetic: 'content/cosmetic.js',
  consent: 'content/consent.js',
  'consent-eval': 'content/consent-eval.js',
  'fp-noise': 'content/fp-noise.js',
  'fp-strict': 'content/fp-strict.js',
  popups: 'content/popups.js',
  scriptlets: 'content/scriptlets.js',
  'scriptlets-delta': 'content/scriptlets-delta.js',
  gpc: 'content/gpc.js',
  locale: 'content/locale.js',
  'tw-ads': 'content/tw-ads.js',
  'link-clean': 'content/link-clean.js',
  /** Not registered: injected once, when the user opens the picker from the popup. */
  picker: 'content/picker.js',
  'yt-ads': 'content/yt-ads.js',
  'yt-skip': 'content/yt-skip.js',
  'yt-guard': 'content/yt-guard.js',
  'yt-autoskip': 'content/yt-autoskip.js',
  'video-ads': 'content/video-ads.js',
  'video-generic': 'content/video-generic.js',
  'click-to-load': 'content/click-to-load.js',
  'brain-scan': 'content/brain-scan.js',
  'brain-signals': 'content/brain-signals.js',
  'miner-guard': 'content/miner-guard.js',
  'miner-relay': 'content/miner-relay.js',
} as const;
/**
 * Main-world scripts cannot receive a value from the worker synchronously, so the fingerprint
 * noise seed is spelled by registering an ordered pick of these one-digit files before `fp-noise`.
 */
export const FP_SEED_DIGITS = 16;
/** Picked per browser session: 16!/8! orderings, about 29 bits. */
export const FP_SEED_LENGTH = 8;
export const fpSeedFile = (d: number) => `content/fp-seed/${d.toString(16)}.js`;
/** Which of its jobs the ad-time script does, spelled the same way: a file per job, run first. */
export const AD_MODES = ['mute', 'speed'] as const;
export const adModeFile = (m: (typeof AD_MODES)[number]) => `content/ad-mode/${m}.js`;

/** A random ordered pick of distinct seed digits. */
export function newFpSeed(random: () => number = Math.random): number[] {
  const pool = Array.from({ length: FP_SEED_DIGITS }, (_, i) => i);
  return Array.from(
    { length: FP_SEED_LENGTH },
    () => pool.splice(Math.floor(random() * pool.length), 1)[0] as number,
  );
}

/** Hash table of generic-rule words, generated by `scripts/filters.ts`. */
export const GENERIC_TOKENS_JS = 'content/generic-tokens.js';
/** Stylesheets written by `scripts/build.ts` from the YouTube data file; CSS-only content scripts. */
export const YT_SPONSORED_CSS = 'content/yt-sponsored.css';
export const YT_SPONSORED_HIDE_CSS = 'content/yt-sponsored-hide.css';
/** autoconsent's compact CMP rules as a string in `self.__axConsentRules`; `scripts/build.ts`. */
export const CONSENT_RULES_JS = 'content/consent-rules.js';
/** Payment, bank, captcha and sign-in pages break when touched; never inject there. */
export const ALWAYS_EXCLUDED = [
  ...PROTECTED_HOSTS.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]),
  ...PROTECTED_PATTERNS,
];

type Rule = chrome.declarativeNetRequest.Rule;
type ResourceType = chrome.declarativeNetRequest.ResourceType;
type RuleActionType = chrome.declarativeNetRequest.RuleActionType;

const ALLOW_ALL = 'allowAllRequests' as RuleActionType;
const MAIN_FRAME = 'main_frame' as ResourceType;
const SUB_FRAME = 'sub_frame' as ResourceType;

/** Trackers AX-Brain learned, per action (see `engines/brain/trackers.ts`). */
export interface LearnedTrackers {
  cookie: string[];
  block: string[];
}

export function controlRules(
  s: Settings,
  learned: LearnedTrackers = { cookie: [], block: [] },
): Rule[] {
  const rules: Rule[] = [];
  if (!s.enabled) {
    rules.push({
      id: RULE_GLOBAL_OFF,
      priority: CONTROL_PRIORITY,
      action: { type: ALLOW_ALL },
      condition: { resourceTypes: [MAIN_FRAME, SUB_FRAME] },
    });
    // allowAllRequests only reaches into frames; a service worker's requests have none.
    rules.push({
      id: RULE_GLOBAL_OFF_FRAMELESS,
      priority: CONTROL_PRIORITY,
      action: { type: 'allow' as RuleActionType },
      condition: {},
    });
  }
  if (s.pausedSites.length > 0) {
    rules.push({
      id: RULE_PAUSED_SITES,
      priority: CONTROL_PRIORITY,
      action: { type: ALLOW_ALL },
      condition: { requestDomains: [...s.pausedSites], resourceTypes: [MAIN_FRAME] },
    });
  }
  if (s.enabled && s.privacy.blockThirdPartyCookies) {
    const skipCookies = sitesOff(s, 'privacy');
    rules.push({
      id: RULE_THIRD_PARTY_COOKIES,
      priority: COOKIE_RULE_PRIORITY,
      action: {
        type: 'modifyHeaders' as RuleActionType,
        requestHeaders: [
          { header: 'cookie', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
        ],
        responseHeaders: [
          {
            header: 'set-cookie',
            operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
          },
        ],
      },
      condition: {
        domainType: 'thirdParty' as chrome.declarativeNetRequest.DomainType,
        excludedResourceTypes: [MAIN_FRAME],
        ...(skipCookies.length > 0 && { excludedInitiatorDomains: skipCookies }),
      },
    });
  }
  // Brave sends this header itself. Elsewhere only page requests carry it: the toolbar's blocked
  // count includes header rules, so every-request coverage would make that number meaningless.
  if (s.enabled && s.privacy.gpc && s.isBrave !== true) {
    const skip = sitesOff(s, 'privacy');
    rules.push({
      id: RULE_GPC,
      priority: COOKIE_RULE_PRIORITY,
      action: {
        type: 'modifyHeaders' as RuleActionType,
        requestHeaders: [
          {
            header: 'sec-gpc',
            operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
            value: '1',
          },
        ],
      },
      condition: {
        resourceTypes: [MAIN_FRAME, SUB_FRAME],
        ...(skip.length > 0 && { excludedInitiatorDomains: skip, excludedRequestDomains: skip }),
      },
    });
  }
  // Client Hints: a third party gets the low-detail hints every request carries, nothing more.
  if (s.enabled && s.privacy.limitClientHints) {
    const skip = sitesOff(s, 'privacy');
    const remove = (header: string) => ({
      header,
      operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
    });
    rules.push({
      id: RULE_CLIENT_HINTS,
      priority: COOKIE_RULE_PRIORITY,
      action: {
        type: 'modifyHeaders' as RuleActionType,
        requestHeaders: HIGH_ENTROPY_HINTS.map(remove),
        responseHeaders: ['accept-ch', 'critical-ch'].map(remove),
      },
      condition: {
        domainType: 'thirdParty' as chrome.declarativeNetRequest.DomainType,
        ...(skip.length > 0 && { excludedInitiatorDomains: skip }),
      },
    });
  }
  // Pages only, for the same reason as the GPC header above.
  if (s.enabled && s.privacy.hideLocale) {
    const skip = sitesOff(s, 'privacy');
    rules.push({
      id: RULE_LOCALE,
      priority: COOKIE_RULE_PRIORITY,
      action: {
        type: 'modifyHeaders' as RuleActionType,
        requestHeaders: [
          {
            header: 'accept-language',
            operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
            value: 'en-US,en;q=0.9',
          },
        ],
      },
      condition: {
        resourceTypes: [MAIN_FRAME, SUB_FRAME],
        ...(skip.length > 0 && { excludedInitiatorDomains: skip, excludedRequestDomains: skip }),
      },
    });
  }
  if (s.enabled && s.privacy.cdnCookies && !s.privacy.blockThirdPartyCookies) {
    const skip = sitesOff(s, 'privacy');
    rules.push({
      id: RULE_CDN_COOKIES,
      priority: COOKIE_RULE_PRIORITY,
      action: {
        type: 'modifyHeaders' as RuleActionType,
        requestHeaders: [
          { header: 'cookie', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
        ],
        responseHeaders: [
          {
            header: 'set-cookie',
            operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
          },
        ],
      },
      condition: {
        requestDomains: [...CDN_COOKIE_HOSTS],
        domainType: 'thirdParty' as chrome.declarativeNetRequest.DomainType,
        excludedResourceTypes: [MAIN_FRAME],
        ...(skip.length > 0 && { excludedInitiatorDomains: skip }),
      },
    });
  }
  const networkOff = sitesOff(s, 'network');
  if (s.enabled && networkOff.length > 0) {
    rules.push({
      id: RULE_SITE_NETWORK,
      priority: CONTROL_PRIORITY,
      action: { type: 'allow' as RuleActionType },
      condition: {
        initiatorDomains: networkOff,
        excludedResourceTypes: [MAIN_FRAME],
      },
    });
  }
  const securityOff = profileOnlyOff(s, 'security');
  if (s.enabled && securityOff.length > 0) {
    rules.push({
      id: RULE_SITE_SECURITY,
      priority: CONTROL_PRIORITY,
      action: { type: 'allow' as RuleActionType },
      condition: {
        requestDomains: securityOff,
        resourceTypes: [MAIN_FRAME, SUB_FRAME],
      },
    });
  }
  // An ad network moves its hosts every few days, so lists lag behind; the address shape stays.
  // Its loaders sit on a three-word .com, and the page's fallback goes straight to a random .in.
  // Two rules: Chromium rejects the joined regex as too large, and then every control rule fails.
  if (s.enabled) {
    const regexes: [number, string][] = [
      [RULE_ROTATING_ADS, '^https?://[a-z]{14,}\\.com/(?:bn|in|on)\\.js$'],
      [RULE_ROTATING_AD_HOST, '^https?://(?:www\\.)?[a-z]{10,14}\\.in(?:/[a-z]{2,10}){1,3}$'],
    ];
    for (const [id, regexFilter] of regexes) {
      rules.push({
        id,
        priority: 1,
        action: { type: 'block' as RuleActionType },
        condition: {
          regexFilter,
          resourceTypes: ['script', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[],
          domainType: 'thirdParty' as chrome.declarativeNetRequest.DomainType,
        },
      });
    }
  }
  // The tracking-parameter list leaves the five standard campaign tags alone; pages only.
  // shortcut: ignores the list's few per-site exceptions for these, pause the site if one breaks.
  if (s.enabled && s.privacy.cleanLinks) {
    const skip = sitesOff(s, 'privacy');
    rules.push({
      id: RULE_CAMPAIGN_PARAMS,
      // Same as a list's own parameter rules, so a blocked page stays blocked.
      priority: 1,
      action: {
        type: 'redirect' as RuleActionType,
        redirect: {
          transform: {
            queryTransform: {
              removeParams: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
            },
          },
        },
      },
      condition: {
        urlFilter: 'utm_',
        resourceTypes: [MAIN_FRAME],
        ...(skip.length > 0 && { excludedInitiatorDomains: skip, excludedRequestDomains: skip }),
      },
    });
  }
  // A player whose ad request is merely blocked may wait or show an error; an empty VAST answer
  // tells it there is no ad, and the content starts. Above a list's block, below its exceptions.
  if (s.enabled && s.video.genericPlayers) {
    const skip = sitesOff(s, 'video');
    rules.push({
      id: RULE_EMPTY_VAST,
      priority: 2,
      action: {
        type: 'redirect' as RuleActionType,
        redirect: { extensionPath: '/surrogates/noop-vast3.xml' },
      },
      condition: {
        regexFilter: VAST_REQUEST_REGEX,
        resourceTypes: ['xmlhttprequest'] as chrome.declarativeNetRequest.ResourceType[],
        ...(skip.length > 0 && { excludedInitiatorDomains: skip }),
      },
    });
  }
  if (s.enabled && s.privacy.clickToLoad) {
    const skip = [...EMBED_OWNERS, ...sitesOff(s, 'privacy')];
    EMBED_REGEXES.forEach((regexFilter, i) =>
      rules.push({
        id: RULE_CLICK_TO_LOAD + i,
        priority: EMBED_BLOCK_PRIORITY,
        action: { type: 'block' as RuleActionType },
        condition: {
          regexFilter,
          isUrlFilterCaseSensitive: true,
          resourceTypes: ['script', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[],
          excludedInitiatorDomains: skip,
        },
      }),
    );
  }
  // Learned trackers follow AX-Brain: off where it or the network layer is off for the page.
  if (s.enabled && s.shields.cosmetic) {
    const skip = [...new Set([...sitesOff(s, 'brain'), ...sitesOff(s, 'network')])].sort();
    const except = skip.length > 0 ? { excludedInitiatorDomains: skip } : {};
    if (learned.cookie.length > 0 && !s.privacy.blockThirdPartyCookies) {
      rules.push({
        id: RULE_LEARNED_COOKIES,
        priority: COOKIE_RULE_PRIORITY,
        action: {
          type: 'modifyHeaders' as RuleActionType,
          requestHeaders: [
            {
              header: 'cookie',
              operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
            },
          ],
          responseHeaders: [
            {
              header: 'set-cookie',
              operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
            },
          ],
        },
        condition: {
          requestDomains: learned.cookie,
          domainType: 'thirdParty' as chrome.declarativeNetRequest.DomainType,
          excludedResourceTypes: [MAIN_FRAME],
          ...except,
        },
      });
    }
    // Lowest priority: any list exception (an unbreak rule) wins over a learned block.
    if (learned.block.length > 0) {
      rules.push({
        id: RULE_LEARNED_BLOCK,
        priority: 1,
        action: { type: 'block' as RuleActionType },
        condition: {
          requestDomains: learned.block,
          domainType: 'thirdParty' as chrome.declarativeNetRequest.DomainType,
          excludedResourceTypes: [MAIN_FRAME],
          ...except,
        },
      });
    }
  }
  if (s.enabled && s.matrix.on) rules.push(...matrixRules(parseMatrix(s.matrix.rules)));
  if (s.enabled && s.privacy.blockThirdPartyScripts) {
    // Payment, bank and captcha pages and scripts are never cut: a broken checkout costs money.
    const skip = [
      ...new Set([...s.privacy.scriptSites, ...sitesOff(s, 'privacy'), ...PROTECTED_HOSTS]),
    ].sort();
    rules.push({
      id: RULE_THIRD_PARTY_SCRIPTS,
      priority: SCRIPT_RULE_PRIORITY,
      action: { type: 'block' as RuleActionType },
      condition: {
        domainType: 'thirdParty' as chrome.declarativeNetRequest.DomainType,
        resourceTypes: ['script' as ResourceType],
        excludedInitiatorDomains: skip,
        excludedRequestDomains: [...PROTECTED_HOSTS],
      },
    });
  }
  if (s.enabled && s.video.nocookieEmbeds) {
    rules.push({
      id: RULE_NOCOOKIE_EMBEDS,
      priority: COOKIE_RULE_PRIORITY,
      action: {
        type: 'redirect' as RuleActionType,
        redirect: { transform: { host: 'www.youtube-nocookie.com' } },
      },
      condition: {
        requestDomains: ['youtube.com'],
        urlFilter: '/embed/',
        resourceTypes: [SUB_FRAME],
        excludedInitiatorDomains: [...YOUTUBE_SITES],
      },
    });
  }
  return rules;
}

export function sitePatterns(site: string): string[] {
  return isIp(site) ? [`*://${site}/*`] : [`*://${site}/*`, `*://*.${site}/*`];
}

export type SiteModule = keyof SiteProfile;

export function siteProfile(s: Settings, site: string | null): SiteProfile {
  if (!s.enabled || site === null || s.pausedSites.includes(site)) {
    return Object.fromEntries(PROFILE_KEYS.map((k) => [k, false])) as unknown as SiteProfile;
  }
  return { ...DEFAULT_SITE_PROFILE, ...s.siteProfiles[site] };
}

export function moduleOn(s: Settings, site: string | null, m: SiteModule): boolean {
  return siteProfile(s, site)[m];
}

/** Paused sites plus those that turned this module off. */
export function sitesOff(s: Settings, m: SiteModule): string[] {
  return [...new Set([...s.pausedSites, ...profileOnlyOff(s, m)])].sort();
}

/** Profile exceptions only; pause is handled by its own rule. */
export function profileOnlyOff(s: Settings, m: SiteModule): string[] {
  return Object.entries(s.siteProfiles)
    .filter(([site, p]) => !s.pausedSites.includes(site) && p[m] === false)
    .map(([site]) => site)
    .sort();
}

export function contentScripts(
  s: Settings,
  fpSeed: readonly number[] = [],
  /** Updated lists brought `+js()` rows the package lacks (background/list-updates.ts). */
  scriptletDelta = false,
): chrome.scripting.RegisteredContentScript[] {
  if (!s.enabled) return [];
  const exclude = (...ms: SiteModule[]) => [
    ...ALWAYS_EXCLUDED,
    ...[...new Set(ms.flatMap((m) => sitesOff(s, m)))].flatMap(sitePatterns),
  ];
  const youtube = YOUTUBE_SITES.flatMap(sitePatterns);
  const script = (
    id: keyof typeof CONTENT_SCRIPT_FILES,
    world: 'ISOLATED' | 'MAIN' = 'ISOLATED',
    matches = ['http://*/*', 'https://*/*'],
    module: SiteModule = 'network',
    ...also: SiteModule[]
  ): chrome.scripting.RegisteredContentScript => ({
    id,
    js: [CONTENT_SCRIPT_FILES[id]],
    matches,
    excludeMatches: exclude(module, ...also),
    runAt: 'document_start' as chrome.extensionTypes.RunAt,
    allFrames: true,
    persistAcrossSessions: true,
    ...(world === 'MAIN' && {
      world: 'MAIN' as chrome.scripting.ExecutionWorld,
      // about:blank and srcdoc frames share the parent's origin; fingerprinters use them.
      matchOriginAsFallback: true,
    }),
  });
  // The data files run first in the same pass, so hooks are in place before any page script.
  const scriptlets = script('scriptlets', 'MAIN', undefined, 'network', 'scriptlets');
  scriptlets.js = [
    ...BUILTIN_LISTS.filter((l) => l.scriptlets && s.enabledLists.includes(l.id)).map(
      (l) => `scriptlets/${l.id}.js`,
    ),
    CONTENT_SCRIPT_FILES.scriptlets,
  ];
  // Lists prune YouTube's player data too; the YouTube switch has to mean that as well.
  if (!s.video.youtubeAds)
    scriptlets.excludeMatches = [...(scriptlets.excludeMatches ?? []), ...youtube];
  const cosmetic = script('cosmetic', 'ISOLATED', undefined, 'network', 'cosmetic');
  // Host-scoped custom rules (all the picker writes) are found by hostname, not through this table.
  const genericCustom = /^(?:~[^#\n]*)?##/m.test(s.customRules);
  const onlyBuiltin = !genericCustom && !s.userLists.some((l) => l.enabled);
  if (onlyBuiltin) cosmetic.js = [GENERIC_TOKENS_JS, CONTENT_SCRIPT_FILES.cosmetic];
  const scripts = [
    ...(s.shields.cosmetic
      ? [
          cosmetic,
          script('brain-scan', 'ISOLATED', undefined, 'network', 'brain'),
          script('brain-signals', 'MAIN', undefined, 'network', 'brain'),
        ]
      : []),
    ...(s.shields.popups ? [script('popups', 'MAIN')] : []),
    scriptlets,
    ...(scriptletDelta
      ? [script('scriptlets-delta', 'ISOLATED', undefined, 'network', 'scriptlets')]
      : []),
    // Crypto miners the lists missed (engines/security/miner.ts).
    script('miner-guard', 'MAIN', undefined, 'security'),
    script('miner-relay', 'ISOLATED', undefined, 'security'),
  ];
  if (s.privacy.gpc) scripts.push(script('gpc', 'MAIN', undefined, 'privacy'));
  if (s.privacy.hideLocale) scripts.push(script('locale', 'MAIN', undefined, 'privacy'));
  if (s.privacy.cleanLinks) {
    scripts.push({ ...script('link-clean', 'ISOLATED', undefined, 'privacy'), allFrames: false });
  }
  if (s.privacy.cookieAutoReject) {
    const consent = script('consent', 'ISOLATED', undefined, 'privacy');
    consent.js = [CONSENT_RULES_JS, CONTENT_SCRIPT_FILES.consent];
    scripts.push(consent, script('consent-eval', 'MAIN', undefined, 'privacy'));
  }
  if (s.privacy.clickToLoad) {
    scripts.push({
      ...script('click-to-load', 'ISOLATED', undefined, 'privacy'),
      allFrames: false,
    });
  }
  if (s.privacy.fingerprint !== 'off') {
    const noise = script('fp-noise', 'MAIN', undefined, 'privacy');
    noise.js = [...fpSeed.map(fpSeedFile), CONTENT_SCRIPT_FILES['fp-noise']];
    scripts.push(noise);
  }
  if (s.privacy.fingerprint === 'strict') {
    scripts.push(script('fp-strict', 'MAIN', undefined, 'privacy'));
  }
  if (s.video.youtubeAds) {
    scripts.push(script('yt-ads', 'MAIN', youtube, 'video'));
    scripts.push(script('yt-guard', 'ISOLATED', youtube, 'video'));
  }
  if (s.video.autoSkipAds) scripts.push(script('yt-autoskip', 'ISOLATED', youtube, 'video'));
  if (s.video.genericPlayers) {
    // YouTube and Twitch have their own handling; this layer stays off there.
    const generic = script('video-generic', 'MAIN', undefined, 'video');
    generic.excludeMatches = [
      ...(generic.excludeMatches ?? []),
      ...[...YOUTUBE_SITES, ...TWITCH_SITES].flatMap(sitePatterns),
    ];
    scripts.push(generic);
  }
  if (s.video.twitchAds) {
    scripts.push(script('tw-ads', 'MAIN', TWITCH_SITES.flatMap(sitePatterns), 'video'));
  }
  if (s.video.sponsorSkip) scripts.push(script('yt-skip', 'ISOLATED', youtube, 'video'));
  if (s.video.adMute || s.video.adSpeedUp) {
    const ads = script('video-ads', 'ISOLATED', AD_MUTE_SITES.flatMap(sitePatterns), 'video');
    ads.js = [
      ...(s.video.adMute ? [adModeFile('mute')] : []),
      ...(s.video.adSpeedUp ? [adModeFile('speed')] : []),
      CONTENT_SCRIPT_FILES['video-ads'],
    ];
    scripts.push(ads);
  }
  if (s.video.markSponsored || s.video.hideSponsored) {
    scripts.push({
      id: 'yt-sponsored',
      css: [s.video.hideSponsored ? YT_SPONSORED_HIDE_CSS : YT_SPONSORED_CSS],
      matches: youtube,
      excludeMatches: exclude('video'),
      runAt: 'document_start' as chrome.extensionTypes.RunAt,
      persistAcrossSessions: true,
    });
  }
  return scripts;
}

export function isProtected(s: Settings, site: string | null): boolean {
  return s.enabled && site !== null && !s.pausedSites.includes(site);
}
