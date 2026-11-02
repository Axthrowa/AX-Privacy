/**
 * Manual breakage check on real public sites (not part of CI: results depend on the network and on
 * each site's day). Each page opens in a throwaway Brave profile without and with AX, with no
 * account, and only what any script could read is compared: visible text, images, page errors and
 * failed first-party requests. A large drop with AX points at a site to look at by hand.
 * Usage: node e2e/site-check.ts [url...]   (with no URLs: all sites, writes docs/site-check.json)
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { BRAVE_PATH, EXTENSION_DIR } from './fixtures.ts';

const SITES = [
  'https://www.wikipedia.org/',
  'https://github.com/',
  'https://stackoverflow.com/questions',
  'https://www.reddit.com/r/programming/',
  'https://www.bbc.com/news',
  'https://www.theguardian.com/international',
  'https://www.hurriyet.com.tr/',
  'https://www.sozcu.com.tr/',
  'https://www.sahibinden.com/',
  'https://www.trendyol.com/',
  'https://www.hepsiburada.com/',
  'https://www.amazon.com.tr/',
  'https://eksisozluk.com/',
  'https://www.imdb.com/chart/top/',
  'https://www.google.com/search?q=hava+durumu',
  'https://www.youtube.com/',
];
const SETTLE_MS = 6_000;

const firstParty = (url: string, page: string) => {
  const base = (h: string) => h.split('.').slice(-2).join('.');
  try {
    return base(new URL(url).hostname) === base(new URL(page).hostname);
  } catch {
    return false;
  }
};

async function visit(url: string, withNexus: boolean) {
  const profile = await mkdtemp(join(tmpdir(), 'nexus-site-'));
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
      ...(withNexus
        ? [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
        : []),
    ],
  });
  try {
    if (withNexus) {
      if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker');
      await new Promise((r) => setTimeout(r, 1500));
    }
    const page = await context.newPage();
    const errors: string[] = [];
    let blocked = 0;
    const firstPartyFailed: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
    page.on('requestfailed', (r) => {
      if (r.failure()?.errorText !== 'net::ERR_BLOCKED_BY_CLIENT') return;
      blocked++;
      if (firstParty(r.url(), url) && r.resourceType() !== 'image') {
        firstPartyFailed.push(r.url().slice(0, 100));
      }
    });
    const started = Date.now();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const domMs = Date.now() - started;
    await page.waitForTimeout(SETTLE_MS);
    const seen = await page.evaluate(() => ({
      title: document.title.slice(0, 60),
      textLength: document.body?.innerText.length ?? 0,
      images: [...document.images].filter((i) => i.naturalWidth > 1 && i.width > 1).length,
      links: document.links.length,
      scriptHidden: getComputedStyle(document.body ?? document.documentElement).display === 'none',
    }));
    return {
      status: res?.status() ?? 0,
      domMs,
      blocked,
      errors: errors.length,
      errorSample: errors.slice(0, 3),
      firstPartyFailed: firstPartyFailed.slice(0, 5),
      ...seen,
    };
  } catch (e) {
    return { failed: String(e).slice(0, 120) };
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const results = [];
const chosen = process.argv.slice(2);
for (const url of chosen.length > 0 ? chosen : SITES) {
  const without = await visit(url, false);
  const withNexus = await visit(url, true);
  results.push({ url, without, with: withNexus });
  console.log(url, JSON.stringify({ without, with: withNexus }));
}
if (chosen.length === 0) {
  await writeFile(
    resolve(import.meta.dirname, '../docs/site-check.json'),
    `${JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
}
