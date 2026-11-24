import type {
  CustomRulesResult,
  ExtendedRule,
  FingerprintLevel,
  ListsView,
  PopupState,
  PrivacySettings,
  SegmentPlan,
  Settings,
  SettingsExport,
  ShieldSettings,
  SiteProfile,
  StatsView,
  TabReport,
  Theme,
  VideoSettings,
  YoutubeWarnings,
} from './types.ts';
import { isValidSite, MAX_KEPT_SITES, siteList } from './site.ts';
import { SITE_LEVELS, type SiteLevel } from './site-level.ts';
import {
  FEATURE_COUNT,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  type BrainModel,
} from '../engines/brain/brain.ts';
import type { TrackerView } from '../engines/brain/trackers.ts';
import { BRANDS } from '../engines/security/page-checks.ts';
import { MAX_MATRIX_RULES, matrixLine, parseMatrix } from '../engines/core/matrix.ts';
import type { NanoAvailability, NanoQuestion } from '../background/nano.ts';
import { channelList, isSkipMode, isSponsorCategory, SPONSOR_CATEGORIES } from './sponsor.ts';

type NoPayload = Record<never, never>;

/** Whether a page's sign-in is stopped, with the reasons shown on the page. */
export interface LoginVerdict {
  block: boolean;
  reasons: string[];
}

export interface DomFeatures {
  classes: string[];
  ids: string[];
  hrefs: string[];
}

export interface Api {
  'popup/state': { req: { url: string }; res: PopupState };
  'settings/get': { req: NoPayload; res: Settings };
  'global/set': { req: { enabled: boolean }; res: Settings };
  'site/setPaused': { req: { site: string; paused: boolean }; res: Settings };
  /** The site misbehaves: protection off for a while, and back on by itself. */
  'site/pauseBriefly': { req: { site: string }; res: Settings };
  /** Internal: pauses whose time is up end. */
  'site/expirePauses': { req: NoPayload; res: Settings };
  'site/setProfile': { req: { site: string; profile: Partial<SiteProfile> }; res: Settings };
  'site/setLevel': { req: { site: string; level: SiteLevel }; res: Settings };
  'env/brave': { req: { isBrave: boolean }; res: Settings };
  'rules/setCustom': { req: { text: string }; res: CustomRulesResult };
  'rules/report': { req: NoPayload; res: CustomRulesResult };
  /** Removes exactly one line of the custom rules. */
  'rules/removeLine': { req: { line: string }; res: Settings };
  /** From the popup: opens the element picker in that tab and allows it to save one rule. */
  'picker/start': { req: { tabId: number }; res: null };
  /** From the picker in the top frame; refused unless the popup started it. */
  /** `features`: AX-Brain vector of the picked element; the brain learns from it. */
  'picker/add': { req: { selector: string; features?: number[] }; res: { rule: string } };
  'picker/cancel': { req: NoPayload; res: null };
  'lists/get': { req: NoPayload; res: ListsView };
  'lists/setEnabled': { req: { id: string; enabled: boolean }; res: ListsView };
  'lists/setAutoUpdate': { req: { enabled: boolean }; res: ListsView };
  /** Checks every enabled packaged list for a newer version now. */
  'lists/updateNow': { req: NoPayload; res: ListsView };
  'userList/add': { req: { url: string }; res: ListsView };
  'userList/remove': { req: { url: string }; res: ListsView };
  'userList/setEnabled': { req: { url: string; enabled: boolean }; res: ListsView };
  'userList/refresh': { req: NoPayload; res: ListsView };
  'cosmetic/start': { req: NoPayload; res: { extended: ExtendedRule[] } };
  'cosmetic/dom': { req: DomFeatures; res: { extended: ExtendedRule[] } };
  /** The user middle/ctrl-clicked or right-clicked a link: a new tab for it is not a popup. */
  'popup/userOpen': { req: { url: string }; res: null };
  'privacy/set': { req: { privacy: Partial<PrivacySettings> }; res: Settings };
  'video/set': { req: { video: Partial<VideoSettings> }; res: Settings };
  'theme/set': { req: { theme: Theme }; res: Settings };
  /** Sponsor segments of a YouTube video; empty unless the user turned SponsorBlock on. */
  'video/segments': { req: { videoId: string }; res: SegmentPlan };
  /** YouTube showed its ad blocker warning in this tab; the tab backs off. Only counted. */
  'video/warned': { req: NoPayload; res: null };
  'video/warnings': { req: NoPayload; res: YoutubeWarnings };
  'stats/get': { req: { days: 7 | 30 }; res: StatsView };
  'stats/clear': { req: NoPayload; res: StatsView };
  'settings/export': { req: NoPayload; res: SettingsExport };
  'settings/import': { req: { data: unknown }; res: Settings };
  'tab/report': { req: { tabId: number }; res: TabReport };
  /** autoconsent's own protocol, wrapped; the reply (if any) goes back to its callback. */
  'consent/msg': { req: { msg: ConsentMessage }; res: unknown };
  /** From the warning page: the user chose to open a blocked site anyway. */
  'security/proceed': { req: { url: string }; res: null };
  /** A top-level http: page has a password field. */
  'security/insecurePassword': { req: NoPayload; res: null };
  /** The top page's password form posts to another site (its host). */
  'security/passwordElsewhere': { req: { host: string }; res: null };
  /** From the page: crypto mining seen; `stopped` when its workers were ended. */
  'security/miner': { req: { stopped: boolean }; res: null };
  /** From the page: a sign-in page names `brand` but is not on its domains. */
  /**
   * A page with a password field asks whether sign-in should be stopped. `brand` is the brand its
   * title or logo claims while the address is none of that brand's (checked again in the background).
   */
  'security/login': { req: { brand: string | null }; res: LoginVerdict };
  /** The user chose to sign in anyway: the page's host is let through for this browser session. */
  'security/allowLogin': { req: NoPayload; res: null };
  /** The top page reads like a fake "your PC is infected, call us" alert. */
  'security/supportScam': { req: NoPayload; res: null };
  /** Click-to-load: whether embeds are held back in this tab. */
  'embed/status': { req: NoPayload; res: { blocked: boolean } };
  /** The user clicked an embed placeholder: embeds load in this tab until it closes. */
  'embed/load': { req: NoPayload; res: null };
  /** AX-Brain model for the ad scanner; null when protection is off for the site. */
  /** `nano`: layer 3 is on and its model ready, so unsure elements may be asked about. */
  'brain/model': { req: NoPayload; res: { model: BrainModel; nano: boolean } | null };
  /** From the page: is this unsure element an ad? Gemini Nano on the device answers (layer 3). */
  'brain/ask': { req: NanoQuestion; res: boolean | null };
  /** Layer 3 on or off (UI only). */
  'brain/setNano': { req: { on: boolean }; res: null };
  /** The ad scanner hid an element: why (scorer reasons) and its AX-Brain vector. */
  'brain/hidden': { req: { reasons: string[]; features: number[] }; res: null };
  /** From the page: a script read a text canvas back or stored an ID (AX-Brain layer 2). */
  'brain/signal': { req: { signal: 'storage' | 'fingerprint'; source: string }; res: null };
  /** From the popup: something broke; AX-Brain unlearns this page and rests on the site. */
  'brain/pause': { req: { tabId: number }; res: null };
  /** From the page: the watchdog or the user rolled AX-Brain's hides back. */
  'brain/broke': { req: { reason: BrainBreak }; res: null };
  /** Forget what AX-Brain learned (UI only). */
  'brain/reset': { req: NoPayload; res: null };
  'brain/info': {
    req: NoPayload;
    res: {
      model: BrainModel;
      paused: { site: string; until: number }[];
      trackers: TrackerView[];
      nano: { on: boolean; availability: NanoAvailability };
    };
  };
  /** Drop one learned tracker; its rules go with it (UI only). */
  'brain/forgetTracker': { req: { domain: string }; res: null };
  'brain/import': { req: { model: unknown }; res: BrainModel };
  'brain/unpause': { req: { site: string }; res: null };
  /** AX-Brain hiding threshold, 0.5 to 0.99 (UI only). */
  'brain/setThreshold': { req: { threshold: number }; res: null };
  'shields/set': { req: { shields: Partial<ShieldSettings> }; res: Settings };
  /** Advanced mode switch and its rules (`site target type action` lines). */
  'matrix/set': { req: { on?: boolean; rules?: string[] }; res: Settings };
}

/** The autoconsent reports the background records; the content script handles the rest itself. */
export type ConsentMessage =
  { type: 'popupFound'; cmp: string } | { type: 'optOutResult'; cmp: string; result: boolean };

export type MessageType = keyof Api;
export type Message = { [K in MessageType]: { type: K } & Api[K]['req'] }[MessageType];
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export type SenderKind = 'ui' | 'content';

/** Message types a web page's content script may send; everything else is extension-UI only. */
export const CONTENT_TYPES: ReadonlySet<MessageType> = new Set<MessageType>([
  'cosmetic/start',
  'cosmetic/dom',
  'picker/add',
  'picker/cancel',
  'popup/userOpen',
  'consent/msg',
  'security/insecurePassword',
  'security/passwordElsewhere',
  'security/miner',
  'security/login',
  'security/allowLogin',
  'security/supportScam',
  'video/segments',
  'video/warned',
  'embed/status',
  'embed/load',
  'brain/model',
  'brain/ask',
  'brain/hidden',
  'brain/signal',
  'brain/broke',
]);

export type BrainBreak = 'user' | 'layout-shift' | 'empty-content' | 'scroll-locked';
const BRAIN_BREAKS: readonly BrainBreak[] = [
  'user',
  'layout-shift',
  'empty-content',
  'scroll-locked',
];

const FINGERPRINT_LEVELS: readonly FingerprintLevel[] = ['off', 'standard', 'strict'];

export function isFingerprintLevel(v: unknown): v is FingerprintLevel {
  return FINGERPRINT_LEVELS.includes(v as FingerprintLevel);
}

const shortString = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 200;

function parseConsent(raw: unknown): ConsentMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'popupFound':
      return shortString(m.cmp) ? { type: m.type, cmp: m.cmp } : null;
    case 'optOutResult':
      return shortString(m.cmp) && typeof m.result === 'boolean'
        ? { type: m.type, cmp: m.cmp, result: m.result }
        : null;
    default:
      return null;
  }
}

function parsePrivacy(raw: unknown): Partial<PrivacySettings> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<PrivacySettings> = {};
  for (const [k, v] of Object.entries(r)) {
    const flag =
      k === 'blockThirdPartyCookies' ||
      k === 'cookieAutoReject' ||
      k === 'gpc' ||
      k === 'cleanLinks' ||
      k === 'cdnCookies' ||
      k === 'hideLocalIps' ||
      k === 'hideLocale' ||
      k === 'browserAdApis' ||
      k === 'limitClientHints' ||
      k === 'clickToLoad' ||
      k === 'blockThirdPartyScripts' ||
      k === 'clearSiteData' ||
      k === 'detailedReports';
    if (flag && typeof v === 'boolean') {
      out[k] = v;
    } else if (k === 'fingerprint' && isFingerprintLevel(v)) {
      out.fingerprint = v;
    } else if (k === 'keepSiteData' && Array.isArray(v) && v.length <= MAX_KEPT_SITES) {
      out.keepSiteData = siteList(v);
    } else if (k === 'scriptSites' && Array.isArray(v) && v.length <= MAX_KEPT_SITES) {
      out.scriptSites = siteList(v);
    } else {
      return null;
    }
  }
  return out;
}

const PROFILE_PATCH: ReadonlySet<string> = new Set<keyof SiteProfile>([
  'network',
  'privacy',
  'video',
  'security',
  'cosmetic',
  'scriptlets',
  'generic',
  'brain',
]);

function parseProfile(raw: unknown): Partial<SiteProfile> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entries = Object.entries(raw);
  return entries.length > 0 &&
    entries.every(([k, v]) => PROFILE_PATCH.has(k) && typeof v === 'boolean')
    ? (Object.fromEntries(entries) as Partial<SiteProfile>)
    : null;
}

const VIDEO_KEYS: ReadonlySet<string> = new Set<keyof VideoSettings>([
  'youtubeAds',
  'twitchAds',
  'markSponsored',
  'hideSponsored',
  'autoSkipAds',
  'genericPlayers',
  'nocookieEmbeds',
  'adMute',
  'adSpeedUp',
  'sponsorSkip',
]);

/** YouTube video IDs: 11 characters of base64url. */
export const isVideoId = (v: unknown): v is string =>
  typeof v === 'string' && /^[\w-]{11}$/.test(v);

function parseVideo(raw: unknown): Partial<VideoSettings> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (VIDEO_KEYS.has(k) && typeof v === 'boolean') out[k] = v;
    else if (k === 'sponsorModes' && isFullModeMap(v)) out[k] = v;
    else if (k === 'sponsorChannels' && Array.isArray(v) && v.every((c) => typeof c === 'string')) {
      out[k] = channelList(v);
    } else return null;
  }
  return out as Partial<VideoSettings>;
}

/** Every category with a valid mode: the dashboard always sends the whole map. */
const isFullModeMap = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  Object.keys(v).length === SPONSOR_CATEGORIES.length &&
  Object.entries(v).every(([c, m]) => isSponsorCategory(c) && isSkipMode(m));

const MAX_CUSTOM_TEXT = 200_000;
const MAX_FEATURES = 5_000;
const MAX_FEATURE_LENGTH = 512;

function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter(
      (x): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_FEATURE_LENGTH,
    )
    .slice(0, MAX_FEATURES);
}

const isUrl = (v: unknown): v is string => typeof v === 'string' && v.length <= 2048;

const isFeatureVector = (f: unknown): f is number[] =>
  Array.isArray(f) &&
  f.length === FEATURE_COUNT &&
  f.every((v) => typeof v === 'number' && v >= 0 && v <= 1);

export function parseMessage(raw: unknown): Message | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'settings/get':
    case 'picker/cancel':
    case 'rules/report':
    case 'lists/updateNow':
    case 'lists/get':
    case 'userList/refresh':
    case 'stats/clear':
    case 'settings/export':
    case 'cosmetic/start':
    case 'security/insecurePassword':
    case 'security/allowLogin':
    case 'security/supportScam':
    case 'video/warned':
    case 'video/warnings':
    case 'embed/status':
    case 'embed/load':
    case 'brain/model':
    case 'brain/reset':
    case 'brain/info':
      return { type: m.type };
    case 'brain/import':
      return { type: m.type, model: m.model };
    case 'brain/unpause':
      return isValidSite(m.site) ? { type: m.type, site: m.site } : null;
    case 'brain/setNano':
      return typeof m.on === 'boolean' ? { type: m.type, on: m.on } : null;
    case 'brain/ask': {
      const hosts = Array.isArray(m.hosts) ? m.hosts : null;
      return typeof m.text === 'string' &&
        m.text.length <= 400 &&
        hosts !== null &&
        hosts.length <= 5 &&
        hosts.every((h) => typeof h === 'string' && /^[a-z0-9.-]{1,253}$/.test(h)) &&
        Number.isFinite(m.width) &&
        Number.isFinite(m.height)
        ? {
            type: m.type,
            text: m.text,
            hosts: hosts as string[],
            width: m.width as number,
            height: m.height as number,
          }
        : null;
    }
    case 'brain/setThreshold':
      return typeof m.threshold === 'number' &&
        m.threshold >= THRESHOLD_MIN &&
        m.threshold <= THRESHOLD_MAX
        ? { type: m.type, threshold: m.threshold }
        : null;
    case 'brain/forgetTracker':
      return isValidSite(m.domain) ? { type: m.type, domain: m.domain } : null;
    case 'matrix/set': {
      const out: { type: 'matrix/set'; on?: boolean; rules?: string[] } = { type: m.type };
      if (m.on !== undefined) {
        if (typeof m.on !== 'boolean') return null;
        out.on = m.on;
      }
      if (m.rules !== undefined) {
        if (!Array.isArray(m.rules) || m.rules.length > MAX_MATRIX_RULES * 2) return null;
        if (!m.rules.every((l) => typeof l === 'string' && l.length <= 600)) return null;
        out.rules = parseMatrix(m.rules as string[]).map(matrixLine);
      }
      return out;
    }
    case 'shields/set': {
      if (typeof m.shields !== 'object' || m.shields === null) return null;
      const raw = m.shields as Record<string, unknown>;
      const shields: Partial<ShieldSettings> = {};
      for (const [key, value] of Object.entries(raw)) {
        if ((key !== 'cosmetic' && key !== 'popups') || typeof value !== 'boolean') return null;
        shields[key] = value;
      }
      return { type: m.type, shields };
    }
    case 'popup/state':
      return typeof m.url === 'string' ? { type: m.type, url: m.url } : null;
    case 'global/set':
      return typeof m.enabled === 'boolean' ? { type: m.type, enabled: m.enabled } : null;
    case 'site/expirePauses':
      return { type: m.type };
    case 'site/pauseBriefly':
      return isValidSite(m.site) ? { type: m.type, site: m.site } : null;
    case 'site/setPaused':
      return isValidSite(m.site) && typeof m.paused === 'boolean'
        ? { type: m.type, site: m.site, paused: m.paused }
        : null;
    case 'site/setLevel':
      return isValidSite(m.site) && SITE_LEVELS.includes(m.level as SiteLevel)
        ? { type: m.type, site: m.site, level: m.level as SiteLevel }
        : null;
    case 'site/setProfile': {
      const profile = parseProfile(m.profile);
      return isValidSite(m.site) && profile ? { type: m.type, site: m.site, profile } : null;
    }
    case 'env/brave':
      return typeof m.isBrave === 'boolean' ? { type: m.type, isBrave: m.isBrave } : null;
    case 'rules/removeLine':
      return typeof m.line === 'string' && m.line.length <= 2048
        ? { type: m.type, line: m.line }
        : null;
    case 'picker/start':
      return typeof m.tabId === 'number' ? { type: m.type, tabId: m.tabId } : null;
    case 'picker/add': {
      if (typeof m.selector !== 'string' || m.selector.length > 1024) return null;
      if (m.features === undefined) return { type: m.type, selector: m.selector };
      return isFeatureVector(m.features)
        ? { type: m.type, selector: m.selector, features: m.features }
        : null;
    }
    case 'brain/signal':
      return (m.signal === 'storage' || m.signal === 'fingerprint') &&
        typeof m.source === 'string' &&
        m.source.length <= 2048 &&
        /^https?:\/\//.test(m.source)
        ? { type: m.type, signal: m.signal, source: m.source }
        : null;
    case 'brain/hidden':
      return isFeatureVector(m.features) &&
        Array.isArray(m.reasons) &&
        m.reasons.length <= 12 &&
        m.reasons.every((r) => typeof r === 'string' && /^[a-z-]{1,40}$/.test(r))
        ? { type: m.type, reasons: m.reasons as string[], features: m.features }
        : null;
    case 'security/login':
      return m.brand === null || (typeof m.brand === 'string' && Object.hasOwn(BRANDS, m.brand))
        ? { type: m.type, brand: m.brand }
        : null;
    case 'security/miner':
      return typeof m.stopped === 'boolean' ? { type: m.type, stopped: m.stopped } : null;
    case 'security/passwordElsewhere':
      return typeof m.host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(m.host)
        ? { type: m.type, host: m.host.toLowerCase() }
        : null;
    case 'brain/broke':
      return BRAIN_BREAKS.includes(m.reason as BrainBreak)
        ? { type: m.type, reason: m.reason as BrainBreak }
        : null;
    case 'brain/pause':
      return Number.isInteger(m.tabId) ? { type: m.type, tabId: m.tabId as number } : null;
    case 'rules/setCustom':
      return typeof m.text === 'string' && m.text.length <= MAX_CUSTOM_TEXT
        ? { type: m.type, text: m.text }
        : null;
    case 'lists/setAutoUpdate':
      return typeof m.enabled === 'boolean' ? { type: m.type, enabled: m.enabled } : null;
    case 'lists/setEnabled':
      return typeof m.id === 'string' && typeof m.enabled === 'boolean'
        ? { type: m.type, id: m.id, enabled: m.enabled }
        : null;
    case 'userList/add':
    case 'userList/remove':
    case 'popup/userOpen':
    case 'security/proceed':
      return isUrl(m.url) ? { type: m.type, url: m.url } : null;
    case 'userList/setEnabled':
      return isUrl(m.url) && typeof m.enabled === 'boolean'
        ? { type: m.type, url: m.url, enabled: m.enabled }
        : null;
    case 'cosmetic/dom': {
      const classes = stringList(m.classes);
      const ids = stringList(m.ids);
      const hrefs = stringList(m.hrefs);
      return classes && ids && hrefs ? { type: m.type, classes, ids, hrefs } : null;
    }
    case 'privacy/set': {
      const privacy = parsePrivacy(m.privacy);
      return privacy ? { type: m.type, privacy } : null;
    }
    case 'video/set': {
      const video = parseVideo(m.video);
      return video ? { type: m.type, video } : null;
    }
    case 'theme/set':
      return m.theme === 'dark' || m.theme === 'light' ? { type: m.type, theme: m.theme } : null;
    case 'stats/get':
      return m.days === 7 || m.days === 30 ? { type: m.type, days: m.days } : null;
    case 'settings/import':
      return { type: m.type, data: m.data };
    case 'video/segments':
      return isVideoId(m.videoId) ? { type: m.type, videoId: m.videoId } : null;
    case 'tab/report':
      return Number.isInteger(m.tabId) ? { type: m.type, tabId: m.tabId as number } : null;
    case 'consent/msg': {
      const msg = parseConsent(m.msg);
      return msg ? { type: m.type, msg } : null;
    }
    default:
      return null;
  }
}

export function senderKind(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  extensionOrigin: string,
): SenderKind | null {
  if (sender.id !== extensionId || !sender.url) return null;
  if (sender.url.startsWith(extensionOrigin)) return 'ui';
  return sender.tab ? 'content' : null;
}

export async function send<K extends MessageType>(
  type: K,
  req: Api[K]['req'],
): Promise<Api[K]['res']> {
  const reply = (await chrome.runtime.sendMessage({ type, ...req })) as Reply<Api[K]['res']>;
  if (!reply?.ok) throw new Error(reply?.error ?? 'No reply from background');
  return reply.data;
}
