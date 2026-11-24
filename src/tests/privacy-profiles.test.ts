import { describe, expect, it } from 'vitest';
import { currentProfile, profileSettings } from '../shared/privacy-profiles.ts';
import { DEFAULT_SETTINGS, DEFAULT_SITE_PROFILE } from '../storage/settings.ts';
import {
  CONTROL_RULE_IDS,
  RULE_THIRD_PARTY_SCRIPTS,
  controlRules,
} from '../engines/core/control.ts';
import { parseMessage } from '../shared/messages.ts';

describe('privacy profiles', () => {
  it('ships Balanced as the default', () => {
    expect(currentProfile(DEFAULT_SETTINGS.privacy)).toBe('balanced');
  });
  it('detects Strict and a custom mix', () => {
    const strict = { ...DEFAULT_SETTINGS.privacy, ...profileSettings('strict') };
    expect(currentProfile(strict)).toBe('strict');
    expect(currentProfile({ ...strict, gpc: false })).toBeNull();
  });
  it('leaves language and reports to the user', () => {
    const p = { ...DEFAULT_SETTINGS.privacy, hideLocale: true, detailedReports: true };
    expect(currentProfile(p)).toBe('balanced');
  });
});

describe('paranoid profile', () => {
  it('is Strict plus third-party script blocking, and keeps the allowed sites', () => {
    const p = {
      ...DEFAULT_SETTINGS.privacy,
      ...profileSettings('paranoid'),
      scriptSites: ['youtube.com'],
    };
    expect(p.blockThirdPartyScripts).toBe(true);
    expect(p.blockThirdPartyCookies).toBe(true);
    expect(currentProfile(p)).toBe('paranoid');
    expect(profileSettings('strict').blockThirdPartyScripts).toBe(false);
  });

  it('blocks scripts from other sites except allowed, paused-privacy and protected sites', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    expect(controlRules(s).some((r) => r.id === RULE_THIRD_PARTY_SCRIPTS)).toBe(false);
    s.privacy.blockThirdPartyScripts = true;
    s.privacy.scriptSites = ['youtube.com'];
    const t = {
      ...s,
      siteProfiles: { 'example.org': { ...DEFAULT_SITE_PROFILE, privacy: false } },
    };
    const rule = controlRules(t).find((r) => r.id === RULE_THIRD_PARTY_SCRIPTS);
    expect(rule?.action.type).toBe('block');
    expect(rule?.condition.resourceTypes).toEqual(['script']);
    expect(rule?.condition.domainType).toBe('thirdParty');
    expect(rule?.condition.excludedInitiatorDomains).toEqual(
      expect.arrayContaining(['youtube.com', 'example.org', 'paypal.com']),
    );
    expect(rule?.condition.excludedRequestDomains).toContain('challenges.cloudflare.com');
    expect(CONTROL_RULE_IDS).toContain(RULE_THIRD_PARTY_SCRIPTS);
  });

  it('accepts the allowed-site list from the dashboard', () => {
    expect(
      parseMessage({
        type: 'privacy/set',
        privacy: { blockThirdPartyScripts: true, scriptSites: ['YouTube.com'] },
      }),
    ).toMatchObject({ privacy: { blockThirdPartyScripts: true, scriptSites: ['youtube.com'] } });
  });
});
