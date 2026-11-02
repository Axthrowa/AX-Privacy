/**
 * Manual popup check on a real page: makes real clicks in a throwaway Brave profile and records every
 * tab that opens, how the main page moved, and which ad-looking scripts loaded. No account is used.
 * Usage: node e2e/popup-check.ts <url> [nexus|none|<extension dir>] [clicks]
 * Set HEADED=1 for a visible window: ad scripts served ads there that they withheld in headless.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { BRAVE_PATH, EXTENSION_DIR } from './fixtures.ts';

const url = process.argv[2];
if (!url) throw new Error('usage: popup-check.ts <url> [nexus|none|<dir>] [clicks]');
const mode = process.argv[3] ?? 'nexus';
const clicks = Number(process.argv[4] ?? 6);
const extension = mode === 'none' ? null : mode === 'nexus' ? EXTENSION_DIR : mode;

const profile = await mkdtemp(join(tmpdir(), 'nexus-popup-'));
await mkdir(join(profile, 'Default'));
await writeFile(
  join(profile, 'Default', 'Preferences'),
  JSON.stringify({ profile: { default_content_setting_values: { braveShields: 2 } } }),
);
const context = await chromium.launchPersistentContext(profile, {
  executablePath: BRAVE_PATH,
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 800 },
  args: [
    '--no-first-run',
    ...(extension
      ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
      : []),
  ],
});
try {
  if (extension) {
    if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker');
    await new Promise((r) => setTimeout(r, 2500));
  }
  const page = await context.newPage();
  const opened: { at: string; url: string; final?: string }[] = [];
  let label = 'load';
  context.on('page', (p) => {
    const entry: { at: string; url: string; final?: string } = { at: label, url: p.url() };
    opened.push(entry);
    setTimeout(() => {
      try {
        entry.final = p.url();
      } catch {
        entry.final = 'closed';
      }
    }, 2500);
  });
  const hosts = new Map<string, { ok: number; blocked: number }>();
  const note = (u: string, blocked: boolean) => {
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      return;
    }
    const h = hosts.get(host) ?? { ok: 0, blocked: 0 };
    if (blocked) h.blocked++;
    else h.ok++;
    hosts.set(host, h);
  };
  context.on('requestfinished', (r) => note(r.url(), false));
  context.on('requestfailed', (r) =>
    note(r.url(), r.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT'),
  );
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(6000);
  const start = page.url();
  console.log('status', res?.status(), 'title', await page.title());

  const box = page.viewportSize() ?? { width: 1280, height: 800 };
  const points = [
    [0.5, 0.5],
    [0.2, 0.3],
    [0.8, 0.3],
    [0.5, 0.8],
    [0.1, 0.9],
    [0.9, 0.9],
    [0.5, 0.15],
    [0.3, 0.6],
  ];
  for (let i = 0; i < clicks; i++) {
    const [x = 0.5, y = 0.5] = points[i % points.length] ?? [];
    label = `click ${i + 1}`;
    await page.bringToFront();
    await page.mouse.click(Math.round(box.width * x), Math.round(box.height * y));
    await page.waitForTimeout(1500);
    if (page.url() !== start) {
      console.log(`${label}: main page moved to ${page.url()}`);
      await page.goto(start, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.waitForTimeout(2000);
    }
  }
  await page.waitForTimeout(3000);
  console.log('tabs opened', opened.length);
  for (const o of opened) console.log(' ', o.at, o.url, '->', o.final);
  const third = [...hosts.entries()].sort((a, b) => b[1].ok - a[1].ok);
  console.log(
    'hosts',
    third.map(([h, c]) => `${h}:${c.ok}${c.blocked ? `/x${c.blocked}` : ''}`).join(' '),
  );
  const seen = await page.evaluate(() => ({
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
    frames: [...document.querySelectorAll('iframe')].map((f) => f.src),
    overlays: [...document.querySelectorAll('a[target=_blank], a[href]')]
      .filter((a) => {
        const r = a.getBoundingClientRect();
        return r.width > innerWidth * 0.5 && r.height > innerHeight * 0.5;
      })
      .map((a) => (a as HTMLAnchorElement).href),
  }));
  console.log(JSON.stringify(seen, null, 0));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
