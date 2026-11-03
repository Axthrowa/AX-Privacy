import { chromium, type Page, type Worker } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_SCRIPTS, BRAVE_PATH, EXTENSION_DIR, expect, test } from './fixtures.ts';

const RULE_CDN_COOKIES = 8;
// Brave sends the GPC header itself, so the rule for it is not installed there.
const DEFAULT_RULES = [RULE_CDN_COOKIES];

const send = (page: Page, msg: object) => page.evaluate((m) => chrome.runtime.sendMessage(m), msg);

function browserState(worker: Worker) {
  return worker.evaluate(async () => ({
    rules: await chrome.declarativeNetRequest.getDynamicRules(),
    scripts: await chrome.scripting.getRegisteredContentScripts(),
  }));
}

test('service worker starts and registers the content script', async ({ worker }) => {
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.name).toBe('AX Privacy');
  await expect
    .poll(async () => (await browserState(worker)).scripts.map((s) => s.id).sort())
    .toEqual(BASE_SCRIPTS);
  await expect
    .poll(async () => (await browserState(worker)).rules.map((r) => r.id))
    .toEqual(DEFAULT_RULES);
});

test('custom hiding rule from the dashboard hides the element, pausing restores it', async ({
  context,
  extensionId,
  worker,
  origin,
}) => {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#advanced`);
  await dash.getByLabel('Özel kurallar').fill('127.0.0.1##.nexus-test-ad\nbozuk satır');
  await dash.getByRole('button', { name: 'Kaydet' }).click();
  await expect(dash.getByText('0 ağ kuralı, 1 gizleme kuralı etkin')).toBeVisible();
  await expect(dash.locator('.rejected')).toContainText('bozuk satır');

  const page = await context.newPage();
  await page.goto(origin);
  await expect(page.locator('.nexus-test-ad')).toBeHidden();
  await expect(page.locator('.keep')).toBeVisible();

  await send(dash, { type: 'site/setPaused', site: '127.0.0.1', paused: true });
  const { rules, scripts } = await browserState(worker);
  expect(rules.filter((r) => !DEFAULT_RULES.includes(r.id))).toEqual([
    expect.objectContaining({
      id: 2,
      action: { type: 'allowAllRequests' },
      condition: expect.objectContaining({ requestDomains: ['127.0.0.1'] }),
    }),
    expect.objectContaining({
      id: 5,
      action: { type: 'allow' },
      condition: expect.objectContaining({ initiatorDomains: ['127.0.0.1'] }),
    }),
  ]);
  expect(scripts[0]?.excludeMatches).toContain('*://127.0.0.1/*');
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#sites`);
  await expect(dash.getByRole('button', { name: 'Korumayı aç' })).toBeVisible();

  await page.reload();
  await expect(page.locator('.nexus-test-ad')).toBeVisible();
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0]?.id,
    origin,
  );
  expect(await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe(
    'OFF',
  );

  await dash.getByRole('button', { name: 'Korumayı aç' }).click();
  await expect(dash.getByText('Duraklatılan site yok.')).toBeVisible();
  await expect
    .poll(async () => {
      const { scripts } = await browserState(worker);
      return scripts.every((s) => !s.excludeMatches?.includes('*://127.0.0.1/*'));
    })
    .toBe(true);
  await page.reload();
  await expect(page.locator('.nexus-test-ad')).toBeHidden();
});

test('global switch in the popup turns everything off and back on', async ({
  context,
  extensionId,
  worker,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText('Bu sayfada koruma uygulanamaz')).toBeVisible();
  const global = popup.getByRole('switch', { name: 'Tüm koruma' });
  await expect(global).toBeChecked();

  await global.click();
  await expect
    .poll(async () => (await browserState(worker)).rules.map((r) => r.id))
    .toEqual([1, 9]);
  expect((await browserState(worker)).scripts).toEqual([]);
  await expect(global).not.toBeChecked();

  await global.click();
  await expect
    .poll(async () => (await browserState(worker)).rules.map((r) => r.id))
    .toEqual(DEFAULT_RULES);
  await expect
    .poll(async () => (await browserState(worker)).scripts.map((s) => s.id).sort())
    .toEqual(BASE_SCRIPTS);
});

test('records Brave detection from an extension page', async ({ context, extensionId }) => {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#about`);
  await expect(dash.getByText('Tarayıcı: Brave', { exact: true })).toBeVisible();
});

test('web pages cannot message the extension', async ({ context, origin }) => {
  const page = await context.newPage();
  await page.goto(origin);
  const exposed = await page.evaluate(
    () =>
      typeof (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime
        ?.sendMessage,
  );
  expect(exposed).toBe('undefined');
});

test('files replaced between browser runs still get the new rules and keep the settings', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'nexus-update-'));
  await mkdir(join(profile, 'Default'));
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      executablePath: BRAVE_PATH,
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
  let context = await launch();
  let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await expect
    .poll(() =>
      worker.evaluate(
        async () => (await chrome.storage.local.get('appliedVersion')).appliedVersion,
      ),
    )
    .toBeTruthy();
  // What an older version left behind.
  await worker.evaluate(async () => {
    await chrome.scripting.unregisterContentScripts();
    await chrome.storage.local.set({
      appliedVersion: '0.10.3',
      settings: {
        version: 2,
        enabled: true,
        customRules: 'keep.example##.mine',
        enabledLists: ['easylist'],
      },
    });
  });
  await context.close();

  context = await launch();
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('scriptlets');
  const state = await worker.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as {
      settings: { customRules: string; version: number };
    };
    return {
      custom: settings.customRules,
      version: settings.version,
      rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
    };
  });
  expect(state.custom).toBe('keep.example##.mine');
  expect(state.version).toBe(3);
  expect(state.rulesets).toContain('ublock-unbreak');
  await context.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
