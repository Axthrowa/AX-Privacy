import { describe, expect, it } from 'vitest';
import { allowsNotificationPrompt, isAdServiceWorker, rateLimiter } from '../engines/popup/push.ts';

describe('allowsNotificationPrompt', () => {
  it('denies prompts the user did not ask for, except on messaging apps', () => {
    expect(allowsNotificationPrompt('news.example.com', false)).toBe(false);
    expect(allowsNotificationPrompt('news.example.com', true)).toBe(true);
    expect(allowsNotificationPrompt('web.whatsapp.com', false)).toBe(true);
    expect(allowsNotificationPrompt('app.slack.com', false)).toBe(true);
    expect(allowsNotificationPrompt('notslack.com', false)).toBe(false);
  });
});

describe('isAdServiceWorker', () => {
  it('matches push-ad worker scripts only', () => {
    expect(isAdServiceWorker('https://site.example/push-sw.js')).toBe(true);
    expect(isAdServiceWorker('/sw.js?zone=1&monetag=1')).toBe(true);
    expect(isAdServiceWorker('/ad-sw.js')).toBe(true);
    expect(isAdServiceWorker('/service-worker.js')).toBe(false);
    expect(isAdServiceWorker('/sw.js')).toBe(false);
    expect(isAdServiceWorker('/ad-swiper/sw.js')).toBe(false);
  });
});

describe('rateLimiter', () => {
  it('allows bursts up to the limit per window, then recovers', () => {
    let t = 0;
    const allowed = rateLimiter(3, 1000, () => t);
    expect([allowed(), allowed(), allowed(), allowed()]).toEqual([true, true, true, false]);
    t = 1001;
    expect(allowed()).toBe(true);
  });
});
