import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BASE_SCRIPTS, expect, startServer, test } from './fixtures.ts';

const hits: string[] = [];
let port = 0;
const host = (name: string) => `http://${name}:${port}`;
const SITE = 'site.nexus-test.example';
const OTHER = 'shop.nexus-other.example';

/** Mimics the "123inkt" banner, one of autoconsent's generic (any-site) rules. */
const BANNER = `<div class="c-simple-popup"><div class="c-cookie-popup">Çerezler?
<button data-role="accept-cookies" onclick="window.__consent='accept';this.closest('.c-simple-popup').remove()">Kabul</button>
<button data-role="refuse-cookies" onclick="window.__consent='refuse';this.closest('.c-simple-popup').remove()">Reddet</button>
</div></div>`;

function handle(req: IncomingMessage, res: ServerResponse) {
  const hostname = (req.headers.host ?? '').split(':')[0] ?? '';
  hits.push(`${hostname}${req.url ?? ''}`);
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/consent') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>consent</title><p>İçerik</p>${BANNER}`);
  } else if (path === '/data') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  } else if (path?.endsWith('.js')) {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end('');
  } else {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>privacy</title><p>sayfa</p>');
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

async function dashboard(context: BrowserContext, extensionId: string) {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#privacy`);
  await expect(dash.getByRole('heading', { name: 'Gizlilik' })).toBeVisible();
  return dash;
}

const scriptIds = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort(),
  );

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

test('tracking parameters are stripped from pages and requests without redirect loops', async ({
  context,
  worker,
}) => {
  await expect.poll(() => scriptIds(worker)).toEqual(BASE_SCRIPTS);
  const page = await context.newPage();
  await page.goto(`${host(SITE)}/landing?fbclid=abc&keep=1`);
  expect(page.url()).toBe(`${host(SITE)}/landing?keep=1`);
  expect(hits).toEqual([`${SITE}/landing?keep=1`]);

  // `fbclid=` also matches `xfbclid=`; removing nothing must not redirect again.
  await page.goto(`${host(SITE)}/landing?xfbclid=1`);
  expect(page.url()).toBe(`${host(SITE)}/landing?xfbclid=1`);

  await page.evaluate(() => fetch('/data?gclid=1&q=2'));
  expect(hits).toContain(`${SITE}/data?q=2`);
  expect(hits.some((h) => h.includes('gclid'))).toBe(false);
});

test('third-party cookie stripping is opt-in and spares first-party requests', async ({
  context,
  extensionId,
  worker,
}) => {
  const outcome = (url: string) =>
    worker.evaluate(
      async (u) =>
        (
          await chrome.declarativeNetRequest.testMatchOutcome({
            url: u,
            type: 'image' as chrome.declarativeNetRequest.ResourceType,
            initiator: 'http://site.nexus-test.example',
          })
        ).matchedRules
          .filter((r) => r.rulesetId === '_dynamic' && r.ruleId !== 7 && r.ruleId !== 8)
          .map((r) => r.ruleId),
      url,
    );
  expect(await outcome(`${host(OTHER)}/p.gif`)).toEqual([]);

  const dash = await dashboard(context, extensionId);
  const toggle = dash.getByRole('switch', { name: 'Üçüncü taraf çerezlerini engelle' });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => outcome(`${host(OTHER)}/p.gif`)).toEqual([3]);
  expect(await outcome(`${host('cdn.nexus-test.example')}/p.gif`)).toEqual([]);

  await toggle.click();
  await expect.poll(() => outcome(`${host(OTHER)}/p.gif`)).toEqual([]);
});

test('cookie auto-reject clicks "reject" on a recognised banner and reports it', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  const toggle = dash.getByRole('switch', { name: 'Çerez bildirimlerini otomatik reddet' });

  const before = await context.newPage();
  await before.goto(`${host(SITE)}/consent`);
  await before.waitForTimeout(1500);
  await expect(before.locator('.c-cookie-popup')).toBeVisible();
  await before.close();

  await toggle.click();
  await expect.poll(() => scriptIds(worker)).toEqual(['consent', ...BASE_SCRIPTS]);
  const page = await context.newPage();
  await page.goto(`${host(SITE)}/consent`);
  await expect
    .poll(() => page.evaluate(() => (window as { __consent?: string }).__consent))
    .toBe('refuse');
  await expect(page.locator('.c-cookie-popup')).toHaveCount(0);

  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id ?? -1,
    `${host(SITE)}/consent`,
  );
  await expect
    .poll(async () => (await reportFor(dash, tabId)).consent)
    .toEqual({ cmp: '123inkt', result: true });
});

const reportFor = (dash: Page, tabId: number) =>
  dash.evaluate(async (id) => {
    const r = (await chrome.runtime.sendMessage({ type: 'tab/report', tabId: id })) as {
      data: {
        consent: unknown;
        hosts: { host: string; thirdParty: boolean; loaded: number; blocked: number }[];
      };
    };
    return r.data;
  }, tabId);

test('the page report lists first- and third-party hosts and what was blocked', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  await dash.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'privacy/set', privacy: { detailedReports: true } }),
  );
  const page = await context.newPage();
  await page.goto(`${host(SITE)}/`);
  expect(await loadScript(page, `http://www.googletagmanager.com:${port}/gtm.js?id=GTM-X`)).toBe(
    'error',
  );
  expect(await loadScript(page, `${host('cdn.nexus-other.example')}/lib.js`)).toBe('load');
  expect(await loadScript(page, `${host('static.nexus-test.example')}/app.js`)).toBe('load');
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id ?? -1,
    `${host(SITE)}/`,
  );
  // The page's own host may show up too: the browser fetches /favicon.ico for the tab.
  await expect
    .poll(async () => (await reportFor(dash, tabId)).hosts.filter((h) => h.host !== SITE))
    .toEqual([
      { host: 'www.googletagmanager.com', thirdParty: true, loaded: 0, blocked: 1 },
      { host: 'cdn.nexus-other.example', thirdParty: true, loaded: 1, blocked: 0 },
      { host: 'static.nexus-test.example', thirdParty: false, loaded: 1, blocked: 0 },
    ]);

  await page.goto(`${host(SITE)}/landing`);
  await expect.poll(async () => (await reportFor(dash, tabId)).hosts).toEqual([]);
});

const canvasHash = (page: Page) =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 40;
    const x = c.getContext('2d');
    if (!x) return 'no-2d';
    x.fillStyle = '#f60';
    x.fillRect(0, 0, 220, 40);
    x.fillStyle = '#069';
    x.font = '16px Arial';
    x.fillText('AX parmak izi', 4, 26);
    const pixels = x.getImageData(0, 0, 220, 40).data.reduce((a, b) => (a * 31 + b) >>> 0, 7);
    return `${c.toDataURL().length}:${c.toDataURL().slice(-40)}:${pixels}`;
  });

const blankFrameHash = (page: Page) =>
  page.evaluate(() => {
    const f = document.createElement('iframe');
    document.body.append(f);
    const w = f.contentWindow as (Window & typeof globalThis) | null;
    if (!w) return 'no-frame';
    const c = w.document.createElement('canvas');
    c.width = 50;
    c.height = 20;
    const x = c.getContext('2d');
    if (!x) return 'no-2d';
    x.fillStyle = '#123456';
    x.fillRect(0, 0, 50, 20);
    return c.toDataURL();
  });

const audioSum = (page: Page) =>
  page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    osc.connect(ctx.destination);
    osc.start(0);
    const buf = await ctx.startRendering();
    return buf.getChannelData(0).reduce((a, b) => a + Math.abs(b), 0);
  });

test('fingerprint noise is stable per site, differs across sites, and is off by default', async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await context.newPage();
  const visit = async (h: string) => {
    await page.goto(`${host(h)}/`);
    return { canvas: await canvasHash(page), audio: await audioSum(page) };
  };
  const plainA = await visit(SITE);
  const plainB = await visit(OTHER);
  expect(plainA).toEqual(plainB);

  const dash = await dashboard(context, extensionId);
  await dash.getByLabel('Parmak izi koruması').selectOption('standard');
  await expect.poll(() => scriptIds(worker)).toEqual([...BASE_SCRIPTS, 'fp-noise'].sort());

  const a1 = await visit(SITE);
  const a2 = await visit(SITE);
  const b = await visit(OTHER);
  expect(a1.canvas).not.toBe(plainA.canvas);
  expect(a1.audio).not.toBe(plainA.audio);
  expect(Math.abs(a1.audio - plainA.audio) / plainA.audio).toBeLessThan(1e-5);
  expect(a2).toEqual(a1);
  expect(b.canvas).not.toBe(a1.canvas);
  expect(b.audio).not.toBe(a1.audio);
  // A fresh about:blank frame inherits the protection instead of offering clean prototypes.
  await page.goto(`${host(SITE)}/`);
  const framed = await blankFrameHash(page);
  await dash.getByLabel('Parmak izi koruması').selectOption('off');
  await expect.poll(() => scriptIds(worker)).toEqual(BASE_SCRIPTS);
  await page.goto(`${host(SITE)}/`);
  expect(await blankFrameHash(page)).not.toBe(framed);
});

test('strict fingerprint level caps CPU cores and hides the GPU model', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  await dash.getByLabel('Parmak izi koruması').selectOption('strict');
  await expect
    .poll(() => scriptIds(worker))
    .toEqual([...BASE_SCRIPTS, 'fp-noise', 'fp-strict'].sort());
  const page = await context.newPage();
  await page.goto(`${host(SITE)}/`);
  const probe = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      cores: navigator.hardwareConcurrency,
      gpu: gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      generic: gl ? gl.getParameter(gl.RENDERER) : null,
    };
  });
  expect(probe.cores).toBeLessThanOrEqual(4);
  expect(probe.gpu).toBe(probe.generic);
});
