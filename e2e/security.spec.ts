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
      : req.url?.startsWith('/frame?')
        ? `<!doctype html><title>frame</title><iframe width="600" height="300" src="${decodeURIComponent(req.url.slice(7))}"></iframe>`
        : req.url?.startsWith('/opener')
          ? `<!doctype html><button id="open" onclick="window.open('${host(BAD)}/ad')">Ac</button><a id="link" href="${host(BAD)}/x">x</a>`
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

test('a tab the page opens to a blocked address is closed; one the user opens shows the warning', async ({
  context,
  extensionId,
}) => {
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await ui.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'rules/setCustom', text: '||bad.nexus-other.example^$doc' }),
  );
  const page = await context.newPage();
  await page.goto(`${host(SITE)}/opener`);
  const popup = context.waitForEvent('page');
  await page.click('#open');
  await (await popup).waitForEvent('close');

  const opened = context.waitForEvent('page');
  await page.click('#link', { modifiers: ['Control'] });
  const tab = await opened;
  await expect(tab).toHaveURL(/\/blocked\.html\?/);
  expect(hits.filter((h) => h.startsWith(BAD))).toEqual([]);
});

test('sign-in on a fake government address is stopped until the user lifts it', async ({
  context,
  worker,
}) => {
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('cosmetic');
  const fake = `${host('turkiye-gov-tr.nexus-test.example')}/login`;
  const page = await context.newPage();
  await page.goto(fake);
  const field = page.locator('input[type="password"]');
  await expect(page.locator('ax-login-guard')).toBeAttached();
  await expect(field).toHaveJSProperty('readOnly', true);
  await field.click({ force: true });
  await page.keyboard.type('secret');
  await expect(field).toHaveValue('');
  // The form does not send while the lock is on.
  await page.evaluate(() => document.querySelector('form')?.requestSubmit());
  await page.waitForTimeout(300);
  expect(hits.filter((h) => h.includes('/login?'))).toEqual([]);

  // A page script cannot lift the lock; a real click can, for the rest of the session.
  const anyway = page.getByRole('button', { name: /yine de giriş yap/ });
  await anyway.evaluate((b: HTMLButtonElement) => b.click());
  await expect(field).toHaveJSProperty('readOnly', true);
  await anyway.click();
  await expect(page.locator('ax-login-guard')).toHaveCount(0);
  await expect(field).toHaveJSProperty('readOnly', false);
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.locator('ax-login-guard')).toHaveCount(0);

  // An ordinary site with a sign-in form is left alone.
  await page.goto(`${host(SITE)}/login`);
  await page.waitForTimeout(500);
  await expect(page.locator('ax-login-guard')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveJSProperty('readOnly', false);
});

test('a sign-in form in an iframe is locked when the frame or the page around it is fake', async ({
  context,
  worker,
}) => {
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('cosmetic');
  const page = await context.newPage();
  const framed = async (top: string, inner: string) => {
    await page.goto(`${host(top)}/frame?${encodeURIComponent(`${host(inner)}/login`)}`);
    return page.frameLocator('iframe');
  };

  // A real-looking page embedding a fake government sign-in form.
  let frame = await framed(SITE, 'edevlet-giris.nexus-other.example');
  await expect(frame.locator('ax-login-guard')).toBeAttached();
  await expect(frame.locator('input[type="password"]')).toHaveJSProperty('readOnly', true);

  // A fake government page embedding an ordinary-looking form.
  frame = await framed('turkiye-gov-tr.nexus-test.example', 'form.nexus-third.example');
  await expect(frame.locator('ax-login-guard')).toBeAttached();
  await expect(frame.locator('input[type="password"]')).toHaveJSProperty('readOnly', true);

  // Neither fake: left alone.
  frame = await framed(SITE, 'form.nexus-third.example');
  await page.waitForTimeout(500);
  await expect(frame.locator('ax-login-guard')).toHaveCount(0);
  await expect(frame.locator('input[type="password"]')).toHaveJSProperty('readOnly', false);
});

test('the sign-in lock works with the cosmetic shield off', async ({
  context,
  extensionId,
  worker,
}) => {
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await ui.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'shields/set', shields: { cosmetic: false } }),
  );
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .not.toContain('cosmetic');
  const page = await context.newPage();
  await page.goto(`${host('turkiye-gov-tr.nexus-test.example')}/login`);
  await expect(page.locator('ax-login-guard')).toBeAttached();
  await expect(page.locator('input[type="password"]')).toHaveJSProperty('readOnly', true);
});
