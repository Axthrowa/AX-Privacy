/**
 * DNR refuses a regex over its compiled memory limit, and one such rule in a static ruleset can stop
 * the extension from starting. Only the browser can tell, so the build asks it.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

export interface RegexQuery {
  regex: string;
  isCaseSensitive: boolean;
}

const BROWSERS = [
  process.env.BRAVE_PATH,
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
];

/** Indexes of the queries the browser rejects. */
export async function rejectedRegexes(queries: readonly RegexQuery[]): Promise<Set<number>> {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-regex-'));
  const ext = join(dir, 'ext');
  const profile = join(dir, 'profile');
  await mkdir(ext);
  await writeFile(
    join(ext, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'regex check',
      version: '1',
      background: { service_worker: 'b.js' },
      permissions: ['declarativeNetRequest'],
    }),
  );
  await writeFile(join(ext, 'b.js'), '');
  const context = await chromium.launchPersistentContext(profile, {
    // Elsewhere (CI), Playwright's own Chromium answers the same question.
    executablePath: BROWSERS.find((p) => p && existsSync(p)),
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const bad = await worker.evaluate(async (list) => {
      const out: number[] = [];
      for (const [i, q] of list.entries()) {
        const r = await chrome.declarativeNetRequest.isRegexSupported(q);
        if (!r.isSupported) out.push(i);
      }
      return out;
    }, queries as RegexQuery[]);
    return new Set(bad);
  } finally {
    await context.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
