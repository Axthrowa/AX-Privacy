import type { BrowserContext, Worker } from '@playwright/test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { expect, startServer, test } from './fixtures.ts';

/**
 * Everyday flows on a local shop that loads the usual tag manager next to its own scripts: signing
 * in, searching, adding to the cart, loading comments and playing a video. AX blocks the tag
 * manager; every flow must still finish and the page must throw nothing.
 */
const SITE = 'shop.nexus-test.example';
let port = 0;
const url = (path: string) => `http://${SITE}:${port}${path}`;

const head = () => `<meta charset="utf-8">
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());</script>
<script async src="http://www.googletagmanager.com:${port}/gtag/js?id=G-TEST"></script>`;

const html = (title: string, body: string) =>
  `<!doctype html><html lang="tr"><head><title>${title}</title>${head()}</head><body>${body}</body></html>`;

const home = () =>
  html(
    'Mağaza',
    `<header class="site-header"><a href="/login">Giriş yap</a> <span id="cart-count">0</span></header>
<form action="/search" class="search-form"><input name="q" aria-label="Ara"><button>Ara</button></form>
<div class="product-card"><h2>Kulaklık</h2>
<button id="add" onclick="gtag('event','add_to_cart');fetch('/api/cart',{method:'POST'}).then(r=>r.json()).then(c=>{document.getElementById('cart-count').textContent=c.count})">Sepete ekle</button></div>
<section class="comments"><button id="show-comments" onclick="fetch('/api/comments').then(r=>r.json()).then(l=>{const ul=document.getElementById('comment-list');for(const c of l){const li=document.createElement('li');li.textContent=c;ul.append(li)}})">Yorumları göster</button><ul id="comment-list"></ul></section>
<div class="video-player"><video id="video" muted playsinline width="160" height="90"></video></div>`,
  );

let cart = 0;
function handle(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? '/').split('?')[0];
  const query = new URL(req.url ?? '/', 'http://x').searchParams;
  const send = (body: string, type = 'text/html; charset=utf-8', status = 200) => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  if (path === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const user = new URLSearchParams(body).get('user') ?? '';
      res.writeHead(303, { location: '/account', 'set-cookie': `session=${user}; Path=/` });
      res.end();
    });
  } else if (path === '/login') {
    send(
      html(
        'Giriş',
        `<form method="post" action="/login" class="login-form"><input name="user" aria-label="Kullanıcı"><input name="pass" type="password" aria-label="Şifre"><button>Giriş</button></form>`,
      ),
    );
  } else if (path === '/account') {
    const user = /session=(\w+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
    send(html('Hesabım', user ? `<h1>Hoş geldin ${user}</h1>` : '<h1>Giriş yapılmadı</h1>'));
  } else if (path === '/search') {
    send(
      html('Arama', `<h1>Sonuçlar: ${query.get('q') ?? ''}</h1><div class="results">3 ürün</div>`),
    );
  } else if (path === '/api/cart') {
    send(JSON.stringify({ count: ++cart }), 'application/json');
  } else if (path === '/api/comments') {
    send(JSON.stringify(['Çok iyi', 'Hızlı kargo']), 'application/json');
  } else if (path === '/gtag/js') {
    send('window.__tagManager = true;', 'application/javascript');
  } else {
    send(home());
  }
}

let server: Awaited<ReturnType<typeof startServer>>['server'];
test.beforeAll(async () => {
  ({ server, port } = await startServer(handle));
});
test.afterAll(() => server.close());

async function flows(context: BrowserContext, worker: Worker) {
  cart = 0;
  await expect
    .poll(() =>
      worker.evaluate(
        async () => (await chrome.storage.local.get('appliedVersion')).appliedVersion,
      ),
    )
    .toBeTruthy();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const blocked: string[] = [];
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT') blocked.push(r.url());
  });

  // Sign in: a form post, a redirect and a cookie.
  await page.goto(url('/login'));
  await page.getByLabel('Kullanıcı').fill('deneme');
  await page.getByLabel('Şifre').fill('test-sifre');
  await page.getByRole('button', { name: 'Giriş' }).click();
  await expect(page.getByRole('heading')).toHaveText('Hoş geldin deneme');

  // Search keeps its own query and drops only the campaign tag.
  await page.goto(url('/'));
  await page.getByLabel('Ara').fill('kulaklık');
  await page.getByRole('button', { name: 'Ara' }).click();
  await expect(page.getByRole('heading')).toHaveText('Sonuçlar: kulaklık');
  await page.goto(url('/search?q=mouse&utm_source=mail'));
  expect(page.url()).toBe(url('/search?q=mouse'));
  await expect(page.locator('.results')).toBeVisible();

  // Cart, comments and video on the home page.
  await page.goto(url('/'));
  await page.getByRole('button', { name: 'Sepete ekle' }).click();
  await expect(page.locator('#cart-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Yorumları göster' }).click();
  await expect(page.locator('#comment-list li')).toHaveText(['Çok iyi', 'Hızlı kargo']);
  const playing = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 16, height: 9 });
    const ctx = canvas.getContext('2d');
    const timer = setInterval(() => ctx?.fillRect(0, 0, Math.random() * 16, 9), 30);
    const video = document.getElementById('video') as HTMLVideoElement;
    video.srcObject = canvas.captureStream(30);
    await video.play();
    await new Promise((r) => setTimeout(r, 800));
    clearInterval(timer);
    return !video.paused && video.currentTime > 0;
  });
  expect(playing).toBe(true);
  for (const box of ['.product-card', '.comments', '.video-player', '.search-form']) {
    await expect(page.locator(box)).toBeVisible();
  }

  expect(blocked.some((u) => u.includes('googletagmanager.com'))).toBe(true);
  expect(await page.evaluate(() => 'gtag' in window && !('__tagManager' in window))).toBe(true);
  expect(errors).toEqual([]);
}

test('sign-in, search, cart, comments and video work while trackers are blocked', async ({
  context,
  worker,
}) => {
  await flows(context, worker);
});

test('the same flows work under the Strict privacy profile', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#privacy`);
  await dash.getByRole('button', { name: 'Sıkı' }).click();
  await expect(dash.getByText('Şu an: Sıkı')).toBeVisible();
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('fp-strict');
  await dash.close();
  await flows(context, worker);
});
