import type { IncomingMessage, ServerResponse } from 'node:http';
import { expect, startServer, test } from './fixtures.ts';

let port = 0;
const host = (name: string) => `http://${name}:${port}`;

function handle(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>dash</title><p>sayfa</p>');
}

let server: Awaited<ReturnType<typeof startServer>>['server'];
test.beforeAll(async () => {
  ({ server, port } = await startServer(handle));
});
test.afterAll(() => server.close());

test('overview counts a blocked request, theme changes, and a site can be paused from the form', async ({
  context,
  extensionId,
}) => {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#overview`);
  await dash.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'privacy/set', privacy: { detailedReports: true } }),
  );
  await expect(dash.getByRole('heading', { name: 'Özet' })).toBeVisible();
  await expect(dash.getByText('bugün · Reklam isteği')).toBeVisible();
  await expect(dash.getByText('Henüz AX')).toBeVisible();
  const nav = dash.getByRole('navigation', { name: 'Sayfalar' });
  for (const name of [
    'Özet',
    'Reklam',
    'Gizlilik',
    'İzleme',
    'Parmak izi',
    'Güvenlik',
    'Dolandırıcılık',
    'Video',
    'Çerez',
    'Listeler',
    'Siteler',
    'Gelişmiş',
    'İstatistik',
    'Hakkında',
  ]) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }

  const page = await context.newPage();
  await page.goto(`${host('site.nexus-test.example')}/`);
  await page.evaluate(
    (src) =>
      new Promise<void>((done) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => done();
        s.onerror = () => done();
        document.head.append(s);
      }),
    `http://www.googletagmanager.com:${port}/gtm.js`,
  );
  await expect
    .poll(async () =>
      dash.evaluate(async () => {
        const r = (await chrome.runtime.sendMessage({ type: 'stats/get', days: 7 })) as {
          data: { totals: { requests: number } };
        };
        return r.data.totals.requests;
      }),
    )
    .toBeGreaterThan(0);
  const hosts = await dash.evaluate(async () => {
    const r = (await chrome.runtime.sendMessage({ type: 'stats/get', days: 7 })) as {
      data: { topHosts: { host: string }[] };
    };
    return r.data.topHosts.map((h) => h.host);
  });
  expect(hosts).toContain('www.googletagmanager.com');
  await dash.reload();
  await expect(dash.getByText('www.googletagmanager.com')).toBeVisible();

  await expect(dash.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dash.getByRole('button', { name: 'Açık tema' }).click();
  await expect(dash.locator('html')).toHaveAttribute('data-theme', 'light');

  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#sites`);
  await dash.getByLabel('Duraklatılacak site').fill('example.com');
  await dash.getByRole('button', { name: 'Duraklat' }).click();
  await expect(dash.getByText('example.com', { exact: true })).toBeVisible();
  await expect(dash.getByRole('button', { name: 'Korumayı aç' })).toBeVisible();
});

test('settings export and import restore a pause without taking the Brave flag', async ({
  context,
  extensionId,
}) => {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#sites`);
  await dash.getByLabel('Duraklatılacak site').fill('paused.example');
  await dash.getByRole('button', { name: 'Duraklat' }).click();
  await expect(dash.getByText('paused.example', { exact: true })).toBeVisible();

  const bag = await dash.evaluate(async () => {
    const r = (await chrome.runtime.sendMessage({ type: 'settings/export' })) as {
      data: {
        nexus: number;
        settings: { pausedSites: string[]; isBrave?: boolean };
        stats?: { rows: unknown[]; events: unknown[] };
      };
    };
    return r.data;
  });
  expect(bag.nexus).toBe(1);
  expect(bag.settings.pausedSites).toContain('paused.example');
  expect(bag.settings).not.toHaveProperty('isBrave');
  expect(Array.isArray(bag.stats?.rows)).toBe(true);
  expect(Array.isArray(bag.stats?.events)).toBe(true);

  await dash.getByRole('button', { name: 'Korumayı aç' }).click();
  await expect(dash.getByText('Duraklatılan site yok.')).toBeVisible();

  await dash.evaluate(async (data) => {
    await chrome.runtime.sendMessage({ type: 'settings/import', data });
  }, bag);
  await expect(dash.getByText('paused.example', { exact: true })).toBeVisible();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#about`);
  await expect(dash.getByText('Tarayıcı: Brave', { exact: true })).toBeVisible();
});
