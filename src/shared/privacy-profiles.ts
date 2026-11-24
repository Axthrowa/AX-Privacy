import type { PrivacySettings } from './types.ts';

export type PrivacyProfile = 'balanced' | 'strict' | 'paranoid';
export const PROFILES: readonly PrivacyProfile[] = ['balanced', 'strict', 'paranoid'];
/** What a profile decides; per-page reports, the language/time zone switch and site lists stay the user's. */
type ProfileKeys = Exclude<
  keyof PrivacySettings,
  'detailedReports' | 'hideLocale' | 'clearSiteData' | 'keepSiteData' | 'scriptSites'
>;

/**
 * Balanced: everything with a low chance of breaking a site. Strict: also the medium-risk ones
 * (third-party cookies, stronger fingerprint protection, click-to-load embeds). Paranoid: Strict
 * plus scripts from other sites only where the user allowed them. Balanced is the default for new installs.
 */
export function profileSettings(profile: PrivacyProfile): Pick<PrivacySettings, ProfileKeys> {
  const strict = profile !== 'balanced';
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
    blockThirdPartyScripts: profile === 'paranoid',
    fingerprint: strict ? 'strict' : 'standard',
  };
}

/** The profile the settings match exactly, or null for a custom mix. */
export function currentProfile(p: PrivacySettings): PrivacyProfile | null {
  for (const profile of PROFILES) {
    const want = profileSettings(profile);
    if (Object.entries(want).every(([k, v]) => p[k as ProfileKeys] === v)) return profile;
  }
  return null;
}
