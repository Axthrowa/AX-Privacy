import { YOUTUBE_AD_SELECTOR } from '../engines/video/ad-state.ts';
import { skipTarget, videoIdFrom } from '../engines/video/sponsorblock.ts';
import { send } from '../shared/messages.ts';
import type { Segment } from '../shared/types.ts';

// YouTube, opt-in. Skips sponsor segments once per page view; seeking back into one plays it.
// The background looks segments up by hash prefix, so the video ID is not sent anywhere.

let current: string | null = null;
let segments: Segment[] = [];
const skipped = new Set<number>();

document.addEventListener(
  'timeupdate',
  (e) => {
    const video = e.target;
    if (!(video instanceof HTMLVideoElement)) return;
    const id = videoIdFrom(location.href);
    if (id !== current) {
      current = id;
      segments = [];
      skipped.clear();
      if (id) {
        send('video/segments', { videoId: id })
          .then((s) => {
            if (current === id) segments = s;
          })
          .catch(() => undefined);
      }
      return;
    }
    // While an ad plays, the same element shows the ad's own timeline.
    if (segments.length === 0 || document.querySelector(YOUTUBE_AD_SELECTOR)) return;
    const to = skipTarget(video.currentTime, segments, skipped);
    if (to !== null) video.currentTime = to;
  },
  true,
);
