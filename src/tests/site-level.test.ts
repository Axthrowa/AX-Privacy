import { describe, expect, it } from 'vitest';
import { STEPS, stepsFor } from '../dashboard/Fix.tsx';
import { levelOf } from '../shared/site-level.ts';
import { DEFAULT_SITE_PROFILE } from '../storage/settings.ts';

describe('site levels', () => {
  it('reads the level a profile matches, or null for a hand-made mix', () => {
    expect(levelOf(DEFAULT_SITE_PROFILE, false)).toBe('full');
    expect(levelOf(DEFAULT_SITE_PROFILE, true)).toBe('off');
    expect(levelOf({ ...DEFAULT_SITE_PROFILE, generic: false, brain: false }, false)).toBe(
      'optimal',
    );
    expect(
      levelOf(
        {
          ...DEFAULT_SITE_PROFILE,
          cosmetic: false,
          scriptlets: false,
          generic: false,
          brain: false,
        },
        false,
      ),
    ).toBe('basic');
    expect(levelOf({ ...DEFAULT_SITE_PROFILE, scriptlets: false }, false)).toBeNull();
  });
});

describe('breakage wizard', () => {
  it('tries layers in the plan order: generic, scriptlets, AI, cosmetic, then the rest', () => {
    expect(STEPS.map((s) => s.layer)).toEqual([
      'generic',
      'scriptlets',
      'brain',
      'cosmetic',
      'privacy',
      'video',
      'network',
      'pause',
    ]);
  });

  it('skips layers already off on the site', () => {
    const steps = stepsFor({ ...DEFAULT_SITE_PROFILE, generic: false, brain: false });
    expect(steps.map((s) => s.layer)).not.toContain('generic');
    expect(steps.map((s) => s.layer)).not.toContain('brain');
    expect(steps.at(-1)?.layer).toBe('pause');
  });
});
