/**
 * Manual breakage check on real public sites (not part of CI: results depend on the network and on
 * each site's day). Each page opens in a throwaway Brave profile without and with AX, with no
 * account, and only what any script could read is compared: visible text, images, page errors and
 * failed first-party requests. A large drop with AX points at a site to look at by hand.
 * Usage: npm run sites   or   node e2e/site-check.ts [url...]
 * With no URLs: all sites, then a real-click ad check, and writes docs/site-check.json. The exit code
 * is 1 if a measurable site lost much of its content or an ad tab opened.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
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
const run = promisify(execFile);
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

/** Below this share of the page's own text, a site is worth looking at by hand. */
const MIN_TEXT_RATIO = 0.7;
const POPUP_SITES = ['https://netprime.me/'];

const results = [];
const problems: string[] = [];
const chosen = process.argv.slice(2);
for (const url of chosen.length > 0 ? chosen : SITES) {
  const without = await visit(url, false);
  const withNexus = await visit(url, true);
  results.push({ url, without, with: withNexus });
  // A bot wall answers both runs differently from one load to the next: nothing to compare.
  const measurable =
    'textLength' in without &&
    'textLength' in withNexus &&
    without.status === 200 &&
    (without.textLength ?? 0) > 500;
  if (measurable && withNexus.textLength < without.textLength * MIN_TEXT_RATIO) {
    problems.push(`${url}: metin ${without.textLength} -> ${withNexus.textLength}`);
  }
  console.log(url, JSON.stringify({ without, with: withNexus }));
}
if (chosen.length === 0) {
  for (const url of POPUP_SITES) {
    const { stdout } = await run(
      process.execPath,
      [resolve(import.meta.dirname, 'popup-check.ts'), url, 'nexus', '8'],
      { env: { ...process.env, HEADED: '1' }, maxBuffer: 16 * 1024 * 1024 },
    );
    const tabs = /tabs opened (\d+)/.exec(stdout)?.[1];
    console.log(url, 'ad tabs', tabs);
    if (tabs !== '0') problems.push(`${url}: ${tabs ?? '?'} reklam sekmesi`);
  }
  await writeFile(
    resolve(import.meta.dirname, '../docs/site-check.json'),
    `${JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
}
console.log(problems.length ? `SORUN:\n${problems.join('\n')}` : 'Sorun bulunmadı');
process.exitCode = problems.length ? 1 : 0;
