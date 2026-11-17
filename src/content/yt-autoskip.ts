import { YT_DATA } from '../engines/video/youtube.ts';

// YouTube, opt-out. When an ad still plays (stitched in, or the schedule came through), presses the
// player's own "Skip" button as soon as it is shown. Nothing else on the page is clicked.

const POLL_MS = 300;
const buttons = YT_DATA.skipButtons.join(', ');

setInterval(() => {
  const b = document.querySelector<HTMLElement>(buttons);
  if (b && b.offsetParent !== null) b.click();
}, POLL_MS);
