import { describe, expect, it } from 'vitest';
import { currentProfile, profileSettings } from '../shared/privacy-profiles.ts';
import { DEFAULT_SETTINGS } from '../storage/settings.ts';

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
