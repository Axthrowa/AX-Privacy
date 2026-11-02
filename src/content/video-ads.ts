import { AdMuter, adSelectorFor } from '../engines/video/ad-state.ts';

// YouTube and Twitch, opt-in. Ads stitched into the stream cannot be removed without tampering
// with the platform's traffic, so while the player itself says an ad is on, the video is muted and
// darkened instead. Only reads the player's own ad markers; the stream is not touched.

const POLL_MS = 400;
const ATTR = 'data-nexus-ad';

const selector = adSelectorFor(location.hostname);
if (selector) {
  const muter = new AdMuter();
  const style = document.createElement('style');
  style.textContent = `html[${ATTR}] video { filter: brightness(0.15) !important; }`;
  setInterval(() => {
    const ad = document.querySelector(selector) !== null;
    const root = document.documentElement;
    if (ad && !style.isConnected) root.append(style);
    if (root.hasAttribute(ATTR) !== ad) root.toggleAttribute(ATTR, ad);
    muter.update(ad, document.querySelectorAll('video'));
  }, POLL_MS);
}
