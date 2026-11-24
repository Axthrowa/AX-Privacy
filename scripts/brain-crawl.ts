/**
 * AX-Brain offline training data: visits each site in a list with headless Chromium, labels the
 * candidates that the shipped cosmetic filters hide as ads (1) and a sample of the rest as not (0),
 * and appends their 48-feature vectors to `<out>/rows.jsonl`.
 *
 *   node scripts/brain-crawl.ts <sites.txt> <out-dir> [--jobs 8] [--limit 11000]
 *
 * Sites are never written out by name: rows carry a SHA-256 prefix of the site, so a held-out
 * split by site is possible without the list. `<out>/hosts.json` counts, per requested host's
 * registrable domain, on how many sites it was requested (input for the filter compiler's core
 * set). Keep `<out>` outside the repository.
 */
import { FiltersEngine } from '@ghostery/adblocker';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { rolldown } from 'rolldown';
import { rootDomain } from '../src/engines/brain/brain.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const [sitesFile, outDir] = args.filter(
  (a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'),
);
if (!sitesFile || !outDir) {
  console.error('usage: node scripts/brain-crawl.ts <sites.txt> <out-dir> [--jobs 8] [--limit N]');
  process.exit(2);
}
const JOBS = flag('--jobs', 8);
const LIMIT = flag('--limit', Infinity);
const MAX_POSITIVE = 40;

const root = resolve(import.meta.dirname, '..');
await mkdir(outDir, { recursive: true });
const rowsFile = resolve(outDir, 'rows.jsonl');
const doneFile = resolve(outDir, 'done.txt');
const hostsFile = resolve(outDir, 'hosts.json');

const hash = (site: string) => createHash('sha256').update(site).digest('hex').slice(0, 16);
const done = new Set((await readFile(doneFile, 'utf8').catch(() => '')).split('\n'));
const hostCounts: Record<string, number> = JSON.parse(
  await readFile(hostsFile, 'utf8').catch(() => '{}'),
) as Record<string, number>;

const sites = (await readFile(sitesFile, 'utf8'))
  .split(/\r?\n/)
  .map((l) => l.trim().split(',').pop() ?? '')
  .filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s))
  .slice(0, LIMIT)
  .filter((s) => !done.has(hash(s)));
console.log(`${sites.length} sites to crawl, ${done.size - 1} done before`);

const bundle = await rolldown({
  input: resolve(root, 'scripts/brain-page.ts'),
  logLevel: 'silent',
});
const pageScript = (await bundle.generate({ format: 'iife' })).output[0].code;
const engine = FiltersEngine.deserialize(
  new Uint8Array(await readFile(resolve(root, 'public/engines/default.bin'))),
);

interface PageApi {
  domTokens(): { classes: string[]; ids: string[]; hrefs: string[] };
  collect(host: string, max: number): { y: 0 | 1; f: number[] }[];
}

async function crawl(browser: Browser, site: string): Promise<number> {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: site.endsWith('.tr') ? 'tr-TR' : 'en-US',
  });
  const hosts = new Set<string>();
  try {
    const page = await context.newPage();
    page.on('request', (r) => {
      try {
        hosts.add(rootDomain(new URL(r.url()).hostname));
      } catch {
        // data: and blob: requests.
      }
    });
    page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
    await page.goto(`https://${site}/`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForTimeout(3500);
    await page.mouse.wheel(0, 900).catch(() => undefined);
    await page.waitForTimeout(1200);
    await page.evaluate(() => scrollTo(0, 0)).catch(() => undefined);
    await page.addScriptTag({ content: pageScript });
    const url = page.url();
    const hostname = new URL(url).hostname;
    const tokens = await page.evaluate(() =>
      (globalThis as unknown as { __axBrain: PageApi }).__axBrain.domTokens(),
    );
    const { styles } = engine.getCosmeticsFilters({
      url,
      hostname,
      domain: rootDomain(hostname),
      ...tokens,
      getBaseRules: true,
      getInjectionRules: false,
      getExtendedRules: false,
      getRulesFromDOM: true,
      getRulesFromHostname: true,
      hidingStyle: '--ax-label: 1 !important;',
    });
    if (styles) await page.addStyleTag({ content: styles });
    const rows = await page.evaluate(
      ([h, max]) =>
        (globalThis as unknown as { __axBrain: PageApi }).__axBrain.collect(
          h as string,
          max as number,
        ),
      [hostname, MAX_POSITIVE] as const,
    );
    const s = hash(site);
    if (rows.length)
      await appendFile(rowsFile, rows.map((r) => JSON.stringify({ s, ...r })).join('\n') + '\n');
    for (const h of hosts) if (h) hostCounts[h] = (hostCounts[h] ?? 0) + 1;
    return rows.length;
  } finally {
    await context.close().catch(() => undefined);
  }
}

const browser = await chromium.launch({ headless: true });
let next = 0;
let ok = 0;
let failed = 0;
let rowCount = 0;
const started = Date.now();
async function worker(): Promise<void> {
  while (next < sites.length) {
    const site = sites[next++] ?? '';
    try {
      // Read the count first: `rowCount += await` would race the other workers.
      const rows = await Promise.race([
        crawl(browser, site),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 60_000)),
      ]);
      rowCount += rows;
      ok++;
    } catch {
      failed++;
    }
    await appendFile(doneFile, `${hash(site)}\n`);
    const n = ok + failed;
    if (n % 50 === 0) {
      await writeFile(hostsFile, JSON.stringify(hostCounts));
      const min = (Date.now() - started) / 60_000;
      console.log(
        `${n}/${sites.length} sites, ${failed} failed, ${rowCount} rows, ${min.toFixed(1)} min`,
      );
    }
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));
await writeFile(hostsFile, JSON.stringify(hostCounts));
await browser.close();
console.log(`done: ${ok} ok, ${failed} failed, ${rowCount} rows`);
