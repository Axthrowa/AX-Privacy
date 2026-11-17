import type { PrivacySettings } from './types.ts';

export type PrivacyProfile = 'balanced' | 'strict';
/** What a profile decides; per-page reports and the language/time zone switch stay the user's. */
type ProfileKeys = Exclude<
  keyof PrivacySettings,
  'detailedReports' | 'hideLocale' | 'clearSiteData' | 'keepSiteData'
>;

/**
 * Balanced: everything with a low chance of breaking a site. Strict: also the medium-risk ones
 * (third-party cookies, stronger fingerprint protection, click-to-load embeds). Balanced is the default for new installs.
 */
export function profileSettings(profile: PrivacyProfile): Pick<PrivacySettings, ProfileKeys> {
  const strict = profile === 'strict';
  return {
    gpc: true,
    cleanLinks: true,
    cdnCookies: true,
    hideLocalIps: true,
    cookieAutoReject: true,
    browserAdApis: true,
    limitClientHints: true,
    blockThirdPartyCookies: strict,
    clickToLoad: strict,
    fingerprint: strict ? 'strict' : 'standard',
  };
}

/** The profile the settings match exactly, or null for a custom mix. */
export function currentProfile(p: PrivacySettings): PrivacyProfile | null {
  for (const profile of ['balanced', 'strict'] as const) {
    const want = profileSettings(profile);
    if (Object.entries(want).every(([k, v]) => p[k as ProfileKeys] === v)) return profile;
  }
  return null;
}
