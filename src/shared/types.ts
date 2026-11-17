import type { ListStats } from '../engines/adblock/network.ts';
import type { StatsView } from '../engines/core/stats.ts';
import type { RiskReport } from '../engines/security/heuristics.ts';
import type { SkipMode, SponsorCategory } from './sponsor.ts';

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
  /** Keep WebRTC to the public address sites already see: no local or behind-VPN addresses. */
  hideLocalIps: boolean;
  /** Report US English and UTC instead of the real language and time zone. */
  hideLocale: boolean;
  /** Turn off the browser's own ad APIs: Topics, Protected Audience and ad measurement. */
  browserAdApis: boolean;
  /** Third parties may not ask for detailed device data (Client Hints); requests carry none. */
  limitClientHints: boolean;
  /** Facebook and X posts and Disqus comments load only after a click on their placeholder. */
  clickToLoad: boolean;
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
  /** Hide those ad cards entirely instead (takes precedence over marking). */
  hideSponsored: boolean;
  /** Press the player's own "Skip" button as soon as it shows. */
  autoSkipAds: boolean;
  /** Beta: ad handling for other sites' players (JW Player, HLS ad breaks, pre-roll videos). */
  genericPlayers: boolean;
  /** Load embedded YouTube players from youtube-nocookie.com (DNR host transform). */
  nocookieEmbeds: boolean;
  /** Mute and darken the player while YouTube or Twitch shows an ad that cannot be removed. */
  adMute: boolean;
  /** Use SponsorBlock data, looked up by a 4-character hash prefix. */
  sponsorSkip: boolean;
  /** What happens to each SponsorBlock category while sponsorSkip is on. */
  sponsorModes: Record<SponsorCategory, SkipMode>;
  /** Channels ("@handle" or channel ID) where nothing is skipped or muted on its own; buttons stay. */
  sponsorChannels: string[];
}

/** What SponsorBlock asks for a segment: skip it, mute it, a whole-video label, or one moment. */
export type SegmentAction = 'skip' | 'mute' | 'full' | 'poi' | 'chapter';

/** How often YouTube showed its ad blocker warning, and when last (ms since epoch). */
export interface YoutubeWarnings {
  count: number;
  last: number | null;
}

/** A SponsorBlock segment of a video, in seconds: [start, end). */
export interface Segment {
  start: number;
  end: number;
  category: SponsorCategory;
  action: SegmentAction;
  /** Video length the segment was submitted for; 0 if unknown. */
  duration: number;
}

/** A segment with the user's mode for its category. */
export interface PlanSegment extends Segment {
  mode: SkipMode;
}

/** What the YouTube page gets: segments of categories not switched off, and the channel exceptions. */
export interface SegmentPlan {
  segments: PlanSegment[];
  channels: string[];
}

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
  /** Not refreshed by the periodic update, only by a new extension version. */
  buildOnly: boolean;
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
