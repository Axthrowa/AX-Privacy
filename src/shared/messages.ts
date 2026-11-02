import type {
  CustomRulesResult,
  ExtendedRule,
  FingerprintLevel,
  ListsView,
  PopupState,
  PrivacySettings,
  Segment,
  Settings,
  SettingsExport,
  SiteProfile,
  StatsView,
  TabReport,
  Theme,
  VideoSettings,
} from './types.ts';
import { isValidSite } from './site.ts';

type NoPayload = Record<never, never>;

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
  'env/brave': { req: { isBrave: boolean }; res: Settings };
  'rules/setCustom': { req: { text: string }; res: CustomRulesResult };
  'rules/report': { req: NoPayload; res: CustomRulesResult };
  /** Removes exactly one line of the custom rules. */
  'rules/removeLine': { req: { line: string }; res: Settings };
  /** From the popup: opens the element picker in that tab and allows it to save one rule. */
  'picker/start': { req: { tabId: number }; res: null };
  /** From the picker in the top frame; refused unless the popup started it. */
  'picker/add': { req: { selector: string }; res: { rule: string } };
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
  'video/segments': { req: { videoId: string }; res: Segment[] };
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
}

/** The autoconsent content-script messages the background acts on; the rest are dropped. */
export type ConsentMessage =
  | { type: 'init'; url: string }
  | { type: 'eval'; id: string; snippetId: string }
  | { type: 'popupFound'; cmp: string }
  | { type: 'optOutResult'; cmp: string; result: boolean }
  | { type: 'autoconsentDone'; cmp: string };

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
  'video/segments',
]);

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
    case 'init':
      return isUrl(m.url) ? { type: m.type, url: m.url } : null;
    case 'eval':
      return shortString(m.id) && shortString(m.snippetId)
        ? { type: m.type, id: m.id, snippetId: m.snippetId }
        : null;
    case 'popupFound':
    case 'autoconsentDone':
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
      k === 'detailedReports';
    if (flag && typeof v === 'boolean') {
      out[k] = v;
    } else if (k === 'fingerprint' && isFingerprintLevel(v)) {
      out.fingerprint = v;
    } else {
      return null;
    }
  }
  return out;
}

const PROFILE_PATCH: ReadonlySet<string> = new Set(['network', 'privacy', 'video', 'security']);

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
  'nocookieEmbeds',
  'adMute',
  'sponsorSkip',
]);

/** YouTube video IDs: 11 characters of base64url. */
export const isVideoId = (v: unknown): v is string =>
  typeof v === 'string' && /^[\w-]{11}$/.test(v);

function parseVideo(raw: unknown): Partial<VideoSettings> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entries = Object.entries(raw);
  return entries.every(([k, v]) => VIDEO_KEYS.has(k) && typeof v === 'boolean')
    ? (Object.fromEntries(entries) as Partial<VideoSettings>)
    : null;
}

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
      return { type: m.type };
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
    case 'picker/add':
      return typeof m.selector === 'string' && m.selector.length <= 1024
        ? { type: m.type, selector: m.selector }
        : null;
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
