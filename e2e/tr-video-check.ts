/**
 * Live check on the 30 most watched Turkish broadcaster sites (not part of CI: ads depend on the
 * network, the hour and the site's day). Each page opens without and with AX in throwaway Brave
 * profiles (Brave Shields off) and counts video-ad requests that came back from the network: ad
 * SDKs, VAST/VMAP calls and ad-server responses. With AX the count should be 0; a request the
 * extension redirected to a local surrogate (a 3xx here) does not count.
 *
 * Usage: node e2e/tr-video-check.ts [url...]   (all 30 sites: writes docs/tr-video-check.json)
 * Exit code 1 if a video ad request got through with AX on any site.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext } from '@playwright/test';
import { BRAVE_PATH, EXTENSION_DIR } from './fixtures.ts';

export const TR_VIDEO_SITES = [
  'https://www.trtizle.com/',
  'https://www.atv.com.tr/',
  'https://www.kanald.com.tr/',
  'https://www.showtv.com.tr/',
  'https://www.startv.com.tr/',
  'https://www.nowtv.com.tr/',
  'https://www.tv8.com.tr/',
  'https://puhutv.com/',
  'https://www.tabii.com/',
  'https://www.haberturk.com/',
  'https://www.ntv.com.tr/',
  'https://www.cnnturk.com/',
  'https://www.ahaber.com.tr/',
  'https://halktv.com.tr/',
  'https://www.sozcu.com.tr/',
  'https://www.tv100.com/',
  'https://www.teve2.com.tr/',
  'https://www.dmax.com.tr/',
  'https://www.tlctv.com.tr/',
  'https://www.kanal7.com/',
  'https://www.tv360.com.tr/',
  'https://www.beyaztv.com.tr/',
  'https://www.tgrthaber.com/',
  'https://www.ulketv.com.tr/',
  'https://www.aspor.com.tr/',
  'https://www.trtspor.com.tr/',
  'https://www.trthaber.com/',
  'https://www.a2tv.com.tr/',
  'https://www.tv8bucuk.com/',
  'https://www.minikago.com.tr/',
];

/** Video ad SDKs, ad calls and ad-server responses. */
const VIDEO_AD =
  /imasdk\.googleapis\.com\/js\/sdkloader|\/gampad\/ads\?|[/.](?:vast|vmap)(?:[/?._-]|$)|fwmrm\.net\/ad\/|spotxchange\.com|innovid\.com|smartadserver\.com\/ac|adform\.net\/adfscript|teads\.tv\/page|googlesyndication\.com\/pagead\/(?:js|show_ads)/i;
const SETTLE_MS = 15_000;

async function launch(
  withAx: boolean,
): Promise<{ context: BrowserContext; close(): Promise<void> }> {
  const profile = await mkdtemp(join(tmpdir(), 'ax-trvideo-'));
  await mkdir(join(profile, 'Default'));
  await writeFile(
    join(profile, 'Default', 'Preferences'),
    JSON.stringify({ profile: { default_content_setting_values: { braveShields: 2 } } }),
  );
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: BRAVE_PATH,
    headless: true,
    locale: 'tr-TR',
    viewport: { width: 1366, height: 800 },
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      ...(withAx
        ? [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
        : []),
    ],
  });
  if (withAx) {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
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
    async close() {
      await context.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** Video-ad requests that got a network response, or null if the page did not load. */
async function adResponses(context: BrowserContext, url: string): Promise<string[] | null> {
  const page = await context.newPage();
  const hits: string[] = [];
  page.on('response', (r) => {
    if (VIDEO_AD.test(r.url()) && r.status() >= 200 && r.status() < 300)
      hits.push(new URL(r.url()).hostname);
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(SETTLE_MS);
    return hits;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => undefined);
  }
}

const urls = process.argv.slice(2).length ? process.argv.slice(2) : TR_VIDEO_SITES;
const rows: { url: string; without: number | null; with: number | null; leaked: string[] }[] = [];
const off = await launch(false);
const on = await launch(true);
for (const url of urls) {
  const without = await adResponses(off.context, url);
  const withAx = await adResponses(on.context, url);
  const r = {
    url,
    without: without?.length ?? null,
    with: withAx?.length ?? null,
    leaked: [...new Set(withAx ?? [])],
  };
  rows.push(r);
  console.log(
    `${r.with === 0 ? 'ok  ' : r.with === null ? 'skip' : 'FAIL'} ${url} ${r.without ?? '-'} → ${r.with ?? '-'} ${r.leaked.join(' ')}`,
  );
}
await off.close();
await on.close();
const failed = rows.filter((r) => (r.with ?? 0) > 0);
const loaded = rows.filter((r) => r.with !== null).length;
console.log(`${loaded}/${rows.length} loaded, ${failed.length} with video ads left`);
if (process.argv.length <= 2) {
  await writeFile(
    resolve(import.meta.dirname, '../docs/tr-video-check.json'),
    `${JSON.stringify({ checkedAt: new Date().toISOString(), rows }, null, 2)}\n`,
  );
}
process.exit(failed.length ? 1 : 0);
