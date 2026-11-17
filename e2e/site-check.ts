/**
 * Breakage check on real public sites. Each page opens without and with AX in throwaway profiles,
 * with no account, and only what any script could read is compared: visible text, links, images,
 * page errors and blocked first-party requests. Screenshots are compared too (ads left out); a big
 * difference is only a warning, with both screenshots in dist/site-shots to look at. Results depend
 * on the network and on each site's day, so a site that fails is one to look at by hand, not proof
 * of a bug.
 *
 * Usage: npm run sites                 all 200 sites, the real-click ad check, docs/site-check.json
 *        node e2e/site-check.ts --gate all 200 sites, report in dist/site-report.json (CI)
 *        node e2e/site-check.ts <url>  only these pages, nothing written
 *        add --beta to switch on the beta player layer before measuring
 * The exit code is 1 if a measurable site lost much of its content or an ad tab opened.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type BrowserContext } from '@playwright/test';
import { BRAVE_PATH, EXTENSION_DIR } from './fixtures.ts';
import { SITES_GLOBAL, SITES_TR } from './site-list.ts';
import { changedShare, GRID_COLS, GRID_ROWS, maskedCells, type Rect } from './visual-diff.ts';

const run = promisify(execFile);
const SETTLE_MS = 6_000;
const WORKERS = 4;
/** Below this share of the page's own text or links, a site is worth looking at by hand. */
const MIN_TEXT_RATIO = 0.7;
const MIN_LINK_RATIO = 0.5;
/** Above this share of changed screen cells (ads left out), a site gets a warning, not a failure. */
const VISUAL_WARN = 0.4;
const VIEWPORT = { width: 1366, height: 800 };
const SHOTS_DIR = resolve(import.meta.dirname, '../dist/site-shots');
const POPUP_SITES = ['https://netprime.me/'];

const base = (h: string) => h.split('.').slice(-2).join('.');
const firstParty = (url: string, page: string) => {
  try {
    return base(new URL(url).hostname) === base(new URL(page).hostname);
  } catch {
    return false;
  }
};

async function launch(
  withAx: boolean,
): Promise<{ context: BrowserContext; close(): Promise<void> }> {
  const profile = await mkdtemp(join(tmpdir(), 'ax-site-'));
  await mkdir(join(profile, 'Default'));
  // Secure DNS: some networks answer blocked names with their own certificate.
  await writeFile(
    join(profile, 'Local State'),
    JSON.stringify({
      dns_over_https: { mode: 'secure', templates: 'https://cloudflare-dns.com/dns-query' },
    }),
  );
  await writeFile(
    join(profile, 'Default', 'Preferences'),
    JSON.stringify({ profile: { default_content_setting_values: { braveShields: 2 } } }),
  );
  const brave = existsSync(BRAVE_PATH);
  const context = await chromium.launchPersistentContext(profile, {
    // CI has no Brave; Playwright's own Chromium loads the extension the same way.
    ...(brave ? { executablePath: BRAVE_PATH } : { channel: 'chromium' }),
    headless: true,
    locale: 'tr-TR',
    viewport: VIEWPORT,
    args: [
      '--no-first-run',
      '--mute-audio',
      ...(withAx
        ? [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
        : []),
    ],
  });
  if (withAx) {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    for (let i = 0; i < 150; i++) {
      const ready = await worker.evaluate(
        async () => (await chrome.storage.local.get('appliedVersion')).appliedVersion,
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    // Cookie auto-reject removes the banner, and its text, by design: a text comparison would
    // read that as lost content (MSN, SoundCloud). It has its own e2e test instead.
    const ui = await context.newPage();
    await ui.goto(`chrome-extension://${new URL(worker.url()).host}/dashboard.html`);
    await ui.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'privacy/set', privacy: { cookieAutoReject: false } }),
    );
    await ui.close();
    if (process.argv.includes('--beta')) {
      // Through the dashboard, as a user would; waits until the player layer is registered.
      const dash = await context.newPage();
      await dash.goto(`chrome-extension://${new URL(worker.url()).host}/dashboard.html#video`);
      await dash.getByRole('switch', { name: /Diğer sitelerdeki oynatıcılarda/ }).click();
      for (let i = 0; i < 50; i++) {
        const ids = await worker.evaluate(async () =>
          (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
        );
        if (ids.includes('video-generic')) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      await dash.close();
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

async function visit(context: BrowserContext, url: string) {
  const page = await context.newPage();
  try {
    let errors = 0;
    let blocked = 0;
    const firstPartyBlocked: string[] = [];
    page.on('pageerror', () => errors++);
    page.on('requestfailed', (r) => {
      if (r.failure()?.errorText !== 'net::ERR_BLOCKED_BY_CLIENT') return;
      blocked++;
      if (firstParty(r.url(), url) && r.resourceType() !== 'image') {
        firstPartyBlocked.push(`${r.resourceType()} ${r.url().slice(0, 90)}`);
      }
    });
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(SETTLE_MS);
    const seen = await page.evaluate(() => ({
      title: document.title.slice(0, 60),
      textLength: document.body?.innerText.length ?? 0,
      // Text of boxes the page itself labels as ads: losing it is the point, not breakage.
      ...(() => {
        const labels = new Set(['ad', 'ads', 'reklam', 'sponsored', 'sponsorlu', 'advertisement']);
        const boxes = new Set<HTMLElement>();
        for (const el of document.body?.querySelectorAll<HTMLElement>('*') ?? []) {
          if (el.childElementCount > 0) continue;
          if (!labels.has(el.innerText?.trim().toLowerCase() ?? '')) continue;
          let box = el;
          for (let up = el.parentElement; up && up.innerText.length < 400; up = up.parentElement) {
            box = up;
          }
          boxes.add(box);
        }
        const outer = [...boxes].filter((b) => ![...boxes].some((o) => o !== b && o.contains(b)));
        // On screen: labelled ad boxes and frames (where ad networks draw), left out of the diff.
        const adRects = [...outer, ...document.querySelectorAll('iframe')].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        return { adText: outer.reduce((n, b) => n + b.innerText.length, 0), adRects };
      })(),
      images: [...document.images].filter((i) => i.naturalWidth > 1 && i.width > 1).length,
      links: document.links.length,
      hidden: getComputedStyle(document.body ?? document.documentElement).display === 'none',
    }));
    const shot = await page.screenshot({ type: 'png' });
    return {
      status: res?.status() ?? 0,
      blocked,
      errors,
      firstPartyBlocked: firstPartyBlocked.slice(0, 5),
      ...seen,
      shot,
    };
  } catch (e) {
    return { failed: String(e).split('\n', 1).join('').slice(0, 120) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

type Seen = Awaited<ReturnType<typeof visit>>;

/** A screenshot as GRID_COLS x GRID_ROWS average colours (RGBA), decoded in a page without AX. */
async function gridOf(context: BrowserContext, png: Buffer): Promise<number[]> {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      async ([b64, cols, rows]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = cols;
        canvas.height = rows;
        const ctx = canvas.getContext('2d');
        if (!ctx) return [];
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, cols, rows);
        return [...ctx.getImageData(0, 0, cols, rows).data];
      },
      [png.toString('base64'), GRID_COLS, GRID_ROWS] as const,
    );
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Share of the screen (ads left out) that looks different with AX, or null if not comparable. */
async function visualChange(context: BrowserContext, without: Seen, withAx: Seen) {
  if ('failed' in without || 'failed' in withAx) return null;
  const masked = maskedCells(without.adRects as Rect[], VIEWPORT.width, VIEWPORT.height);
  const [a, b] = await Promise.all([gridOf(context, without.shot), gridOf(context, withAx.shot)]);
  if (a.length === 0 || b.length === 0) return null;
  return Math.round(changedShare(a, b, masked) * 100) / 100;
}

/** The report keeps what was measured, not the screenshots and boxes behind it. */
const forReport = (seen: Seen) => {
  if ('failed' in seen) return seen;
  const { shot, adRects, ...rest } = seen;
  void shot;
  void adRects;
  return rest;
};

/** Why this site needs a look, or null. A bot wall or a failed load without AX compares nothing. */
function problemOf(without: Seen, withAx: Seen): string | null {
  if ('failed' in without || without.status !== 200 || without.textLength <= 500) return null;
  if ('failed' in withAx) return `AX ile açılmadı: ${withAx.failed}`;
  if (withAx.hidden) return 'AX ile sayfa gövdesi gizli';
  if (withAx.status !== 200) return `AX ile durum ${withAx.status}`;
  if (withAx.textLength - withAx.adText < (without.textLength - without.adText) * MIN_TEXT_RATIO) {
    return `metin ${without.textLength} -> ${withAx.textLength}`;
  }
  if (without.links >= 20 && withAx.links < without.links * MIN_LINK_RATIO) {
    return `bağlantı ${without.links} -> ${withAx.links}`;
  }
  return null;
}

const args = process.argv.slice(2);
const gate = args.includes('--gate');
const chosen = args.filter((a) => !a.startsWith('--'));
const sites = chosen.length > 0 ? chosen : [...SITES_TR, ...SITES_GLOBAL];

const plain = await launch(false);
const ax = await launch(true);
const results: {
  url: string;
  without: ReturnType<typeof forReport>;
  with: ReturnType<typeof forReport>;
  problem: string | null;
  /** Difference AX adds beyond what a second load without AX changes by itself. */
  visualChange: number | null;
}[] = [];
const queue = [...sites];
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const without = await visit(plain.context, url);
      let withAx = await visit(ax.context, url);
      // One retry: a slow or flaky load must not look like breakage.
      if (problemOf(without, withAx)) withAx = await visit(ax.context, url);
      const problem = problemOf(without, withAx);
      const measurable =
        !('failed' in without) && without.status === 200 && without.textLength > 500;
      const raw = measurable ? await visualChange(plain.context, without, withAx) : null;
      // Pages change between loads (news, ads, carousels): a big difference is set against a
      // second load without AX, and only what AX adds on top counts.
      const natural =
        raw !== null && raw > VISUAL_WARN
          ? await visualChange(plain.context, without, await visit(plain.context, url))
          : null;
      const visual =
        raw === null ? null : Math.max(0, Math.round((raw - (natural ?? 0)) * 100) / 100);
      results.push({
        url,
        without: forReport(without),
        with: forReport(withAx),
        problem,
        visualChange: visual,
      });
      const warned = visual !== null && visual > VISUAL_WARN;
      if (warned && !('failed' in without) && !('failed' in withAx)) {
        const name = new URL(url).hostname;
        await mkdir(SHOTS_DIR, { recursive: true });
        await writeFile(join(SHOTS_DIR, `${name}-off.png`), without.shot);
        await writeFile(join(SHOTS_DIR, `${name}-ax.png`), withAx.shot);
      }
      const look = warned ? ` görsel fark %${Math.round(visual * 100)}` : '';
      console.log(problem ? 'SORUN' : 'ok   ', url, problem ?? '', look);
    }
  }),
);
await plain.close();
await ax.close();
results.sort((a, b) => sites.indexOf(a.url) - sites.indexOf(b.url));

const problems = results.filter((r) => r.problem).map((r) => `${r.url}: ${r.problem}`);
/** Worth a look by eye; screenshots vary with each load, so these never fail the run. */
const warnings = results
  .filter((r) => r.visualChange !== null && r.visualChange > VISUAL_WARN)
  .map((r) => `${r.url}: ekranın %${Math.round((r.visualChange ?? 0) * 100)}'i farklı`);
const measurable = results.filter(
  (r) => !('failed' in r.without) && r.without.status === 200 && r.without.textLength > 500,
);
const summary = {
  sites: results.length,
  measurable: measurable.length,
  problems: problems.length,
  firstPartyBlocked: results.filter(
    (r) => 'firstPartyBlocked' in r.with && r.with.firstPartyBlocked.length,
  ).length,
  blockedRequests: results.reduce((n, r) => n + ('blocked' in r.with ? r.with.blocked : 0), 0),
  visualWarnings: warnings.length,
};

if (chosen.length === 0 && !gate) {
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
}
if (chosen.length === 0) {
  const report = `${JSON.stringify({ measuredAt: new Date().toISOString(), summary, problems, warnings, results }, null, 1)}\n`;
  const out = gate ? '../dist/site-report.json' : '../docs/site-check.json';
  await writeFile(resolve(import.meta.dirname, out), report);
}
console.log(JSON.stringify(summary));
console.log(problems.length ? `SORUN:\n${problems.join('\n')}` : 'Sorun bulunmadı');
if (warnings.length) console.log(`Görsel fark (elle bakılmalı):\n${warnings.join('\n')}`);
process.exitCode = problems.length ? 1 : 0;
