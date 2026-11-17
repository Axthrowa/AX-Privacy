import { send } from '../shared/messages.ts';
import { YT_BACKOFF_KEY, YT_DATA } from '../engines/video/youtube.ts';

// YouTube, with ad removal on. If YouTube shows its "ad blockers are not allowed" warning, this tab
// stops removing ads and reloads once, so the video plays (with ads) instead of being held back.
// The tab remembers it in sessionStorage until it is closed; other tabs are not affected.

const POLL_MS = 1_000;
const warning = YT_DATA.blockerWarning.join(', ');

/** No storage means a reload could not be remembered, so never reload. */
const backedOff = (() => {
  try {
    return sessionStorage.getItem(YT_BACKOFF_KEY) !== null;
  } catch {
    return true;
  }
})();

if (!backedOff) {
  const timer = setInterval(() => {
    if (!document.querySelector(warning)) return;
    clearInterval(timer);
    try {
      sessionStorage.setItem(YT_BACKOFF_KEY, '1');
    } catch {
      return;
    }
    void send('video/warned', {})
      .catch(() => undefined)
      .finally(() => location.reload());
  }, POLL_MS);
}
