import type { BrowserContext, Page, Worker } from '@playwright/test';
import { EXTENSION_DIR, expect, launchBrave, startServer, test } from './fixtures.ts';

const SITE = 'shop.nexus-test.example';

const settings = (worker: Worker) =>
  worker.evaluate(
    async () =>
      (await chrome.storage.local.get('settings')).settings as {
        siteProfiles: Record<string, Record<string, boolean>>;
        pausedSites: string[];
        privacy: { blockThirdPartyCookies: boolean; fingerprint: string };
      },
  );

/** The popup as a background tab, so the tab it acts on is the site's. */
async function popupFor(context: BrowserContext, worker: Worker, extensionId: string, site: Page) {
  const popup = await context.newPage();
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  }, site.url());
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

test('a fresh install opens the welcome page; choosing a profile applies it', async ({
  context,
  worker,
}) => {
  await expect
    .poll(() => context.pages().find((p) => p.url().endsWith('dashboard.html#welcome')))
    .toBeTruthy();
  const welcome = context.pages().find((p) => p.url().endsWith('#welcome')) as Page;
  await expect(welcome.getByRole('heading', { level: 2 })).toHaveText(
    'AX Privacy kuruldu, koruma açık',
  );
  await expect(welcome.getByRole('button', { name: 'Dengeli (önerilen)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await welcome.getByRole('button', { name: 'Sıkı' }).click();
  await expect
    .poll(async () => (await settings(worker)).privacy)
    .toMatchObject({ blockThirdPartyCookies: true, fingerprint: 'strict' });
  await welcome.getByRole('button', { name: 'Tamam' }).click();
  await expect(welcome.getByRole('heading', { name: 'Özet' })).toBeVisible();
});

test('the breakage wizard relaxes one layer at a time and keeps what fixed it', async ({
  context,
  extensionId,
  worker,
}) => {
  const { port, server } = await startServer();
  const site = await context.newPage();
  await site.goto(`http://${SITE}:${port}/`);
  const popup = await popupFor(context, worker, extensionId, site);
  await expect(popup.locator('.site-domain')).toHaveText('nexus-test.example');

  await popup.getByText('Sayfa raporu ve sorun giderme').click();
  await popup.getByRole('button', { name: 'Bu sitede sorun var' }).click();
  await popup.getByRole('button', { name: 'Başla' }).click();
  // One layer off at a time, in the plan's order (Fix.tsx STEPS); the last step pauses the site.
  const first = await popup.getByText(/^Adım 1\/\d+:/).textContent();
  const total = Number(/\/(\d+):/.exec(first ?? '')?.[1]);
  await expect
    .poll(async () => (await settings(worker)).siteProfiles['nexus-test.example'])
    .toMatchObject({ generic: false, network: true });

  // Keep going until ad and tracker blocking is off too, the step before pausing.
  for (let at = 2; at < total; at++) {
    await popup.getByRole('button', { name: 'Hayır, devam et' }).click();
    await expect(popup.getByText(`Adım ${at}/${total}:`)).toBeVisible();
  }
  await expect
    .poll(async () => (await settings(worker)).siteProfiles['nexus-test.example'])
    .toMatchObject({ generic: true, privacy: true, video: true, network: false, security: true });
  await popup.getByRole('button', { name: 'Evet, düzeldi' }).click();
  await expect(popup.getByText('reklam ve izleyici engelleme', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Kapat' }).click();

  // A second run skips the layer already off; undoing it puts the site back exactly as it was.
  // The report section is still open from the first run.
  await popup.getByRole('button', { name: 'Bu sitede sorun var' }).click();
  await popup.getByRole('button', { name: 'Başla' }).click();
  for (let at = 2; at <= total - 1; at++) {
    await popup.getByRole('button', { name: 'Hayır, devam et' }).click();
  }
  await expect(popup.getByText(`Adım ${total - 1}/${total - 1}:`)).toBeVisible();
  await expect
    .poll(async () => (await settings(worker)).pausedSites)
    .toContain('nexus-test.example');
  await popup.getByRole('button', { name: 'Vazgeç ve geri al' }).click();
  await expect.poll(async () => (await settings(worker)).pausedSites).toEqual([]);
  expect((await settings(worker)).siteProfiles['nexus-test.example']).toMatchObject({
    privacy: true,
    video: true,
    network: false,
  });
  server.close();
});

test('the interface follows an English browser', async ({ browserKind }) => {
  const brave = await launchBrave([EXTENSION_DIR], [], 'en', browserKind);
  try {
    const { context } = brave;
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${id}/dashboard.html#privacy`);
    await expect(dash.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
    await expect(dash.getByRole('switch', { name: 'Block third-party cookies' })).toBeVisible();
    expect(await dash.evaluate(() => document.documentElement.lang)).toBe('en');
    await expect(dash).toHaveTitle('AX Privacy — Dashboard');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.getByText('Browser System Page')).toBeVisible();
    await expect(popup.getByRole('switch', { name: 'Ad & Tracker Blocking' })).toBeChecked();
  } finally {
    await brave.close();
  }
});
