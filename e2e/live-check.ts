/**
 * Manual live check on the real YouTube and Twitch (not part of CI: results depend on the network,
 * the region and whether an ad happens to be scheduled). Runs in throwaway Brave profiles, once
 * without and once with AX, and records only what the pages expose to any script: player state,
 * ad markers in the DOM and whether video time advances. No account, no cookies kept.
 * Usage: node e2e/live-check.ts [youtubeVideoId]   (writes docs/live-check.json)
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { BRAVE_PATH, EXTENSION_DIR } from './fixtures.ts';
import { TWITCH_AD_SELECTOR, YOUTUBE_AD_SELECTOR } from '../src/engines/video/ad-state.ts';

const VIDEO_ID = process.argv[2] ?? 'dQw4w9WgXcQ';
const SAMPLE_MS = 20_000;

async function launch(withNexus: boolean) {
  const profile = await mkdtemp(join(tmpdir(), 'nexus-live-'));
  await mkdir(join(profile, 'Default'));
  await writeFile(
    join(profile, 'Default', 'Preferences'),
    JSON.stringify({ profile: { default_content_setting_values: { braveShields: 2 } } }),
  );
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: BRAVE_PATH,
    headless: true,
    locale: 'tr-TR',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      ...(withNexus
        ? [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
        : []),
    ],
  });
  if (withNexus) {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    // Let onInstalled register the content scripts before the first navigation.
    for (let i = 0; i < 50; i++) {
      const n = await worker.evaluate(
        async () => (await chrome.scripting.getRegisteredContentScripts()).length,
      );
      if (n > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    context,
    close: async () => {
      await context.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** Rejects the consent interstitial if the region shows one; this profile is thrown away after. */
async function passConsent(page: Page) {
  if (!page.url().includes('consent.')) return;
  await page
    .getByRole('button', { name: /reject all|tümünü reddet/i })
    .first()
    .click({ timeout: 10_000 });
  await page.waitForURL((u) => !u.hostname.startsWith('consent.'), { timeout: 15_000 });
}

async function sample(page: Page, adSelector: string) {
  const start = Date.now();
  let adSeen = false;
  const t0 = await videoTime(page);
  while (Date.now() - start < SAMPLE_MS) {
    adSeen ||= await page.evaluate((s) => document.querySelector(s) !== null, adSelector);
    await page.waitForTimeout(250);
  }
  return { adMarkerSeen: adSeen, videoAdvancedSeconds: (await videoTime(page)) - t0 };
}

const videoTime = (page: Page) =>
  page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find((x) => x.duration > 0);
    return v ? v.currentTime : 0;
  });

async function youtube(withNexus: boolean) {
  const b = await launch(withNexus);
  try {
    const page = await b.context.newPage();
    await page.goto(`https://www.youtube.com/watch?v=${VIDEO_ID}`, { waitUntil: 'load' });
    await passConsent(page);
    await page.waitForSelector('video', { timeout: 20_000 });
    const response = await page.evaluate(() => {
      const r = (window as unknown as { ytInitialPlayerResponse?: Record<string, unknown> })
        .ytInitialPlayerResponse;
      if (!r) return null;
      return {
        playable: (r.playabilityStatus as { status?: string } | undefined)?.status ?? null,
        adFields: ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'].filter(
          (k) => k in r,
        ),
      };
    });
    const parseLooksNative = await page.evaluate(() =>
      Function.prototype.toString.call(JSON.parse).includes('[native code]'),
    );
    await page.evaluate(
      () =>
        void document
          .querySelector('video')
          ?.play()
          .catch(() => undefined),
    );
    return { response, parseLooksNative, ...(await sample(page, YOUTUBE_AD_SELECTOR)) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    await b.close();
  }
}

async function twitch(withNexus: boolean, channel?: string) {
  const b = await launch(withNexus);
  try {
    const page = await b.context.newPage();
    let name = channel;
    if (!name) {
      await page.goto('https://www.twitch.tv/directory/all', { waitUntil: 'load' });
      const href = await page
        .locator('a[data-a-target="preview-card-image-link"]')
        .first()
        .getAttribute('href', { timeout: 20_000 });
      name = href?.split('/')[1];
    }
    await page.goto(`https://www.twitch.tv/${name}`, { waitUntil: 'load' });
    await page.waitForSelector('video', { timeout: 20_000 });
    const scripts = await page.evaluate(() =>
      [...document.scripts].map((s) => s.src).filter((s) => s.length > 0),
    );
    // Which of the ad markers the player code still references (its own public JavaScript).
    const markers = ['video-ad-label', 'video-ad-countdown', 'Learn more about this ad'];
    const referenced = new Set<string>();
    for (const src of scripts) {
      const text = await fetch(src)
        .then((r) => r.text())
        .catch(() => '');
      for (const m of markers) if (text.includes(m)) referenced.add(m);
    }
    return {
      channel: name,
      markersInPlayerCode: [...referenced],
      ...(await sample(page, TWITCH_AD_SELECTOR)),
    };
  } catch (e) {
    return { channel, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await b.close();
  }
}

const only = process.env.LIVE_ONLY;
const result: Record<string, unknown> = { date: new Date().toISOString(), videoId: VIDEO_ID };
if (only !== 'twitch') {
  result.youtubeWithout = await youtube(false);
  result.youtubeWithNexus = await youtube(true);
}
const twitchWithout = (await twitch(false)) as { channel?: string };
result.twitchWithout = twitchWithout;
result.twitchWithNexus = await twitch(true, twitchWithout.channel);
console.log(JSON.stringify(result, null, 2));
await writeFile(
  resolve(import.meta.dirname, '../docs/live-check.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
