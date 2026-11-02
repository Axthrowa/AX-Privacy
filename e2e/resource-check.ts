/**
 * How long a blocker's service worker stays alive while someone browses: the cost a one-page memory
 * snapshot cannot show. Brave runs without Playwright, because an attached debugger keeps a worker
 * alive; targets are only listed over HTTP. Local pages only; nothing leaves the machine.
 * Usage: node e2e/resource-check.ts   (writes docs/resource-check.json)
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BRAVE_PATH, EXTENSION_DIR } from './fixtures.ts';

const SETTLE_MS = 45_000;
const WINDOW_MS = 120_000;
const VISIT_EVERY_MS = 10_000;
const INSTALLED = join(
  process.env.LOCALAPPDATA ?? '',
  'BraveSoftware/Brave-Browser/User Data/Default/Extensions',
);
const UBOL_ID = 'ddkjiahejlhfcafbddmgiahcphecmpfh';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(
    req.url === '/a'
      ? '<!doctype html><title>a</title><nav class="site-navigation"><a href="/b">b</a></nav><img src="/x.png">'
      : '<!doctype html><title>b</title><div class="ad-links-text">ad</div><iframe src="/a"></iframe>',
  );
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

interface Target {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/** One message to a page over its own debugger socket; workers are never attached to. */
function sendToPage(target: Target, expression: string): Promise<void> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl ?? '');
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true },
        }),
      );
    });
    ws.addEventListener('message', () => {
      ws.close();
      done();
    });
    ws.addEventListener('error', () => fail(new Error('debugger socket failed')));
  });
}

async function measure(label: string, extension: string, setup?: string) {
  const profile = await mkdtemp(join(tmpdir(), 'ax-resource-'));
  const brave = spawn(BRAVE_PATH, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ]);
  try {
    let port = '';
    for (let i = 0; i < 60 && !port; i++) {
      await sleep(500);
      port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(
        (t) => t.split('\n')[0] ?? '',
        () => '',
      );
    }
    const api = `http://127.0.0.1:${port}/json`;
    const targets = async () => (await (await fetch(`${api}/list`)).json()) as Target[];
    await sleep(5000);
    const worker = (await targets()).find((t) => t.type === 'service_worker');
    if (!worker) throw new Error('no service worker');
    if (setup) {
      const host = new URL(worker.url).host;
      const opened = (await (
        await fetch(`${api}/new?chrome-extension://${host}/dashboard.html`, { method: 'PUT' })
      ).json()) as Target;
      await sleep(2000);
      await sendToPage(opened, setup);
      await fetch(`${api}/close/${opened.id}`);
    }
    await sleep(SETTLE_MS);

    let alive = 0;
    let samples = 0;
    let starts = 0;
    let wasAlive = false;
    let visits = 0;
    const end = Date.now() + WINDOW_MS;
    let nextVisit = 0;
    while (Date.now() < end) {
      if (Date.now() >= nextVisit) {
        nextVisit = Date.now() + VISIT_EVERY_MS;
        const url = `${origin}/${visits % 2 ? 'a' : 'b'}?${visits}`;
        const page = (await (await fetch(`${api}/new?${url}`, { method: 'PUT' })).json()) as Target;
        visits++;
        setTimeout(() => void fetch(`${api}/close/${page.id}`).catch(() => undefined), 6000);
      }
      const on = (await targets()).some((t) => t.type === 'service_worker');
      samples++;
      if (on) alive++;
      if (on && !wasAlive) starts++;
      wasAlive = on;
      await sleep(1000);
    }
    const result = { label, visits, alivePercent: Math.round((100 * alive) / samples), starts };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    brave.kill();
    await sleep(1500);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(
      () => undefined,
    );
  }
}

const { readdirSync } = await import('node:fs');
const ubolVersion = readdirSync(join(INSTALLED, UBOL_ID)).at(-1) ?? '';
const results = [
  await measure('AX Privacy', EXTENSION_DIR),
  await measure(
    'AX Privacy, ayrıntılı raporlar açık',
    EXTENSION_DIR,
    `chrome.runtime.sendMessage({ type: 'privacy/set', privacy: { detailedReports: true } })`,
  ),
  await measure('uBO Lite', join(INSTALLED, UBOL_ID, ubolVersion)),
];
server.close();
await writeFile(
  resolve(import.meta.dirname, '../docs/resource-check.json'),
  `${JSON.stringify({ measuredAt: new Date().toISOString(), windowMs: WINDOW_MS, results }, null, 2)}\n`,
);
