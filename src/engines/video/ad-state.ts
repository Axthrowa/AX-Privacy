/** The YouTube player element carries `ad-showing` while any ad plays, stitched-in or not. */
export const YOUTUBE_AD_SELECTOR = '.html5-video-player.ad-showing';
/** Twitch's ad label and countdown, and the "learn more" button EasyList also targets. */
export const TWITCH_AD_SELECTOR = [
  '[data-a-target="video-ad-label"]',
  '[data-a-target="video-ad-countdown"]',
  'button[aria-label="Learn more about this ad"]',
].join(', ');

/** Sites the ad-time muting runs on (with subdomains). */
export const AD_MUTE_SITES = ['youtube.com', 'youtube-nocookie.com', 'twitch.tv'] as const;

const onSite = (hostname: string, site: string) =>
  hostname === site || hostname.endsWith(`.${site}`);

export function adSelectorFor(hostname: string): string | null {
  if (onSite(hostname, 'twitch.tv')) return TWITCH_AD_SELECTOR;
  if (onSite(hostname, 'youtube.com') || onSite(hostname, 'youtube-nocookie.com')) {
    return YOUTUBE_AD_SELECTOR;
  }
  return null;
}

/**
 * Mutes media while an ad plays and gives back only what it took: a video the user had muted stays
 * muted, and one the user unmutes during the ad is left alone.
 */
export class AdMuter {
  private readonly taken = new Set<{ muted: boolean }>();

  update(adPlaying: boolean, media: Iterable<{ muted: boolean }>): void {
    if (adPlaying) {
      for (const m of media) {
        if (!m.muted && !this.taken.has(m)) {
          m.muted = true;
          this.taken.add(m);
        }
      }
      return;
    }
    for (const m of this.taken) m.muted = false;
    this.taken.clear();
  }
}
