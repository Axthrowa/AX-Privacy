import { BUILTIN_IDS, BUILTIN_LISTS } from '../filters/catalog.ts';
import { isFingerprintLevel } from '../shared/messages.ts';
import type {
  PrivacySettings,
  Settings,
  SettingsExport,
  SiteProfile,
  UserListRef,
  VideoSettings,
} from '../shared/types.ts';
import { isValidSite } from '../shared/site.ts';

const KEY = 'settings';
/** Lists added in settings version 3; older profiles get them switched on once. */
const ADDED_IN_V3 = [
  'ublock-unbreak',
  'ublock-quick-fixes',
  'brave-unbreak',
  'ublock-privacy',
  'pgl',
];

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  version: 3,
  autoUpdateLists: true,
  pauseUntil: {},
  enabled: true,
  pausedSites: [],
  enabledLists: BUILTIN_LISTS.filter((l) => l.defaultEnabled).map((l) => l.id),
  customRules: '',
  userLists: [],
  isBrave: null,
  privacy: {
    blockThirdPartyCookies: false,
    cookieAutoReject: false,
    fingerprint: 'off',
    gpc: true,
    cleanLinks: true,
    cdnCookies: true,
    detailedReports: false,
  },
  video: {
    youtubeAds: true,
    twitchAds: true,
    markSponsored: true,
    nocookieEmbeds: false,
    adMute: false,
    sponsorSkip: false,
  },
  theme: 'dark',
  siteProfiles: {},
};

export const DEFAULT_SITE_PROFILE: SiteProfile = {
  network: true,
  privacy: true,
  video: true,
  security: true,
};

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const record = (raw: unknown) =>
  (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

function normalizeVideo(raw: unknown): VideoSettings {
  const d = DEFAULT_SETTINGS.video;
  const r = record(raw);
  return {
    youtubeAds: bool(r.youtubeAds, d.youtubeAds),
    twitchAds: bool(r.twitchAds, d.twitchAds),
    markSponsored: bool(r.markSponsored, d.markSponsored),
    nocookieEmbeds: bool(r.nocookieEmbeds, d.nocookieEmbeds),
    adMute: bool(r.adMute, d.adMute),
    sponsorSkip: bool(r.sponsorSkip, d.sponsorSkip),
  };
}

function normalizePrivacy(raw: unknown): PrivacySettings {
  const d = DEFAULT_SETTINGS.privacy;
  const r = record(raw);
  return {
    blockThirdPartyCookies: bool(r.blockThirdPartyCookies, d.blockThirdPartyCookies),
    cookieAutoReject: bool(r.cookieAutoReject, d.cookieAutoReject),
    fingerprint: isFingerprintLevel(r.fingerprint) ? r.fingerprint : d.fingerprint,
    gpc: bool(r.gpc, d.gpc),
    cleanLinks: bool(r.cleanLinks, d.cleanLinks),
    cdnCookies: bool(r.cdnCookies, d.cdnCookies),
    detailedReports: bool(r.detailedReports, d.detailedReports),
  };
}

export function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS) as Settings;
}

export function isValidListUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const u = new URL(url);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local);
  } catch {
    return false;
  }
}

function normalizeUserLists(raw: unknown): UserListRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: UserListRef[] = [];
  for (const item of raw) {
    const r = item as Partial<UserListRef> | null;
    if (!r || !isValidListUrl(r.url) || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push({ url: r.url, enabled: r.enabled !== false });
  }
  return out;
}

/**
 * Coerces whatever is in storage into valid settings; unknown or corrupt fields fall back to
 * defaults. Version 1 stored only element-hiding rules, in `customCosmetic`. Version 3 added lists.
 */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Partial<Record<keyof Settings | 'customCosmetic', unknown>>;
  const wanted = Array.isArray(r.enabledLists)
    ? [...(r.enabledLists as unknown[]), ...((r.version as number) < 3 ? ADDED_IN_V3 : [])]
    : null;
  const customRules =
    typeof r.customRules === 'string'
      ? r.customRules
      : typeof r.customCosmetic === 'string'
        ? r.customCosmetic
        : '';
  return {
    version: 3,
    autoUpdateLists: bool(r.autoUpdateLists, d.autoUpdateLists),
    pauseUntil: Object.fromEntries(
      Object.entries(record(r.pauseUntil)).filter(
        (e): e is [string, number] => isValidSite(e[0]) && typeof e[1] === 'number',
      ),
    ),
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    pausedSites: Array.isArray(r.pausedSites)
      ? [...new Set(r.pausedSites.filter(isValidSite))].sort()
      : [],
    enabledLists: wanted
      ? BUILTIN_LISTS.map((l) => l.id).filter((id) => wanted.includes(id) && BUILTIN_IDS.has(id))
      : d.enabledLists,
    customRules,
    userLists: normalizeUserLists(r.userLists),
    isBrave: typeof r.isBrave === 'boolean' ? r.isBrave : null,
    privacy: normalizePrivacy(r.privacy),
    video: normalizeVideo(r.video),
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : d.theme,
    siteProfiles: normalizeProfiles(r.siteProfiles),
  };
}

export const PROFILE_KEYS: readonly (keyof SiteProfile)[] = [
  'network',
  'privacy',
  'video',
  'security',
];

/** All-on profiles are dropped so storage stays small. */
export function mergedProfile(
  current: SiteProfile | undefined,
  patch: Partial<SiteProfile>,
): SiteProfile | null {
  const next = { ...DEFAULT_SITE_PROFILE, ...current, ...patch };
  return PROFILE_KEYS.some((k) => !next[k]) ? next : null;
}

function normalizeProfiles(raw: unknown): Record<string, SiteProfile> {
  const r = record(raw);
  const out: Record<string, SiteProfile> = {};
  for (const [site, v] of Object.entries(r)) {
    if (!isValidSite(site) || typeof v !== 'object' || v === null) continue;
    const p = v as Record<string, unknown>;
    const profile: SiteProfile = { ...DEFAULT_SITE_PROFILE };
    for (const k of PROFILE_KEYS) if (typeof p[k] === 'boolean') profile[k] = p[k];
    if (PROFILE_KEYS.some((k) => !profile[k])) out[site] = profile;
    if (Object.keys(out).length >= 50) break;
  }
  return out;
}

export function exportSettings(s: Settings): SettingsExport {
  const { isBrave, ...rest } = s;
  void isBrave;
  return { nexus: 1, exportedAt: new Date().toISOString(), settings: rest };
}

/** Accepts only our own export envelope. The machine's Brave flag is not taken from the file. */
export function importSettings(raw: unknown, current: Settings): Settings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<SettingsExport>;
  if (r.nexus !== 1 || typeof r.settings !== 'object' || r.settings === null) return null;
  return { ...normalizeSettings(r.settings), isBrave: current.isBrave };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}
