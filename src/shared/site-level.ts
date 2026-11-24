import type { SiteProfile } from './types.ts';

/** uBO Lite's filtering modes, per site. 'off' is the site pause; privacy, video and security
 * switches are left as the user set them. */
export type SiteLevel = 'off' | 'basic' | 'optimal' | 'full';

export const SITE_LEVELS: readonly SiteLevel[] = ['off', 'basic', 'optimal', 'full'];

type LayerKey = 'network' | 'cosmetic' | 'scriptlets' | 'generic' | 'brain';

/** What each level turns on; 'off' is not a profile but the pause. */
export const LEVEL_LAYERS: Record<Exclude<SiteLevel, 'off'>, Pick<SiteProfile, LayerKey>> = {
  basic: { network: true, cosmetic: false, scriptlets: false, generic: false, brain: false },
  optimal: { network: true, cosmetic: true, scriptlets: true, generic: false, brain: false },
  full: { network: true, cosmetic: true, scriptlets: true, generic: true, brain: true },
};

/** The level a profile matches, or null when the user mixed layers by hand. */
export function levelOf(profile: SiteProfile, paused: boolean): SiteLevel | null {
  if (paused) return 'off';
  for (const level of ['basic', 'optimal', 'full'] as const) {
    const layers = LEVEL_LAYERS[level];
    if ((Object.keys(layers) as LayerKey[]).every((k) => profile[k] === layers[k])) return level;
  }
  return null;
}
