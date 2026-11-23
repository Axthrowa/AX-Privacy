/**
 * Push-spam and browser-locker guards (ported from the v4 JS pop-up shield). Pure decisions here;
 * the MAIN-world popups script applies them.
 */

/** Web apps whose notifications people want; their prompts always reach the browser. */
const NOTIFICATION_HOSTS = [
  'chat.google.com',
  'mail.google.com',
  'calendar.google.com',
  'discord.com',
  'web.whatsapp.com',
  'web.telegram.org',
  'slack.com',
  'teams.microsoft.com',
  'outlook.live.com',
  'outlook.office.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'messenger.com',
  'instagram.com',
];

const onHost = (host: string, list: readonly string[]) => {
  const h = host.toLowerCase();
  return list.some((d) => h === d || h.endsWith(`.${d}`));
};

/**
 * A notification prompt goes through when the user just interacted with the page or the site is a
 * known messaging app. Prompts on page load are the "click Allow to continue" push-ad trap.
 */
export function allowsNotificationPrompt(host: string, userActive: boolean): boolean {
  return userActive || onHost(host, NOTIFICATION_HOSTS);
}

const AD_WORKER =
  /push-sw|ntfc|monetag|propeller|adsterra|inpage|onesignal-ad|ad-worker|ad-sw\b|afu\.php/i;

/** Service worker scripts of push-ad networks; they keep sending ads after the tab is closed. */
export function isAdServiceWorker(scriptUrl: string): boolean {
  return AD_WORKER.test(scriptUrl);
}

/**
 * True while calls stay under `limit` per `windowMs`. Browser lockers push thousands of history
 * entries so Back never leaves the page; real apps push a few per second at most.
 */
export function rateLimiter(limit = 50, windowMs = 1000, now: () => number = Date.now) {
  let start = now();
  let count = 0;
  return (): boolean => {
    const t = now();
    if (t - start > windowMs) {
      start = t;
      count = 0;
    }
    return ++count <= limit;
  };
}
