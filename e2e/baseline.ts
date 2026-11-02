/**
 * Phase 0 runtime baseline: blocking overlap, false positives, page load time and memory of the
 * installed blockers versus AX, measured in throwaway Brave profiles against a local page.
 * Usage: node e2e/baseline.ts   (writes docs/runtime-baseline.json)
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { BRAVE_PATH, EXTENSION_DIR } from './fixtures.ts';

const INSTALLED = join(
  process.env.LOCALAPPDATA ?? '',
  'BraveSoftware/Brave-Browser/User Data/Default/Extensions',
);
const EXTENSIONS: Record<string, string> = {
  AdGuard: 'bgnkhhnnamicmpeenaelnjfhikgbkllg',
  'uBO Lite': 'ddkjiahejlhfcafbddmgiahcphecmpfh',
  Ghostery: 'mlomiejdfkolichcflejclcbmpeaniij',
  Malwarebytes: 'ihcjicgdanjaechkgeegckofjjedodee',
  'Privacy Badger': 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp',
};

const THIRD_PARTY = {
  ads: [
    'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'securepubads.g.doubleclick.net/tag/js/gpt.js',
    'static.criteo.net/js/ld/publishertag.js',
    'cdn.taboola.com/libtrc/test/loader.js',
    'widgets.outbrain.com/outbrain.js',
    'c.amazon-adsystem.com/aax2/apstag.js',
  ],
  // HSTS-preloaded hosts (google-analytics.com, facebook.net, bing.com) are upgraded to https and
  // cannot reach the plain-http test server, so they are not usable as probes.
  trackers: [
    'www.googletagmanager.com/gtag/js',
    'cdn.segment.com/analytics.js/v1/test/analytics.min.js',
    'js.hs-analytics.net/analytics/1/1.js',
    'sb.scorecardresearch.com/beacon.js',
    'static.hotjar.com/c/hotjar-1.js',
    'script.crazyegg.com/pages/scripts/0000/0000.js',
    'mc.yandex.ru/metrika/tag.js',
  ],
};
const FIRST_PARTY = ['/static/app.js', '/api/data.js', '/assets/vendor.js'];
const COSMETIC = ['ins.adsbygoogle', '#div-gpt-ad-1', '.ad-banner', '.sponsored-content'];
const PAGE_HOST = 'nexus-test.example';
const RUNS = 5;

const hosts = [
  PAGE_HOST,
  ...Object.values(THIRD_PARTY)
    .flat()
    .map((u) => u.split('/')[0]),
];

function page(port: number): string {
  const tp = Object.entries(THIRD_PARTY).flatMap(([cat, urls]) =>
    urls.map((u) => ({ cat, url: `http://${u.replace('/', `:${port}/`)}` })),
  );
  const fp = FIRST_PARTY.map((p) => ({ cat: 'firstParty', url: p }));
  return `<!doctype html><title>baseline</title>
<ins class="adsbygoogle">x</ins><div id="div-gpt-ad-1">x</div><div class="ad-banner">x</div>
<div class="sponsored-content">x</div><main id="content">content</main>
<script>
window.__res = [];
for (const r of ${JSON.stringify([...tp, ...fp])}) {
  const s = document.createElement('script');
  s.src = r.url;
  s.onload = () => __res.push({ ...r, ok: true });
  s.onerror = () => __res.push({ ...r, ok: false });
  document.head.append(s);
}
</script>`;
}

function processMemoryMb(profile: string): number {
  const ps = `(Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | Measure-Object WorkingSetSize -Sum).Sum`;
  const bytes = Number(
    execFileSync('powershell', ['-NoProfile', '-Command', ps]).toString().trim(),
  );
  return Math.round(bytes / 1024 / 1024);
}

async function copyExtension(id: string, into: string): Promise<string> {
  const [version] = (await readdir(join(INSTALLED, id))).sort().reverse();
  if (!version) throw new Error(`${id} not installed`);
  const dst = join(into, id);
  await cp(join(INSTALLED, id, version), dst, { recursive: true });
  await rm(join(dst, '_metadata'), { recursive: true, force: true });
  return dst;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function measure(label: string, extensions: string[], port: number) {
  const profile = await mkdtemp(join(tmpdir(), 'nexus-baseline-'));
  // Shields off by default (2 = BLOCK) so each extension is measured on its own.
  await mkdir(join(profile, 'Default'));
  await writeFile(
    join(profile, 'Default', 'Preferences'),
    JSON.stringify({ profile: { default_content_setting_values: { braveShields: 2 } } }),
  );

  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    `--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`,
  ];
  if (extensions.length) {
    args.push(
      `--disable-extensions-except=${extensions.join(',')}`,
      `--load-extension=${extensions.join(',')}`,
    );
  }
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: BRAVE_PATH,
    headless: true,
    args,
  });
  try {
    await new Promise((r) => setTimeout(r, extensions.length ? 20_000 : 3_000));
    for (const p of context.pages().slice(1)) await p.close();
    const tab = context.pages()[0] ?? (await context.newPage());
    const loads: number[] = [];
    let res: { cat: string; url: string; ok: boolean }[] = [];
    let hidden: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      await tab.goto(`http://${PAGE_HOST}:${port}/`, { waitUntil: 'load' });
      await tab.waitForFunction(
        (n) => (window as unknown as { __res: unknown[] }).__res.length === n,
        Object.values(THIRD_PARTY).flat().length + FIRST_PARTY.length,
        { timeout: 15_000 },
      );
      await tab.waitForTimeout(500);
      loads.push(
        await tab.evaluate(() => {
          const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
          return Math.round(nav?.loadEventEnd ?? 0);
        }),
      );
      res = await tab.evaluate(() => (window as unknown as { __res: typeof res }).__res);
      hidden = await tab.evaluate(
        (sels) =>
          sels.filter((s) => {
            const el = document.querySelector(s);
            return (
              !el ||
              getComputedStyle(el).display === 'none' ||
              (el as HTMLElement).offsetHeight === 0
            );
          }),
        COSMETIC,
      );
    }
    const blocked = (cat: string) => res.filter((r) => r.cat === cat && !r.ok);
    return {
      label,
      adsBlocked: `${blocked('ads').length}/${THIRD_PARTY.ads.length}`,
      trackersBlocked: `${blocked('trackers').length}/${THIRD_PARTY.trackers.length}`,
      firstPartyBroken: blocked('firstParty').map((r) => r.url),
      cosmeticHidden: `${hidden.length}/${COSMETIC.length}`,
      hiddenSelectors: hidden,
      blockedUrls: res
        .filter((r) => !r.ok && r.cat !== 'firstParty')
        .map((r) => r.url.replace(/:\d+\//, '/')),
      loadMsMedian: median(loads),
      memoryMb: processMemoryMb(profile),
      mainContentHidden: !(await tab.locator('#content').isVisible()),
    };
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page((server.address() as AddressInfo).port));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/javascript' });
  res.end('/* ok */');
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const port = (server.address() as AddressInfo).port;

const work = await mkdtemp(join(tmpdir(), 'nexus-ext-copies-'));
const copies: Record<string, string> = {};
for (const [name, id] of Object.entries(EXTENSIONS)) copies[name] = await copyExtension(id, work);

const { version } = JSON.parse(await readFile(join(EXTENSION_DIR, 'manifest.json'), 'utf8')) as {
  version: string;
};
const configs: [string, string[]][] = [
  ['Hiçbiri (Shields kapalı)', []],
  [`AX ${version}`, [EXTENSION_DIR]],
  ...Object.entries(copies).map(([n, dir]): [string, string[]] => [n, [dir]]),
  [`AX ${version} + AdGuard`, [EXTENSION_DIR, copies.AdGuard ?? '']],
  [`AX ${version} + uBO Lite`, [EXTENSION_DIR, copies['uBO Lite'] ?? '']],
  ['Beş engelleyici birlikte', Object.values(copies)],
  ['Beş engelleyici + AX', [...Object.values(copies), EXTENSION_DIR]],
];

const results = [];
for (const [label, exts] of configs) {
  console.log(`measuring ${label}…`);
  try {
    results.push(await measure(label, exts, port));
  } catch (e) {
    results.push({ label, error: e instanceof Error ? e.message : String(e) });
  }
}
server.close();
await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });

const out = resolve(import.meta.dirname, '../docs/runtime-baseline.json');
await writeFile(
  out,
  `${JSON.stringify({ measuredAt: new Date().toISOString(), runsPerConfig: RUNS, results }, null, 2)}\n`,
);
console.table(results.map((r) => ('error' in r ? r : { ...r, blockedUrls: r.blockedUrls.length })));
console.log(`wrote ${out}`);
