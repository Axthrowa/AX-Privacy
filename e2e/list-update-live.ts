/**
 * Manual check of list updates against the real list servers (not part of CI). A copy of the build is
 * made stale on purpose: one packaged rule is removed and a rule no list contains is added. A real
 * update must bring the first back as a dynamic rule and switch the second off.
 * Usage: node e2e/list-update-live.ts
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import type { DnrRule } from '../src/engines/adblock/network.ts';
import type { ListsView } from '../src/shared/types.ts';
import { BRAVE_PATH, EXTENSION_DIR } from './fixtures.ts';

const AD_SCRIPT = 'https://lt.bollingpatties.com/raopfHgJ6uO/vWlLn';
const dir = await mkdtemp(join(tmpdir(), 'nexus-update-live-'));
const ext = join(dir, 'ext');
await cp(EXTENSION_DIR, ext, { recursive: true });
const file = join(ext, 'rulesets/ublock.json');
const rules = JSON.parse(await readFile(file, 'utf8')) as DnrRule[];
const hits = (r: DnrRule) =>
  r.condition.regexFilter !== undefined && new RegExp(r.condition.regexFilter, 'i').test(AD_SCRIPT);
const kept = rules.filter((r) => !hits(r));
const staleId = Math.max(...rules.map((r) => r.id)) + 1;
kept.push({
  id: staleId,
  priority: 1,
  action: { type: 'block' },
  condition: { urlFilter: '||nexus-stale.example^' },
});
await writeFile(file, JSON.stringify(kept));
console.log(`removed ${rules.length - kept.length + 1} packaged rules matching the ad script`);

const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
  executablePath: BRAVE_PATH,
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  await new Promise((r) => setTimeout(r, 3000));
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/dashboard.html`);
  const matched = (url: string) =>
    worker.evaluate(
      async (u) =>
        (
          await chrome.declarativeNetRequest.testMatchOutcome({
            url: u,
            type: 'script' as chrome.declarativeNetRequest.ResourceType,
            initiator: 'https://netprime.me',
          })
        ).matchedRules.map((m) => `${m.rulesetId}:${m.ruleId}`),
      url,
    );
  console.log('before: ad script matched by', await matched(AD_SCRIPT));
  console.log('before: stale rule matches', await matched('https://nexus-stale.example/a.js'));

  const update = async () => {
    const started = Date.now();
    const reply = await ui.evaluate(async () => {
      const r = (await chrome.runtime.sendMessage({ type: 'lists/updateNow' })) as {
        ok: boolean;
        error?: string;
        data?: ListsView;
      };
      return r;
    });
    console.log(
      `update took ${Date.now() - started} ms`,
      JSON.stringify(reply.ok ? reply.data?.updates.status : reply.error),
      'dynamic rules',
      reply.data?.dynamicRules,
    );
  };
  await update();
  console.log('after: ad script matched by', await matched(AD_SCRIPT));
  console.log('after: stale rule matches', await matched('https://nexus-stale.example/a.js'));
  console.log(
    'disabled in ublock',
    (
      await worker.evaluate(() =>
        chrome.declarativeNetRequest.getDisabledRuleIds({ rulesetId: 'ublock' }),
      )
    ).includes(staleId),
  );
  await update();

  const page = await context.newPage();
  await page.goto('https://netprime.me/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(6000);
  console.log(
    'real page after update: iframes',
    await page.evaluate(() => document.querySelectorAll('iframe').length),
    'title',
    await page.title(),
  );
} finally {
  await context.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
    () => undefined,
  );
}
