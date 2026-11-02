import type { ListStats } from '../engines/adblock/network.ts';
import type { StatsView } from '../engines/core/stats.ts';
import type { RiskReport } from '../engines/security/heuristics.ts';

export type { StatsView };

export type Theme = 'dark' | 'light';

export interface SiteProfile {
  /** Network + cosmetic filters initiated by this site. Off does not lift page (document) blocks. */
  network: boolean;
  /** Fingerprint scripts, consent auto-reject, third-party cookie stripping. */
  privacy: boolean;
  /** YouTube / Twitch video scripts. */
  video: boolean;
  /** Page-blocking security lists for this destination. Off is an explicit allow. */
  security: boolean;
}

export interface SettingsExport {
  nexus: 1;
  exportedAt: string;
  settings: Omit<Settings, 'isBrave'>;
  stats?: import('../engines/core/stats.ts').StatsDump;
}

export interface UserListRef {
  url: string;
  enabled: boolean;
}

/** off; standard: canvas and audio readback noise; strict: also WebGL GPU strings and hardware. */
export type FingerprintLevel = 'off' | 'standard' | 'strict';

export interface PrivacySettings {
  /** Strip Cookie/Set-Cookie on third-party requests (DNR modifyHeaders). */
  blockThirdPartyCookies: boolean;
  /** Let autoconsent click "reject" on cookie banners it recognizes. */
  cookieAutoReject: boolean;
  fingerprint: FingerprintLevel;
  /** Send the Global Privacy Control signal: `Sec-GPC` header and `navigator.globalPrivacyControl`. */
  gpc: boolean;
  /** Follow known tracking redirects locally, so links go straight to their target. */
  cleanLinks: boolean;
  /** Drop cookies of hosts that pages need but that also track (see `engines/core/cdn-cookies.ts`). */
  cdnCookies: boolean;
  /**
   * Per-page host lists and daily counters. They need a listener on every request, which keeps the
   * service worker awake while any page loads, so they are off unless asked for.
   */
  detailedReports: boolean;
}

export interface VideoSettings {
  /** Strip ad schedules from YouTube player responses (MAIN-world script on YouTube only). */
  youtubeAds: boolean;
  /** Remove stitched ads from Twitch playlists inside the player's own worker. */
  twitchAds: boolean;
  /** Outline ad cards YouTube still shows, with a "Sponsorlu" label (CSS only). */
  markSponsored: boolean;
  /** Load embedded YouTube players from youtube-nocookie.com (DNR host transform). */
  nocookieEmbeds: boolean;
  /** Mute and darken the player while YouTube or Twitch shows an ad that cannot be removed. */
  adMute: boolean;
  /** Skip sponsor segments using SponsorBlock data, looked up by a 4-character hash prefix. */
  sponsorSkip: boolean;
}

/** A segment of a video to skip, in seconds: [start, end). */
export type Segment = [number, number];

export interface Settings {
  version: 3;
  /** Sites paused for a while, to the time the pause ends. Paused sites without one stay paused. */
  pauseUntil: Record<string, number>;
  /** Download newer versions of the packaged lists every 12 hours. */
  autoUpdateLists: boolean;
  /** Global protection switch. */
  enabled: boolean;
  /** Sites (eTLD+1 or IP) where protection is paused. */
  pausedSites: string[];
  /** Enabled built-in filter list IDs (see `filters/catalog.ts`). */
  enabledLists: string[];
  /** User filter rules, network and cosmetic, one per line. */
  customRules: string;
  /** Filter lists the user subscribed to by URL. */
  userLists: UserListRef[];
  /** Set from an extension page via `navigator.brave.isBrave()`; null until detected. */
  isBrave: boolean | null;
  privacy: PrivacySettings;
  video: VideoSettings;
  theme: Theme;
  /** Per-site module switches. Missing site = all on. Paused sites override this. */
  siteProfiles: Record<string, SiteProfile>;
}

export interface HostReport {
  host: string;
  thirdParty: boolean;
  loaded: number;
  /** Failed with ERR_BLOCKED_BY_CLIENT: this or another extension, or Brave Shields. */
  blocked: number;
}

export interface ConsentReport {
  cmp: string;
  /** null while the opt-out is still running. */
  result: boolean | null;
}

export interface TabReport {
  site: string | null;
  url: string | null;
  hosts: HostReport[];
  consent: ConsentReport | null;
  risk: RiskReport;
}

export interface PopupState {
  enabled: boolean;
  site: string | null;
  paused: boolean;
  isBrave: boolean | null;
}

export interface RejectedLine {
  line: string;
  reason: string;
}

export interface CustomRulesResult {
  network: number;
  cosmetic: number;
  rejected: RejectedLine[];
}

export interface BuiltinListView {
  id: string;
  name: string;
  category: string;
  homepage: string;
  license: string;
  enabled: boolean;
  version: string | null;
  builtAt: string | null;
  stats: ListStats | null;
}

export interface UserListView extends UserListRef {
  fetchedAt: number | null;
  error: string | null;
  stats: ListStats | null;
  /** Rules dropped because the dynamic rule quota was full. */
  truncated: number;
}

export interface ListUpdateStatus {
  at: number;
  added: number;
  removed: number;
  /** Lists that had something new. */
  changed: string[];
  /** List id to why its download was refused; it keeps what it had. */
  errors: Record<string, string>;
}

export interface ListsView {
  updates: { auto: boolean; status: ListUpdateStatus | null };
  builtin: BuiltinListView[];
  user: UserListView[];
  /** `getAvailableStaticRuleCount()`: rules this extension can still enable from the shared pool. */
  availableStaticRules: number;
  dynamicRules: number;
  maxDynamicRules: number;
}

/** A procedural selector the content script evaluates itself. */
export interface ExtendedRule {
  ast: unknown;
  id: number;
  attribute?: string;
  directive?: unknown;
}
