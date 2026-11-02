import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { expect, startServer, test } from './fixtures.ts';

// Only simulated hosts: every name below resolves to the local test server.
const hits: string[] = [];
let port = 0;
const host = (name: string) => `http://${name}:${port}`;
const SITE = 'site.nexus-test.example';
const BAD = 'bad.nexus-other.example';

function handle(req: IncomingMessage, res: ServerResponse) {
  hits.push(`${(req.headers.host ?? '').split(':')[0]}${req.url ?? ''}`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    req.url?.startsWith('/login')
      ? '<!doctype html><title>login</title><form><input type="password"></form>'
      : '<!doctype html><title>page</title><p>sayfa</p>',
  );
}

let server: Awaited<ReturnType<typeof startServer>>['server'];
test.beforeAll(async () => {
  ({ server, port } = await startServer(handle));
});
test.afterAll(() => server.close());
test.beforeEach(() => {
  hits.length = 0;
});

const report = (ui: Page, url: string) =>
  ui.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    const r = (await chrome.runtime.sendMessage({ type: 'tab/report', tabId: tab?.id })) as {
      data: { risk: { level: string; findings: { id: string }[] } };
    };
    return { level: r.data.risk.level, ids: r.data.risk.findings.map((f) => f.id) };
  }, url);

test('a blocked page shows the warning, can go back, and can be opened anyway', async ({
  context,
  extensionId,
}) => {
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await ui.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'rules/setCustom', text: '||bad.nexus-other.example^$doc' }),
  );

  const page = await context.newPage();
  await page.goto(`${host(SITE)}/`);
  const open = () => page.evaluate((u) => (location.href = u), `${host(BAD)}/x`);
  await open();
  await expect(page).toHaveURL(/\/blocked\.html\?/);
  await expect(page.getByRole('heading', { name: 'Bu sayfa engellendi' })).toBeVisible();
  await expect(page.getByText('Özel kurallar')).toBeVisible();
  await expect(page.getByText(`${host(BAD)}/x`)).toBeVisible();
  expect(hits.filter((h) => h.startsWith(BAD))).toEqual([]);

  await page.getByRole('button', { name: 'Güvenli tarafa dön' }).click();
  await page.waitForURL(`${host(SITE)}/`);

  await open();
  await expect(page).toHaveURL(/\/blocked\.html\?/);
  await page.getByRole('button', { name: /yine de devam et/ }).click();
  await page.waitForURL(`${host(BAD)}/x`);
  expect(hits).toContain(`${BAD}/x`);
  await expect
    .poll(() => report(ui, `${host(BAD)}/x`))
    .toEqual({ level: 'high', ids: ['warning-bypassed'] });
});

test('the popup reports local warning signs without calling anything safe', async ({
  context,
  extensionId,
  worker,
}) => {
  // On a fresh install the scripts register just after the worker starts.
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('cosmetic');
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const page = await context.newPage();

  await page.goto(`${host('paypal-login.nexus-test.example')}/login`);
  await expect
    .poll(() => report(ui, `${host('paypal-login.nexus-test.example')}/login`))
    .toEqual({ level: 'medium', ids: ['brand-subdomain', 'insecure-password'] });

  await page.goto(`${host(SITE)}/`);
  await expect.poll(() => report(ui, `${host(SITE)}/`)).toEqual({ level: 'none', ids: [] });
});

test('the warning page does not offer to allow a non-web address, and renders the list as text', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const q = new URLSearchParams({ url: 'javascript:alert(1)', list: '<img src=x>' });
  await page.goto(`chrome-extension://${extensionId}/blocked.html?${q}`);
  await expect(page.getByRole('button', { name: /yine de devam et/ })).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.getByText('<img src=x>')).toBeVisible();
});

test('malware lists are active as page-blocking rules (checked, not visited)', async ({
  worker,
}) => {
  const doc = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../public/rulesets/urlhaus.doc.json'), 'utf8'),
  ) as { condition: { requestDomains: string[] } }[];
  const listed = doc[0]?.condition.requestDomains[0];
  expect(listed).toBeTruthy();
  const matched = await worker.evaluate(
    async (url) =>
      (
        await chrome.declarativeNetRequest.testMatchOutcome({
          url,
          type: 'main_frame' as chrome.declarativeNetRequest.ResourceType,
        })
      ).matchedRules.map((r) => r.rulesetId),
    `https://${listed}/`,
  );
  expect(matched).toContain('urlhaus');
});
