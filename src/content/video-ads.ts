import { AdMuter, AdSpeeder, adSelectorFor } from '../engines/video/ad-state.ts';

// YouTube and Twitch, opt-in. Ads stitched into the stream cannot be removed without tampering
// with the platform's traffic, so while the player itself says an ad is on, the video is muted and
// darkened, and on YouTube, if asked, played at 16x. Only reads the player's own ad markers; the
// stream is not touched.

const POLL_MS = 400;
const ATTR = 'data-nexus-ad';

// Set by the one-line files registered before this one (see control.ts).
const scope = self as { __axAdModes?: string[] };
const modes = scope.__axAdModes ?? [];
delete scope.__axAdModes;
const mute = modes.includes('mute');
// A live Twitch ad cannot run ahead of the stream.
const speed = modes.includes('speed') && !/(^|\.)twitch\.tv$/.test(location.hostname);

const selector = adSelectorFor(location.hostname);
if (selector && (mute || speed)) {
  const muter = new AdMuter();
  const speeder = new AdSpeeder();
  const style = document.createElement('style');
  style.textContent = `html[${ATTR}] video { filter: brightness(0.15) !important; }`;
  setInterval(() => {
    const ad = document.querySelector(selector) !== null;
    const videos = document.querySelectorAll('video');
    if (mute) {
      const root = document.documentElement;
      if (ad && !style.isConnected) root.append(style);
      if (root.hasAttribute(ATTR) !== ad) root.toggleAttribute(ATTR, ad);
      muter.update(ad, videos);
    }
    if (speed) speeder.update(ad, videos);
  }, POLL_MS);
}
