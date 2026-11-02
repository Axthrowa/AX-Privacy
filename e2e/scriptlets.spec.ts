import { expect, startHttpsServer, startServer, test } from './fixtures.ts';

// Local pages only: every host below resolves to the test server.
const SITE = 'scripts.nexus-test.example';

function page(body: string) {
  return `<!doctype html><title>t</title>${body}`;
}

test('a list scriptlet runs before the first inline page script', async ({ context, worker }) => {
  // A real entry from the bundled data must be reachable: find one and serve a page under its host.
  const row = await worker.evaluate(async () => {
    const text = await (await fetch(chrome.runtime.getURL('scriptlets/ublock.js'))).text();
    const m = /\\n([a-z0-9.-]+\.[a-z]+)\\t\d+(?:,\d+)*\\n/.exec(text);
    return m?.[1] ?? null;
  });
  expect(row).not.toBeNull();

  const { port, server } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page(`<script>window.__ranInline = true;</script>`));
  });
  const p = await context.newPage();
  await p.goto(`http://${SITE}:${port}/`);
  // The runner removes the data global before any page script can see it.
  expect(await p.evaluate(() => [Object.hasOwn(window, '__nexusSl'), window.__ranInline])).toEqual([
    false,
    true,
  ]);
  server.close();
});

test('scriptlet implementations do what the rules ask, inside a real page', async ({
  context,
  worker,
}) => {
  const { port, server } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page(`<p id="kept">kept</p>`));
  });
  const p = await context.newPage();
  await p.goto(`http://${SITE}:${port}/`);
  // Runs the bundled runner again on a fresh frame with a table we control.
  const runner = await worker.evaluate(async () =>
    (await fetch(chrome.runtime.getURL('content/scriptlets.js'))).text(),
  );
  const out = await p.evaluate(
    async ({ code, table }) => {
      const frame = document.createElement('iframe');
      document.body.append(frame);
      const w = frame.contentWindow as Window & typeof globalThis & Record<string, unknown>;
      const doc = frame.contentDocument as Document;
      const seed = doc.createElement('script');
      seed.textContent = `self.__nexusSl=[${JSON.stringify(table)}];`;
      doc.head.append(seed);
      const script = doc.createElement('script');
      script.textContent = code;
      doc.head.append(script);
      const results: Record<string, unknown> = {};
      try {
        void w.adsLoaded;
        results.aopr = 'no-throw';
      } catch (e) {
        results.aopr = (e as Error).name;
      }
      results.set = w.adblockDetected;
      w.adblockDetected = true;
      results.setAfterWrite = w.adblockDetected;
      results.setDeep = (w.cfg as { ads?: unknown } | undefined)?.ads;
      w.cfg = { ads: true, other: 1 };
      results.setDeepAfter = (w.cfg as { ads: unknown; other: number }).ads;
      results.otherKept = (w.cfg as { other: number }).other;
      let timerRan = false;
      let otherTimerRan = false;
      w.setTimeout(function adblockCheck() {
        timerRan = true;
      }, 1);
      w.setTimeout(function fine() {
        otherTimerRan = true;
      }, 1);
      await new Promise((done) => setTimeout(done, 60));
      results.timer = [timerRan, otherTimerRan];
      results.fetch = await (await w.fetch('https://blocked.example/ads/x')).text();
      let listened = 0;
      w.addEventListener('nexus-popunder', function popunder() {
        listened++;
      });
      w.addEventListener('nexus-fine', function other() {
        listened += 10;
      });
      w.dispatchEvent(new w.Event('nexus-popunder'));
      w.dispatchEvent(new w.Event('nexus-fine'));
      results.listeners = listened;
      results.json = w.JSON.parse('{"adPlacements":[1],"keep":2}');
      // The decoy is a sandboxed frame's window: not null, and no real tab.
      results.opened = w.open('https://popup.example/x') !== null;
      results.cookie = doc.cookie;
      results.storage = w.localStorage.getItem('nx-consent');
      results.nativeLook = String(w.setTimeout).includes('[native code]');
      return results;
    },
    {
      code: runner,
      table: [
        'about-frame',
        // Frames from about:blank match by their parent, so the rows use the page host.
        `\n${SITE}\t0,1,2,3,4,5,6,7,8,9`,
        '~0\t["aopr","adsLoaded"]',
        '~1\t["set","adblockDetected","false"]',
        '~2\t["set","cfg.ads","false"]',
        '~3\t["nostif","adblockCheck"]',
        '~4\t["no-fetch-if","/ads/"]',
        '~5\t["aeld","nexus-popunder"]',
        '~6\t["json-prune","adPlacements"]',
        '~7\t["nowoif","popup.example"]',
        '~8\t["set-cookie","nx-ok","true"]',
        '~9\t["set-local-storage-item","nx-consent","rejected"]',
        '',
      ].join('\n'),
    },
  );
  expect(out).toEqual({
    aopr: 'ReferenceError',
    set: false,
    setAfterWrite: false,
    setDeep: undefined,
    setDeepAfter: false,
    otherKept: 1,
    timer: [false, true],
    fetch: '',
    listeners: 10,
    json: { keep: 2 },
    opened: true,
    cookie: expect.stringContaining('nx-ok=true') as unknown,
    storage: 'rejected',
    nativeLook: true,
  });
  server.close();
});

test('an ordinary page does not wake the worker for generic rules; an ad page does', async ({
  context,
  worker,
}) => {
  await worker.evaluate(() => {
    const seen: string[] = [];
    (self as unknown as { __seen: string[] }).__seen = seen;
    chrome.runtime.onMessage.addListener((m: { type: string }) => {
      seen.push(m.type);
    });
  });
  const seen = () => worker.evaluate(() => [...(self as unknown as { __seen: string[] }).__seen]);
  const { port, server } = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      req.url === '/ad'
        ? page(`<div class="ad-links-text" id="generic-ad">reklam</div><p id="text">metin</p>`)
        : page(`<nav class="site-navigation"><a href="/about">Hakkında</a></nav>`),
    );
  });
  const p = await context.newPage();
  await p.goto(`http://${SITE}:${port}/`);
  await p.waitForTimeout(500);
  expect((await seen()).filter((t) => t === 'cosmetic/dom')).toEqual([]);

  await p.goto(`http://${SITE}:${port}/ad`);
  await expect(p.locator('#generic-ad')).toBeHidden();
  await expect(p.locator('#text')).toBeVisible();
  expect(await seen()).toContain('cosmetic/dom');
  server.close();
});

test('the element picker hides what was clicked, on this site, and does not fire the page', async ({
  context,
  extensionId,
}) => {
  const { port, server } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      page(`<div id="promo" style="height:80px;width:300px" onclick="window.__clicked=true">reklam</div>
        <div class="card" id="c-one-12345" style="height:60px;width:300px">bir</div>
        <div class="card" style="height:60px;width:300px">iki</div>
        <p id="text">metin</p>`),
    );
  });
  const url = `http://${SITE}:${port}/`;
  const p = await context.newPage();
  await p.goto(url);
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/dashboard.html`);

  // The picker cannot save anything until the extension's own UI started it.
  const forged = await p.evaluate(
    () => typeof (window as { chrome?: { runtime?: object } }).chrome?.runtime,
  );
  expect(forged).toBe('undefined');

  const start = async () => {
    await ui.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      await chrome.runtime.sendMessage({ type: 'picker/start', tabId: tab?.id });
    }, url);
    await p.bringToFront();
    await expect(p.getByRole('dialog', { name: 'Öğe gizleme' })).toBeVisible();
  };

  await start();
  await p.locator('#promo').hover();
  await p.mouse.down();
  await p.mouse.up();
  expect(await p.evaluate(() => (window as unknown as { __clicked?: boolean }).__clicked)).toBe(
    undefined,
  );
  await expect(p.getByText('1 öğe gizlenecek')).toBeVisible();
  await p.getByRole('button', { name: 'Bu sitede gizle' }).click();
  await expect(p.getByRole('dialog')).toHaveCount(0);
  await expect(p.locator('#promo')).toBeHidden();
  await expect(p.locator('#text')).toBeVisible();

  const settings = await ui.evaluate(async () => {
    const r = (await chrome.runtime.sendMessage({ type: 'settings/get' })) as {
      data: { customRules: string };
    };
    return r.data.customRules;
  });
  expect(settings).toBe(`${SITE}###promo`);

  // The rule survives a reload, through the normal cosmetic path, and stays on this host.
  await expect
    .poll(async () => {
      await p.goto(url);
      return p.locator('#promo').isHidden();
    })
    .toBe(true);
  await expect(p.locator('.card')).toHaveCount(2);
  const other = await context.newPage();
  await other.goto(`http://other.nexus-test.example:${port}/`);
  await expect(other.locator('#promo')).toBeVisible();
  await other.close();

  // "Similar" widens to all cards; Esc leaves without saving or disturbing the page.
  await start();
  await p.locator('.card').first().click({ force: true });
  await expect(p.getByText('1 öğe gizlenecek')).toBeVisible();
  await p.getByRole('checkbox', { name: 'Benzerlerini de gizle' }).check();
  await expect(p.getByText('2 öğe gizlenecek')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.getByRole('dialog')).toHaveCount(0);
  await expect(p.locator('.card').first()).toBeVisible();
  server.close();
});

test('every regex rule shipped in a ruleset is one the browser accepts, within its limit', async ({
  worker,
}) => {
  const out = await worker.evaluate(async () => {
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    const bad: string[] = [];
    let count = 0;
    for (const id of enabled) {
      const rules = (await (await fetch(chrome.runtime.getURL(`rulesets/${id}.json`))).json()) as {
        condition: { regexFilter?: string; isUrlFilterCaseSensitive?: boolean };
      }[];
      for (const r of rules) {
        const regex = r.condition.regexFilter;
        if (!regex) continue;
        count++;
        const res = await chrome.declarativeNetRequest.isRegexSupported({
          regex,
          isCaseSensitive: r.condition.isUrlFilterCaseSensitive ?? false,
        });
        if (!res.isSupported) bad.push(`${id}: ${regex} (${res.reason})`);
      }
    }
    return { bad, count };
  });
  expect(out.bad).toEqual([]);
  expect(out.count).toBeGreaterThan(100);
  expect(out.count).toBeLessThanOrEqual(1000);
});

test('ad tabs opened through forms and detached links are stopped; real buttons still work', async ({
  context,
}) => {
  const { port, server } = await startServer((req, res) => {
    if (req.url === '/hook.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`document.addEventListener('click', () => {
        const ad = window.__ad;
        if (window.__mode === 'form') {
          const f = document.createElement('form');
          f.action = ad; f.target = '_blank'; f.method = 'get';
          document.body.append(f); f.submit();
        } else if (window.__mode === 'detached') {
          const a = document.createElement('a');
          a.href = ad; a.target = '_blank'; a.click();
        } else if (window.__mode === 'dispatch') {
          const a = document.createElement('a');
          a.href = ad; a.target = '_blank';
          a.dispatchEvent(new MouseEvent('click'));
        } else if (window.__mode === 'open') {
          window.open(ad);
        }
      });`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      page(`<div id="empty" style="height:200px">bos alan</div>
        <button id="share" onclick="window.open(window.__share)">Paylas</button>
        <a id="js-link" href="#" onclick="window.open(window.__share);return false">Paylas 2</a>
        <button id="plain">Dugme</button>
        <form action="/same" target="_blank"><button id="same-form">Ayni site</button></form>
        <script>
          window.__ad = 'http://ads.nexus-other.example:${port}/landing';
          window.__share = 'http://share.nexus-other.example:${port}/s';
        </script>
        <script src="http://cdn.nexus-other.example:${port}/hook.js"></script>`),
    );
  });
  const p = await context.newPage();
  await p.goto(`http://${SITE}:${port}/`);
  const clickAndCount = async (selector: string, mode: string | null) => {
    await p.evaluate((m) => {
      (window as unknown as { __mode: string | null }).__mode = m;
    }, mode);
    const before = new Set(context.pages());
    await p.click(selector);
    await p.waitForTimeout(500);
    const fresh = context.pages().filter((t) => !before.has(t));
    await Promise.all(fresh.map((t) => t.close()));
    return fresh.length;
  };
  for (const mode of ['form', 'detached', 'dispatch', 'open']) {
    expect(await clickAndCount('#empty', mode), `${mode} on empty space`).toBe(0);
    // The hijacker also hooks clicks on real buttons; it is the third-party script that is refused.
    expect(await clickAndCount('#plain', mode), `${mode} on a button`).toBe(0);
  }
  expect(await clickAndCount('#share', null), 'share button').toBe(1);
  expect(await clickAndCount('#js-link', null), 'script link').toBe(1);
  expect(await clickAndCount('#same-form', null), 'same-site form').toBe(1);
  server.close();
});

test('a node-text rule stays silent under Trusted Types and cannot loop', async ({
  context,
  worker,
}) => {
  const runner = await worker.evaluate(async () =>
    (await fetch(chrome.runtime.getURL('content/scriptlets.js'))).text(),
  );
  const table = `\n${SITE}\t0,1\n~0\t["rmnt","script","nexus-ad-marker"]\n~1\t["rpnt","script","keep-me","keep-me again"]\n`;
  const { port, server } = await startServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html',
      'content-security-policy': "require-trusted-types-for 'script'",
    });
    res.end(
      page(`<script>self.__nexusSl=[${JSON.stringify(table)}];</script>
        <script>${runner}</script>
        <script>window.__adRan = "nexus-ad-marker";</script>
        <script>window.__fineRan = "keep-me";</script>
        <p id="end">end</p>`),
    );
  });
  const p = await context.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://${SITE}:${port}/`, { timeout: 10_000 });
  await expect(p.locator('#end')).toBeVisible();
  expect(
    await p.evaluate(() => {
      const w = window as unknown as { __adRan?: string; __fineRan?: string };
      return [w.__adRan, w.__fineRan];
    }),
  ).toEqual([undefined, 'keep-me again']);
  expect(errors).toEqual([]);
  server.close();
});

test('Twitch playlists lose their ads in the worker; other workers are untouched', async ({
  context,
  worker,
}) => {
  // On a fresh install the scripts register just after the worker starts.
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('tw-ads');
  let origin = '';
  const { port, server } = await startHttpsServer((req, res) => {
    const url = req.url ?? '/';
    const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360,FRAME-RATE=30.000
${origin}/media/360.m3u8`;
    const MEDIA = `#EXTM3U
#EXT-X-DATERANGE:ID="stitched-ad"
#EXTINF:2.000,
${origin}/media/ad.ts
#EXTINF:2.000,live
${origin}/media/live.ts`;
    const reply = (type: string, body: string, status = 200) => {
      res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' });
      res.end(body);
    };
    if (url.includes('/channel/hls/')) reply('application/vnd.apple.mpegurl', MASTER);
    else if (url.endsWith('.m3u8')) reply('application/vnd.apple.mpegurl', MEDIA);
    else if (url.endsWith('ad.ts')) reply('video/mp2t', 'REAL-AD');
    else reply('text/html', page('<video></video>'));
  });
  origin = `https://www.twitch.tv:${port}`;
  const p = await context.newPage();
  await p.goto(`${origin}/somebody`);
  const out = await p.evaluate(async (base) => {
    const run = (marker: string) =>
      new Promise<{ media: string; ad: string }>((done, fail) => {
        const src = `
          // ${marker}
          (async () => {
            await fetch('${base}/api/channel/hls/somebody.m3u8');
            const media = await (await fetch('${base}/media/360.m3u8')).text();
            const ad = await (await fetch('${base}/media/ad.ts')).text();
            postMessage({ media, ad });
          })();`;
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = (e: MessageEvent<{ media: string; ad: string }>) => done(e.data);
        w.onerror = (e) => fail(new Error(e.message));
      });
    return { player: await run('amazon-ivs-wasmworker'), other: await run('something-else') };
  }, origin);
  // Backup playlists cannot load here (the token host is unreachable), so segments get swapped.
  expect(out.player.media).toContain('live.ts');
  expect(out.player.ad).not.toContain('REAL-AD');
  expect(out.other.ad).toBe('REAL-AD');
  server.close();
});

declare global {
  interface Window {
    __ranInline?: boolean;
  }
}
