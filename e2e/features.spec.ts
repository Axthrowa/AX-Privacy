import type { Page, Worker } from '@playwright/test';
import { expect, startServer, test } from './fixtures.ts';

// Local pages only: every host below resolves to the test server.
const SITE = 'features.nexus-test.example';

const send = (ui: Page, msg: object) =>
  ui.evaluate(async (m) => {
    const r = (await chrome.runtime.sendMessage(m)) as { ok: boolean; error?: string };
    if (!r.ok) throw new Error(r.error);
  }, msg);

const ready = (worker: Worker) =>
  expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('link-clean');

test('newer scriptlets clean links, cookies, XML and calls inside a real page', async ({
  context,
  worker,
}) => {
  const runner = await worker.evaluate(async () =>
    (await fetch(chrome.runtime.getURL('content/scriptlets.js'))).text(),
  );
  const calls = [
    ['href-sanitizer', 'a.out', '?url'],
    ['remove-cookie', 'track_me'],
    ['nofab'],
    ['popads-dummy'],
    ['json-prune-xhr-response', 'ads', '', 'propsToMatch', '/data.json'],
    ['xml-prune', 'Ad', '', '/vast.xml'],
    ['set-attr', '#target', 'data-ok', 'yes'],
    ['set-attr', '#target', 'onclick', 'evil'],
    ['trusted-set', 'cfg.flags', '{"value":{"ads":false}}'],
    ['trusted-set-local-storage-item', 'stamp', '$now$'],
    ['trusted-replace-argument', 'document.getElementById', '0', 'null', 'condition', 'modal'],
    ['prevent-innerHTML', '', 'ad-box'],
    ['norafif', 'adLoop'],
  ];
  const ids = calls.map((_, i) => i).join(',');
  const table = `\n${SITE}\t${ids}\n${calls.map((c, i) => `~${i}\t${JSON.stringify(c)}\n`).join('')}`;
  const { port, server } = await startServer((req, res) => {
    if (req.url === '/data.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ads":[1],"keep":2}');
    } else if (req.url === '/vast.xml') {
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end('<VAST><Ad id="1"/><Keep/></VAST>');
    } else {
      res.writeHead(200, {
        'content-type': 'text/html',
        ...(req.url === '/' && { 'set-cookie': 'track_me=1; Path=/' }),
      });
      res.end(`<!doctype html><title>t</title>
        <script>self.__nexusSl=[${JSON.stringify(table)}];</script>
        <script>${runner}</script>
        <a class="out" id="out" href="/go?url=https%3A%2F%2Fshop.example%2Fa">link</a>
        <div id="target"></div><div id="modal"></div><div id="box"></div>`);
    }
  });
  const p = await context.newPage();
  await p.goto(`http://${SITE}:${port}/`);
  await expect
    .poll(() => p.evaluate(() => (document.getElementById('out') as HTMLAnchorElement).href))
    .toBe('https://shop.example/a');
  const out = await p.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const xhr = (url: string) =>
      new Promise<string>((done) => {
        const x = new XMLHttpRequest();
        x.open('GET', url);
        x.onload = () => done(x.responseText);
        x.send();
      });
    (w.cfg as unknown) = {};
    let frames = 0;
    requestAnimationFrame(function adLoop() {
      frames += 100;
    });
    requestAnimationFrame(function fine() {
      frames += 1;
    });
    await new Promise((r) => setTimeout(r, 100));
    const box = document.getElementById('box') as HTMLElement;
    box.innerHTML = '<b>ad-box</b>';
    const blockedHtml = box.innerHTML;
    box.innerHTML = '<b>fine</b>';
    const target = document.getElementById('target') as HTMLElement;
    return {
      cookie: document.cookie.includes('track_me'),
      fab: (w.fuckAdBlock as { check(): boolean } | undefined)?.check(),
      popAds: typeof w.PopAds,
      xhr: await xhr('/data.json'),
      xml: await (await fetch('/vast.xml')).text(),
      attr: target.getAttribute('data-ok'),
      unsafeAttr: target.getAttribute('onclick'),
      flags: (w.cfg as { flags?: unknown }).flags,
      stamp: /^\d+$/.test(localStorage.getItem('stamp') ?? ''),
      modal: document.getElementById('modal'),
      target: document.getElementById('target') !== null,
      frames,
      blockedHtml,
      html: box.innerHTML,
    };
  });
  expect(out).toEqual({
    cookie: false,
    fab: true,
    popAds: 'object',
    xhr: '{"keep":2}',
    xml: expect.not.stringContaining('<Ad') as unknown,
    attr: 'yes',
    unsafeAttr: null,
    flags: { ads: false },
    stamp: true,
    modal: null,
    target: true,
    frames: 1,
    blockedHtml: '',
    html: '<b>fine</b>',
  });
  server.close();
});

test('a tracking link goes straight to its target; the tracker is never asked', async ({
  context,
  worker,
}) => {
  await ready(worker);
  const hits: string[] = [];
  const { port, server } = await startServer((req, res) => {
    hits.push(`${req.headers.host ?? ''}${req.url ?? ''}`);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>t</title>
      <a id="out" href="http://www.youtube.com:${port}/redirect?q=http%3A%2F%2F${SITE}%3A${port}%2Fdone">git</a>`);
  });
  const p = await context.newPage();
  await p.goto(`http://${SITE}:${port}/`);
  await p.click('#out');
  await p.waitForURL(`http://${SITE}:${port}/done`);
  expect(hits.some((h) => h.includes('/redirect'))).toBe(false);
  server.close();
});

test('the trouble button pauses a site and the pause ends by itself', async ({
  context,
  extensionId,
  worker,
}) => {
  await ready(worker);
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await send(ui, { type: 'site/pauseBriefly', site: 'a.example' });
  const state = () =>
    worker.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings: { pausedSites: string[]; pauseUntil: Record<string, number> };
      };
      const alarm = await chrome.alarms.get('site/pauseEnd');
      return { settings, when: alarm?.scheduledTime };
    });
  const first = await state();
  expect(first.settings.pausedSites).toEqual(['a.example']);
  const until = first.settings.pauseUntil['a.example'] ?? 0;
  expect(until).toBeGreaterThan(Date.now() + 29 * 60_000);
  expect(first.when).toBe(until);

  // The alarm's job, with the clock past the end: stored time moved back instead of waiting.
  await worker.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as {
      settings: { pauseUntil: Record<string, number> };
    };
    settings.pauseUntil['a.example'] = Date.now() - 1000;
    await chrome.storage.local.set({ settings });
  });
  await send(ui, { type: 'site/expirePauses' });
  expect((await state()).settings.pausedSites).toEqual([]);
});
