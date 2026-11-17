import { describe, expect, it } from 'vitest';
import {
  AD_SPEED,
  AdMuter,
  AdSpeeder,
  TWITCH_AD_SELECTOR,
  YOUTUBE_AD_SELECTOR,
  adSelectorFor,
} from '../engines/video/ad-state.ts';

describe('adSelectorFor', () => {
  it('picks the player markers of each platform and nothing elsewhere', () => {
    expect(adSelectorFor('www.youtube.com')).toBe(YOUTUBE_AD_SELECTOR);
    expect(adSelectorFor('m.youtube.com')).toBe(YOUTUBE_AD_SELECTOR);
    expect(adSelectorFor('www.youtube-nocookie.com')).toBe(YOUTUBE_AD_SELECTOR);
    expect(adSelectorFor('www.twitch.tv')).toBe(TWITCH_AD_SELECTOR);
    expect(adSelectorFor('player.twitch.tv')).toBe(TWITCH_AD_SELECTOR);
    expect(adSelectorFor('nottwitch.tv')).toBeNull();
    expect(adSelectorFor('youtube.com.evil.example')).toBeNull();
  });
});

describe('AdSpeeder', () => {
  it('runs ads at full speed and gives each video its own rate back', () => {
    const s = new AdSpeeder();
    const video = { playbackRate: 1.5 };
    s.update(true, [video]);
    expect(video.playbackRate).toBe(AD_SPEED);
    // The player resets the rate mid-ad; the original is still the one kept.
    video.playbackRate = 1;
    s.update(true, [video]);
    expect(video.playbackRate).toBe(AD_SPEED);
    s.update(false, [video]);
    expect(video.playbackRate).toBe(1.5);
    s.update(false, [video]);
    expect(video.playbackRate).toBe(1.5);
  });
});

describe('AdMuter', () => {
  it('mutes during an ad and unmutes afterwards', () => {
    const m = new AdMuter();
    const video = { muted: false };
    m.update(true, [video]);
    expect(video.muted).toBe(true);
    m.update(false, [video]);
    expect(video.muted).toBe(false);
  });
  it('leaves a video the user had muted muted', () => {
    const m = new AdMuter();
    const video = { muted: true };
    m.update(true, [video]);
    m.update(false, [video]);
    expect(video.muted).toBe(true);
  });
  it('does not fight a user who unmutes during the ad', () => {
    const m = new AdMuter();
    const video = { muted: false };
    m.update(true, [video]);
    video.muted = false;
    m.update(true, [video]);
    expect(video.muted).toBe(false);
  });
  it('mutes videos that appear while the ad is on', () => {
    const m = new AdMuter();
    const a = { muted: false };
    const b = { muted: false };
    m.update(true, [a]);
    m.update(true, [a, b]);
    expect(b.muted).toBe(true);
    m.update(false, [a, b]);
    expect([a.muted, b.muted]).toEqual([false, false]);
  });
});
