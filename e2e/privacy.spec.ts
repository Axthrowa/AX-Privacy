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
  } else if (path === '/lang') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(String(req.headers['accept-language'] ?? ''));
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

  // The standard campaign tags are not in the list; a control rule drops them from pages.
  await page.goto(`${host(SITE)}/landing?utm_source=x&utm_medium=y&keep=2`);
  expect(page.url()).toBe(`${host(SITE)}/landing?keep=2`);
  await page.goto(`${host(SITE)}/landing?utm_other=1`);
  expect(page.url()).toBe(`${host(SITE)}/landing?utm_other=1`);

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
          // GPC, CDN cookies and Client Hints match any third-party request; only rule 3 matters here.
          .filter((r) => r.rulesetId === '_dynamic' && ![7, 8, 15].includes(r.ruleId))
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
  // On by default: switched off first to see the banner untouched.
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect.poll(() => scriptIds(worker)).toEqual(BASE_SCRIPTS.filter((id) => id !== 'consent'));

  const before = await context.newPage();
  await before.goto(`${host(SITE)}/consent`);
  await before.waitForTimeout(1500);
  await expect(before.locator('.c-cookie-popup')).toBeVisible();
  await before.close();

  await toggle.click();
  await expect.poll(() => scriptIds(worker)).toEqual(BASE_SCRIPTS);
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

/** Runs `body` in a Worker made from a blob, the way fingerprinting scripts do. */
const inWorker = (page: Page, body: string) =>
  page.evaluate(
    (src) =>
      new Promise<unknown>((done, fail) => {
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = (e) => {
          done(e.data);
          w.terminate();
        };
        w.onerror = (e) => fail(new Error(e.message));
      }),
    body,
  );

const WORKER_CANVAS = `
  const c = new OffscreenCanvas(220, 40);
  const x = c.getContext('2d');
  x.fillStyle = '#f60';
  x.fillRect(0, 0, 220, 40);
  x.fillStyle = '#069';
  x.font = '16px Arial';
  x.fillText('AX parmak izi', 4, 26);
  const pixels = x.getImageData(0, 0, 220, 40).data.reduce((a, b) => (a * 31 + b) >>> 0, 7);
  c.convertToBlob().then(async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    postMessage(pixels + ':' + bytes.reduce((a, b) => (a * 31 + b) >>> 0, 7));
  });`;

test('fingerprint noise is stable per site, differs across sites, and is on by default', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  const noFp = BASE_SCRIPTS.filter((id) => id !== 'fp-noise');
  await dash.getByLabel('Parmak izi koruması').selectOption('off');
  await expect.poll(() => scriptIds(worker)).toEqual(noFp);
  const page = await context.newPage();
  const visit = async (h: string) => {
    await page.goto(`${host(h)}/`);
    return {
      canvas: await canvasHash(page),
      audio: await audioSum(page),
      worker: await inWorker(page, WORKER_CANVAS),
    };
  };
  const plainA = await visit(SITE);
  const plainB = await visit(OTHER);
  expect(plainA).toEqual(plainB);

  await dash.getByLabel('Parmak izi koruması').selectOption('standard');
  await expect.poll(() => scriptIds(worker)).toEqual(BASE_SCRIPTS);

  const a1 = await visit(SITE);
  const a2 = await visit(SITE);
  const b = await visit(OTHER);
  expect(a1.canvas).not.toBe(plainA.canvas);
  expect(a1.audio).not.toBe(plainA.audio);
  // Inline workers get the same noise: content scripts never run there.
  expect(a1.worker).not.toBe(plainA.worker);
  expect(Math.abs(a1.audio - plainA.audio) / plainA.audio).toBeLessThan(1e-5);
  expect(a2).toEqual(a1);
  expect(b.canvas).not.toBe(a1.canvas);
  expect(b.audio).not.toBe(a1.audio);
  expect(await page.evaluate(() => '__axSeed' in self)).toBe(false);

  // A browser restart empties session storage; the next session draws a new seed.
  await worker.evaluate(() => chrome.storage.session.clear());
  await dash.getByLabel('Parmak izi koruması').selectOption('off');
  await expect.poll(() => scriptIds(worker)).toEqual(noFp);
  await dash.getByLabel('Parmak izi koruması').selectOption('standard');
  await expect.poll(() => scriptIds(worker)).toEqual(BASE_SCRIPTS);
  const nextSession = await visit(SITE);
  expect(nextSession.canvas).not.toBe(a1.canvas);
  expect(nextSession.audio).not.toBe(a1.audio);
  // A fresh about:blank frame inherits the protection instead of offering clean prototypes.
  await page.goto(`${host(SITE)}/`);
  const framed = await blankFrameHash(page);
  await dash.getByLabel('Parmak izi koruması').selectOption('off');
  await expect.poll(() => scriptIds(worker)).toEqual(noFp);
  await page.goto(`${host(SITE)}/`);
  expect(await blankFrameHash(page)).not.toBe(framed);
});

test('strict fingerprint level caps CPU cores, hides the GPU model and probe fonts, in workers too', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  await dash.getByLabel('Parmak izi koruması').selectOption('strict');
  await expect.poll(() => scriptIds(worker)).toEqual([...BASE_SCRIPTS, 'fp-strict'].sort());
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
  const [workerCores, workerMemory] = (await inWorker(
    page,
    'postMessage([navigator.hardwareConcurrency, navigator.deviceMemory ?? 8])',
  )) as [number, number];
  expect(workerCores).toBeLessThanOrEqual(4);
  expect(workerMemory).toBe(8);
  // An installed probe font (Marlett ships with Windows) and a missing one measure alike.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const width = (family: string) => {
      const s = document.createElement('span');
      s.style.cssText = `font: 72px ${family}; position: absolute`;
      s.textContent = 'mmmmmmmmmmlli';
      document.body.append(s);
      const w = s.offsetWidth;
      s.remove();
      return w;
    };
    return {
      installed: width("'Marlett', monospace"),
      missing: width("'ZWAdobeF', monospace"),
      localFonts: 'queryLocalFonts' in window,
    };
  });
  expect(fonts.installed).toBe(fonts.missing);
  expect(fonts.localFonts).toBe(false);
});

test('WebRTC keeps local addresses private by default; language and time zone hide on request', async ({
  context,
  extensionId,
  worker,
}) => {
  await expect
    .poll(() =>
      worker.evaluate(
        async () => (await chrome.privacy.network.webRTCIPHandlingPolicy.get({})).value,
      ),
    )
    .toBe('default_public_interface_only');
  const page = await context.newPage();
  const seen = async () => {
    await page.goto(`${host(SITE)}/`);
    return page.evaluate(() => ({
      language: navigator.language,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: new Date().getTimezoneOffset(),
    }));
  };
  const dash = await dashboard(context, extensionId);
  const toggle = dash.getByRole('switch', { name: 'Dil ve saat dilimini gizle' });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => scriptIds(worker)).toEqual([...BASE_SCRIPTS, 'locale'].sort());
  const after = await seen();
  expect(after).toEqual({ language: 'en-US', zone: 'UTC', offset: 0 });
  await page.goto(`${host(SITE)}/lang`);
  expect(await page.textContent('body')).toBe('en-US,en;q=0.9');

  await toggle.click();
  await expect.poll(() => scriptIds(worker)).toEqual(BASE_SCRIPTS);
});

test('Client Hints and the browser ad APIs are limited by default, profiles switch them', async ({
  context,
  extensionId,
  worker,
}) => {
  const hintRule = (initiator: string) =>
    worker.evaluate(
      async (i) =>
        (
          await chrome.declarativeNetRequest.testMatchOutcome({
            url: 'http://cdn.nexus-other.example/a.js',
            type: 'script' as chrome.declarativeNetRequest.ResourceType,
            initiator: i,
          })
        ).matchedRules.some((r) => r.ruleId === 15),
      initiator,
    );
  // Third parties lose the high-entropy hints; the site's own requests keep them.
  await expect.poll(() => hintRule(host(SITE))).toBe(true);
  expect(await hintRule('http://www.nexus-other.example')).toBe(false);

  const adApis = () =>
    worker.evaluate(async () => {
      const w = chrome.privacy.websites as unknown as Record<
        string,
        chrome.types.ChromeSetting<boolean> | undefined
      >;
      const read = async (k: string) => (await w[k]?.get({}))?.value;
      return {
        topics: await read('topicsEnabled'),
        fledge: await read('fledgeEnabled'),
        measurement: await read('adMeasurementEnabled'),
        pings: await read('hyperlinkAuditingEnabled'),
      };
    });
  const off = await adApis();
  // A browser without one of the APIs reports undefined; whatever exists is switched off.
  for (const v of Object.values(off)) expect(v === false || v === undefined).toBe(true);
  expect(off.pings).toBe(false);

  const dash = await dashboard(context, extensionId);
  await expect(dash.getByText('Şu an: Dengeli')).toBeVisible();
  await dash.getByRole('switch', { name: /Client Hints/ }).click();
  await expect(dash.getByText('Şu an: Özel')).toBeVisible();
  await expect.poll(() => hintRule(host(SITE))).toBe(false);
  // Switching it off hands the APIs back to the browser (its own default); link pings stay off.
  await dash.getByRole('switch', { name: /reklam API/ }).click();
  await expect(dash.getByRole('switch', { name: /reklam API/ })).not.toBeChecked();
  expect((await adApis()).pings).toBe(false);

  await dash.getByRole('button', { name: 'Dengeli' }).click();
  await expect(dash.getByText('Şu an: Dengeli')).toBeVisible();
  await expect.poll(() => hintRule(host(SITE))).toBe(true);
  await expect.poll(async () => (await adApis()).topics !== true).toBe(true);
});

test('click-to-load holds embeds back until a click, for that tab only', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  const toggle = dash.getByRole('switch', {
    name: 'Gömülü Facebook, X ve Disqus içeriğini tıklayınca yükle',
  });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('click-to-load');
  // A regex Chromium refuses would take every control rule down with it.
  expect(
    await worker.evaluate(async () =>
      (await chrome.declarativeNetRequest.getDynamicRules()).filter(
        (r) => r.id >= 16 && r.id <= 19,
      ),
    ),
  ).toHaveLength(4);
  const { origin, server } = await startServer(`<!doctype html><title>haber</title>
<blockquote class="twitter-tweet"><a href="https://x.com/a/status/1">tweet</a></blockquote>
<div class="fb-post" data-href="https://www.facebook.com/a/posts/1"></div>`);
  const outcome = (tabId: number) =>
    worker.evaluate(
      async ([id, initiator]) =>
        (
          await chrome.declarativeNetRequest.testMatchOutcome({
            url: 'https://platform.twitter.com/widgets.js',
            type: 'script' as chrome.declarativeNetRequest.ResourceType,
            initiator,
            tabId: id,
          })
        ).matchedRules.map((r) => `${r.rulesetId}#${r.ruleId}`),
      [tabId, origin] as const,
    );
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    // One notice for the page, naming every provider it held back.
    const load = page.getByRole('button', { name: 'İçerikleri yükle' });
    await expect(load).toHaveCount(1);
    await expect(load).toBeVisible();
    await expect(page.getByRole('region', { name: 'AX Privacy' })).toContainText(
      '1 Facebook, 1 X (Twitter)',
    );
    const tabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({ url }))[0]?.id ?? -1,
      `${origin}/`,
    );
    // X's widget script is the third embed rule (16 + 2).
    expect(await outcome(tabId)).toEqual(['_dynamic#18']);

    await Promise.all([page.waitForEvent('load'), load.click()]);
    await expect(page.getByRole('button', { name: 'İçerikleri yükle' })).toHaveCount(0);
    expect(await outcome(tabId)).not.toContain('_dynamic#18');
    // Another tab still gets the notice.
    const other = await context.newPage();
    await other.goto(`${origin}/`);
    await expect(other.getByRole('button', { name: 'İçerikleri yükle' })).toBeVisible();

    await page.close();
    await expect
      .poll(() =>
        worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length),
      )
      .toBe(0);
  } finally {
    server.close();
  }
});

test('closing a tab clears sites without an open tab, keeping the keep list', async ({
  context,
  extensionId,
}) => {
  const dash = await dashboard(context, extensionId);
  await dash.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'privacy/set',
      privacy: { clearSiteData: true, keepSiteData: ['nexus-other.example'] },
    }),
  );
  const THIRD = 'www.nexus-third.example';
  const store = async (name: string) => {
    const p = await context.newPage();
    await p.goto(`${host(name)}/`);
    await p.evaluate(() => {
      localStorage.setItem('k', 'v');
      document.cookie = 'c=1; max-age=3600';
    });
    return p;
  };
  const read = async (name: string) => {
    const p = await context.newPage();
    await p.goto(`${host(name)}/`);
    const out = await p.evaluate(() => ({
      storage: localStorage.getItem('k'),
      cookie: document.cookie,
    }));
    await p.close();
    return out;
  };
  const KEPT = 'www.nexus-other.example';
  const closed = await store(SITE);
  const kept = await store(KEPT);
  const keptSub = await store(OTHER);
  const open = await store(THIRD);
  await closed.close();
  await kept.close();
  await keptSub.close();
  const EMPTY = { storage: null, cookie: '' };
  const FULL = { storage: 'v', cookie: 'c=1' };
  // Reading opens the site again, which keeps it; so wait out the clear first.
  await dash.waitForTimeout(3_000);
  expect(await read(SITE)).toEqual(EMPTY);
  // Cookies stay for the kept site's whole domain (logins). Its storage is kept by exact origin,
  // which the test server's random port never matches; keptOrigins' unit test covers that.
  expect((await read(KEPT)).cookie).toBe('c=1');
  expect((await read(OTHER)).cookie).toBe('c=1');
  expect(await open.evaluate(() => localStorage.getItem('k'))).toBe('v');

  // Off again: nothing more is cleared.
  await dash.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'privacy/set', privacy: { clearSiteData: false } }),
  );
  await (await store(SITE)).close();
  await dash.waitForTimeout(2_500);
  expect(await read(SITE)).toEqual(FULL);
});
