import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BASE_SCRIPTS, expect, startServer, test } from './fixtures.ts';

/**
 * One local server plays every host (see TEST_HOSTS); `hits` records which host/path pairs the
 * browser actually requested, so "blocked" means the request never left the browser.
 */
const hits: string[] = [];
let port = 0;
const host = (name: string) => `http://${name}:${port}`;

const PAGE = () => `<!doctype html><title>adblock</title>
<div class="adsbygoogle-box">EASYLIST</div>
<div class="nexus-generic-ad">CUSTOM</div>
<div class="card">Sponsorlu içerik</div><div class="card">Haber</div>
<div class="user-list-ad">USERLIST</div>
<div class="keep">KEEP</div>
<a id="pop" href="${host('popup.nexus-test.example')}/landing" target="_blank">pop</a>
<a id="fine" href="${host('fine.nexus-test.example')}/page" target="_blank">fine</a>`;

const USER_LIST = `! Title: AX e2e list
||userlist.nexus-test.example^
##.user-list-ad`;

function handle(req: IncomingMessage, res: ServerResponse) {
  const hostname = (req.headers.host ?? '').split(':')[0] ?? '';
  hits.push(`${hostname}${req.url ?? ''}`);
  if (req.url === '/list.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(USER_LIST);
  } else if (req.url === '/' || req.url === '/page' || req.url === '/landing') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE());
  } else {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end('window.__loaded = (window.__loaded || 0) + 1;');
  }
}

let server: Awaited<ReturnType<typeof startServer>>['server'];
test.beforeAll(async () => {
  ({ server, port } = await startServer(handle));
});
test.afterAll(() => server.close());
test.beforeEach(() => {
  hits.length = 0;
});

/** Loads `url` as a script from the page; resolves to 'load' or 'error'. */
const loadScript = (page: Page, url: string) =>
  page.evaluate(
    (src) =>
      new Promise<string>((done) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => done('load');
        s.onerror = () => done('error');
        document.head.append(s);
      }),
    url,
  );

const hit = (prefix: string) => hits.some((h) => h.startsWith(prefix));

async function dashboard(context: BrowserContext, extensionId: string) {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#lists`);
  await expect(dash.getByRole('heading', { name: 'Filtre listeleri' })).toBeVisible();
  return dash;
}

async function saveCustom(dash: Page, text: string) {
  await dash.goto(`${dash.url().replace(/#.*$/, '')}#advanced`);
  await dash.getByLabel('Özel kurallar').fill(text);
  await dash.getByRole('button', { name: 'Kaydet' }).click();
}

/** Waits until onInstalled has registered the content script, then opens the test site. */
const openPage = async (context: BrowserContext, worker: Worker) => {
  await expect
    .poll(() =>
      worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length),
    )
    .toBe(BASE_SCRIPTS.length);
  const page = await context.newPage();
  await page.goto(`${host('site.nexus-test.example')}/`);
  return page;
};

test('a click does not open a third-party ad tab, and the link under the cursor still can', async ({
  context,
  worker,
}) => {
  const page = await openPage(context, worker);
  const ad = `${host('ads.nexus-other.example')}/ad`;
  await page.evaluate((url) => {
    document.addEventListener('click', () => window.open(url));
  }, ad);
  const before = context.pages().length;
  await page.click('.keep');
  await page.waitForTimeout(600);
  expect(context.pages().filter((p) => !p.isClosed())).toHaveLength(before);

  await page.evaluate((url) => {
    document.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      document.body.append(frame);
      frame.contentWindow?.open(url, '_blank');
    });
  }, ad);
  await page.click('.keep');
  await page.waitForTimeout(600);
  expect(context.pages().filter((p) => !p.isClosed())).toHaveLength(before);

  await page.evaluate(
    (url) => {
      const a = document.createElement('a');
      a.href = url;
      a.id = 'real-out';
      a.textContent = 'out';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(a.href);
      });
      document.body.append(a);
    },
    `${host('fine.nexus-other.example')}/page`,
  );
  const opened = context.waitForEvent('page');
  await page.click('#real-out');
  const fine = await opened;
  await fine.waitForLoadState();
  expect(new URL(fine.url()).hostname).toBe('fine.nexus-other.example');
  await fine.close();

  await page.evaluate((url) => {
    const a = document.createElement('a');
    a.href = url;
    a.id = 'cover';
    a.style.cssText = 'position:fixed;inset:0;z-index:999999';
    document.body.append(a);
  }, ad);
  await page.mouse.click(20, 20);
  await page.waitForTimeout(600);
  expect(context.pages().filter((p) => !p.isClosed())).toHaveLength(before);
});

test('built-in rulesets are enabled and block a real tracker URL', async ({ context, worker }) => {
  expect(
    (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).sort(),
  ).toEqual([
    'adguard-tr',
    'adguard-urltracking',
    'brave-unbreak',
    'easylist',
    'easyprivacy',
    'pgl',
    'ublock',
    'ublock-badware',
    'ublock-privacy',
    'ublock-quick-fixes',
    'ublock-unbreak',
    'urlhaus',
  ]);
  const page = await openPage(context, worker);
  expect(await loadScript(page, `http://www.googletagmanager.com:${port}/gtm.js?id=GTM-X`)).toBe(
    'error',
  );
  expect(await loadScript(page, `${host('cdn.nexus-test.example')}/app.js`)).toBe('load');
  expect(hit('www.googletagmanager.com')).toBe(false);
  expect(hit('cdn.nexus-test.example/app.js')).toBe(true);
});

test('turning a list off in the dashboard lets its requests through', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  const easyprivacy = dash.getByRole('switch', { name: /EasyPrivacy/ });
  const easylist = dash.getByRole('switch', { name: 'EasyList (Reklam)' });
  const ublock = dash.getByRole('switch', { name: /uBlock filters/ });
  const ublockPrivacy = dash.getByRole('switch', { name: /uBlock Privacy/ });
  const pgl = dash.getByRole('switch', { name: /Peter Lowe/ });
  for (const s of [easyprivacy, easylist, ublock, ublockPrivacy, pgl]) {
    await s.click();
    await expect(s).not.toBeChecked();
  }
  await expect
    .poll(async () =>
      (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).sort(),
    )
    .toEqual([
      'adguard-tr',
      'adguard-urltracking',
      'brave-unbreak',
      'ublock-badware',
      'ublock-quick-fixes',
      'ublock-unbreak',
      'urlhaus',
    ]);
  const page = await openPage(context, worker);
  expect(await loadScript(page, `http://www.googletagmanager.com:${port}/gtm.js?id=GTM-X`)).toBe(
    'load',
  );
  await expect(page.locator('.adsbygoogle-box')).toBeVisible();

  await easyprivacy.click();
  await expect(easyprivacy).toBeChecked();
  await page.reload();
  expect(await loadScript(page, `http://www.googletagmanager.com:${port}/gtm.js?id=GTM-Y`)).toBe(
    'error',
  );
});

test('EasyList element hiding applies generic rules found in the page', async ({
  context,
  worker,
}) => {
  const page = await openPage(context, worker);
  await expect(page.locator('.adsbygoogle-box')).toBeHidden();
  await expect(page.locator('.keep')).toBeVisible();
});

test('custom network, $redirect, generic and procedural rules all take effect', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  await saveCustom(
    dash,
    [
      '||blocked.nexus-test.example^',
      '||redir.nexus-test.example^$script,redirect=noopjs',
      '##.nexus-generic-ad',
      'site.nexus-test.example##.card:has-text(Sponsorlu)',
      'site.nexus-test.example##+js(set-constant, x, 1)',
    ].join('\n'),
  );
  await expect(dash.getByText('2 ağ kuralı, 2 gizleme kuralı etkin')).toBeVisible();
  await expect(dash.locator('.rejected')).toContainText('yalnızca gömülü listelerden');

  const page = await openPage(context, worker);
  expect(await loadScript(page, `${host('blocked.nexus-test.example')}/a.js`)).toBe('error');
  // The surrogate loads in place of the real script, so pages depending on it keep running.
  expect(await loadScript(page, `${host('redir.nexus-test.example')}/x.js`)).toBe('load');
  expect(hit('blocked.nexus-test.example')).toBe(false);
  expect(hit('redir.nexus-test.example')).toBe(false);
  await expect(page.locator('.nexus-generic-ad')).toBeHidden();
  await expect(page.locator('.card', { hasText: 'Sponsorlu' })).toBeHidden();
  await expect(page.locator('.card', { hasText: 'Haber' })).toBeVisible();
});

test('a subscribed list blocks and hides until it is removed', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  const listUrl = `http://127.0.0.1:${port}/list.txt`;
  await dash.getByLabel('Liste adresi').fill(listUrl);
  await dash.getByRole('button', { name: 'Ekle' }).click();
  await expect(dash.getByRole('switch', { name: listUrl })).toBeChecked();
  await expect(dash.getByText('1/1 ağ filtresi dönüştürüldü')).toBeVisible();

  const page = await openPage(context, worker);
  expect(await loadScript(page, `${host('userlist.nexus-test.example')}/t.js`)).toBe('error');
  await expect(page.locator('.user-list-ad')).toBeHidden();

  await dash.getByRole('button', { name: 'Kaldır' }).click();
  await expect(dash.getByText('Eklenmiş liste yok.')).toBeVisible();
  await page.reload();
  expect(await loadScript(page, `${host('userlist.nexus-test.example')}/t.js`)).toBe('load');
  await expect(page.locator('.user-list-ad')).toBeVisible();
});

test('popup guard closes tabs matching $popup and leaves others open', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  await saveCustom(dash, '||popup.nexus-test.example^$popup');
  await expect(dash.getByText('1 ağ kuralı, 0 gizleme kuralı etkin')).toBeVisible();
  const page = await openPage(context, worker);

  const blocked = context.waitForEvent('page');
  await page.click('#pop');
  const popup = await blocked;
  await popup.waitForEvent('close', { timeout: 10_000 });

  const allowed = context.waitForEvent('page');
  await page.click('#fine');
  const fine = await allowed;
  await fine.waitForLoadState();
  await page.waitForTimeout(1000);
  expect(fine.isClosed()).toBe(false);
  expect(new URL(fine.url()).hostname).toBe('fine.nexus-test.example');

  for (const open of [
    () => page.click('#pop', { modifiers: ['ControlOrMeta'] }),
    () => page.click('#pop', { button: 'middle' }),
  ]) {
    const opened = context.waitForEvent('page');
    await open();
    const tab = await opened;
    await tab.waitForLoadState();
    await page.waitForTimeout(1500);
    expect(tab.isClosed()).toBe(false);
    await tab.close();
  }
});

test('the global switch lifts blocking from the built-in lists', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  await dash.evaluate(() => chrome.runtime.sendMessage({ type: 'global/set', enabled: false }));
  const page = await context.newPage();
  await page.goto(`${host('site.nexus-test.example')}/`);
  expect(await loadScript(page, `http://www.googletagmanager.com:${port}/gtm.js?id=GTM-X`)).toBe(
    'load',
  );
  await dash.evaluate(() => chrome.runtime.sendMessage({ type: 'global/set', enabled: true }));
  const again = await openPage(context, worker);
  expect(await loadScript(again, `http://www.googletagmanager.com:${port}/gtm.js?id=GTM-Y`)).toBe(
    'error',
  );
});

test('pausing a site lifts network blocking there', async ({ context, extensionId, worker }) => {
  const dash = await dashboard(context, extensionId);
  await saveCustom(dash, '||blocked.nexus-test.example^');
  await expect(dash.getByText('1 ağ kuralı')).toBeVisible();
  await dash.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'site/setPaused',
      site: 'nexus-test.example',
      paused: true,
    }),
  );
  const page = await openPage(context, worker);
  expect(await loadScript(page, `${host('blocked.nexus-test.example')}/a.js`)).toBe('load');
  await expect(page.locator('.adsbygoogle-box')).toBeVisible();
});
