import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BASE_SCRIPTS,
  expect,
  SPONSORBLOCK_TEST_PORT,
  startHttpsServer,
  startServer,
  test,
} from './fixtures.ts';

// Simulated YouTube and Twitch pages served locally; the real sites are never contacted.
const hits: string[] = [];
let port = 0;
let tlsPort = 0;
// youtube.com and twitch.tv are HSTS-preloaded: the browser only talks HTTPS to them.
const host = (name: string) =>
  name.endsWith('.example') ? `http://${name}:${port}` : `https://${name}:${tlsPort}`;

const PLAYER = {
  videoDetails: { videoId: 'nexus' },
  adPlacements: [{ kind: 'preroll' }],
  playerAds: [{}],
  adSlots: [{}],
};

const WATCH = `<!doctype html><title>watch</title>
<script>var ytInitialPlayerResponse = ${JSON.stringify(PLAYER)};
window.__initial = JSON.stringify(ytInitialPlayerResponse);</script>
<div class="html5-video-player" id="player"><video></video></div>
<ytd-rich-grid-renderer>
<ytd-rich-item-renderer id="ad-card"><a>Reklam</a><ad-badge-view-model>Sponsorlu</ad-badge-view-model></ytd-rich-item-renderer>
<ytd-rich-item-renderer id="video-card"><a>Video</a></ytd-rich-item-renderer>
</ytd-rich-grid-renderer>`;

const TWITCH = `<!doctype html><title>twitch</title>
<div class="stream-display-ad__wrapper" id="sda">AD</div><div id="chat">sohbet</div>
<div class="video-player"><video></video><div id="overlay"></div></div>`;

function handle(req: IncomingMessage, res: ServerResponse) {
  const hostname = (req.headers.host ?? '').split(':')[0] ?? '';
  hits.push(`${hostname}${req.url ?? ''}`);
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const send = (type: string, body: string) => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  };
  if (path === '/youtubei/v1/player') send('application/json', JSON.stringify(PLAYER));
  else if (path.startsWith('/embed/')) send('text/html', '<title>embed</title>');
  else if (path.endsWith('.js')) send('application/javascript', '');
  else if (hostname === 'www.youtube.com') send('text/html; charset=utf-8', WATCH);
  else if (hostname === 'www.twitch.tv') send('text/html; charset=utf-8', TWITCH);
  else {
    send(
      'text/html; charset=utf-8',
      `<!doctype html><iframe id="yt" src="${host('www.youtube.com')}/embed/nexus"></iframe>`,
    );
  }
}

const servers: { close(): unknown }[] = [];
test.beforeAll(async () => {
  const plain = await startServer(handle);
  const tls = await startHttpsServer(handle);
  ({ port } = plain);
  tlsPort = tls.port;
  servers.push(plain.server, tls.server);
});
test.afterAll(() => {
  for (const s of servers) s.close();
});
test.beforeEach(() => {
  hits.length = 0;
});

const scriptIds = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort(),
  );

async function dashboard(context: BrowserContext, extensionId: string) {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#video`);
  await expect(dash.getByRole('heading', { name: 'YouTube ve Twitch' })).toBeVisible();
  return dash;
}

const adFields = (page: Page) =>
  page.evaluate(async () => {
    const keys = (o: object) => Object.keys(o).sort();
    const w = window as unknown as { ytInitialPlayerResponse: object; __initial: string };
    const fetched = (await (await fetch('/youtubei/v1/player')).json()) as object;
    const parsed = JSON.parse(await (await fetch('/youtubei/v1/player')).text()) as object;
    const xhr = (type: XMLHttpRequestResponseType) =>
      new Promise<object>((done) => {
        const x = new XMLHttpRequest();
        x.open('GET', '/youtubei/v1/player');
        x.responseType = type;
        // Read the raw text without JSON.parse, so only the XHR path is under test.
        x.onload = () =>
          done(
            type === 'json'
              ? (x.response as object)
              : Object.fromEntries(
                  ['adPlacements', 'adSlots', 'playerAds', 'videoDetails']
                    .filter((k) => x.responseText.includes(`"${k}"`))
                    .map((k) => [k, 1]),
                ),
          );
        x.send();
      });
    return {
      initial: keys(JSON.parse(w.__initial) as object),
      global: keys(w.ytInitialPlayerResponse),
      fetched: keys(fetched),
      parsed: keys(parsed),
      xhrText: keys(await xhr('')),
      xhrJson: keys(await xhr('json')),
    };
  });

test('YouTube player responses lose their ad schedule, and only while the option is on', async ({
  context,
  extensionId,
  worker,
}) => {
  await expect.poll(() => scriptIds(worker)).toEqual(BASE_SCRIPTS);
  const page = await context.newPage();
  await page.goto(`${host('www.youtube.com')}/watch?v=nexus`);
  const clean = ['videoDetails'];
  expect(await adFields(page)).toEqual({
    initial: clean,
    global: clean,
    fetched: clean,
    parsed: clean,
    xhrText: clean,
    xhrJson: clean,
  });
  // The page sees the built-ins, not AX's wrappers.
  expect(
    await page.evaluate(() => [
      Function.prototype.toString.call(JSON.parse),
      String(Response.prototype.json),
      Function.prototype.toString.toString(),
      JSON.parse.name,
      JSON.parse.length,
      String(XMLHttpRequest.prototype.open),
    ]),
  ).toEqual([
    'function parse() { [native code] }',
    'function json() { [native code] }',
    'function toString() { [native code] }',
    'parse',
    2,
    'function open() { [native code] }',
  ]);

  const dash = await dashboard(context, extensionId);
  await dash.getByRole('switch', { name: 'YouTube video reklamlarını kaldır' }).click();
  await expect
    .poll(() => scriptIds(worker))
    .toEqual(BASE_SCRIPTS.filter((id) => id !== 'yt-ads' && id !== 'yt-guard'));
  await page.reload();
  const all = ['adPlacements', 'adSlots', 'playerAds', 'videoDetails'];
  expect((await adFields(page)).fetched).toEqual(all);
});

test('ad cards YouTube still shows are marked, ordinary videos are not', async ({
  context,
  extensionId,
  worker,
}) => {
  await expect.poll(() => scriptIds(worker)).toContain('yt-sponsored');
  const page = await context.newPage();
  await page.goto(`${host('www.youtube.com')}/`);
  const outline = (id: string) =>
    page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).outlineStyle);
  const label = (id: string) =>
    page.locator(`#${id}`).evaluate((el) => getComputedStyle(el, '::before').content);
  expect(await outline('ad-card')).toBe('dashed');
  expect(await label('ad-card')).toBe('"Sponsorlu · AX"');
  expect(await outline('video-card')).toBe('none');

  const dash = await dashboard(context, extensionId);
  await dash.getByRole('switch', { name: 'Sponsorlu kartları işaretle' }).click();
  await expect.poll(() => scriptIds(worker)).not.toContain('yt-sponsored');
  await page.reload();
  expect(await outline('ad-card')).toBe('none');
});

test('ad cards can be hidden instead of marked', async ({ context, extensionId, worker }) => {
  const dash = await dashboard(context, extensionId);
  await dash.getByRole('switch', { name: 'Sponsorlu kartları tamamen gizle' }).click();
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts({ ids: ['yt-sponsored'] })).map(
          (s) => s.css,
        ),
      ),
    )
    .toEqual([['content/yt-sponsored-hide.css']]);
  const page = await context.newPage();
  await page.goto(`${host('www.youtube.com')}/`);
  await expect(page.locator('#ad-card')).toBeHidden();
  await expect(page.locator('#video-card')).toBeVisible();
});

test("YouTube's own Skip button is pressed when an ad still plays", async ({ context, worker }) => {
  await expect.poll(() => scriptIds(worker)).toContain('yt-autoskip');
  const page = await context.newPage();
  await page.goto(`${host('www.youtube.com')}/watch?v=nexus`);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'ytp-skip-ad-button';
    b.textContent = 'Geç';
    b.onclick = () => ((window as unknown as { __skipped: boolean }).__skipped = true);
    document.getElementById('player')?.append(b);
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __skipped?: boolean }).__skipped))
    .toBe(true);
});

test('after the ad blocker warning, that tab backs off and the video plays', async ({
  context,
  worker,
}) => {
  await expect.poll(() => scriptIds(worker)).toContain('yt-guard');
  const page = await context.newPage();
  await page.goto(`${host('www.youtube.com')}/watch?v=nexus`);
  expect((await adFields(page)).fetched).toEqual(['videoDetails']);
  const reloaded = page.waitForEvent('load');
  await page.evaluate(() =>
    document.body.append(document.createElement('ytd-enforcement-message-view-model')),
  );
  await reloaded;
  // Once only: the warning comes back, but the tab has already backed off and stays put.
  await page.evaluate(() =>
    document.body.append(document.createElement('ytd-enforcement-message-view-model')),
  );
  await page.waitForTimeout(1500);
  expect((await adFields(page)).fetched).toEqual([
    'adPlacements',
    'adSlots',
    'playerAds',
    'videoDetails',
  ]);
  expect(
    await worker.evaluate(
      async () => (await chrome.storage.local.get('youtubeWarnings')).youtubeWarnings,
    ),
  ).toMatchObject({ count: 1 });
  // Another tab is not affected.
  const other = await context.newPage();
  await other.goto(`${host('www.youtube.com')}/watch?v=nexus`);
  expect((await adFields(other)).fetched).toEqual(['videoDetails']);
});

test('embedded YouTube players move to youtube-nocookie.com when chosen', async ({
  context,
  extensionId,
  worker,
}) => {
  await expect.poll(() => scriptIds(worker)).toContain('cosmetic');
  const page = await context.newPage();
  const embedHost = async () => {
    await page.goto(`${host('site.nexus-test.example')}/`);
    const frame = await (await page.locator('#yt').elementHandle())?.contentFrame();
    await frame?.waitForLoadState();
    return frame ? new URL(frame.url()).hostname : null;
  };
  expect(await embedHost()).toBe('www.youtube.com');

  const dash = await dashboard(context, extensionId);
  await dash.getByRole('switch', { name: /youtube-nocookie\.com/ }).click();
  await expect.poll(embedHost).toBe('www.youtube-nocookie.com');
  expect(hits).toContain('www.youtube-nocookie.com/embed/nexus');
});

test('Twitch display ads are hidden and its ad server is blocked by the lists', async ({
  context,
  worker,
}) => {
  await expect.poll(() => scriptIds(worker)).toContain('cosmetic');
  const page = await context.newPage();
  await page.goto(`${host('www.twitch.tv')}/nexus`);
  await expect(page.locator('#sda')).toBeHidden();
  await expect(page.locator('#chat')).toBeVisible();
  const loaded = await page.evaluate(
    (src) =>
      new Promise<string>((done) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => done('load');
        s.onerror = () => done('error');
        document.head.append(s);
      }),
    `${host('edge.ads.twitch.tv')}/ads.js`,
  );
  expect(loaded).toBe('error');
  expect(hits.some((h) => h.startsWith('edge.ads.twitch.tv'))).toBe(false);
});

const playerState = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement;
    return { muted: v.muted, filter: getComputedStyle(v).filter };
  });
const QUIET = { muted: false, filter: 'none' };
const AD = { muted: true, filter: 'brightness(0.15)' };

test('stitched-in ads are muted and darkened only while the player marks one', async ({
  context,
  extensionId,
  worker,
}) => {
  const dash = await dashboard(context, extensionId);
  await dash.getByRole('switch', { name: /sesi kapat ve görüntüyü karart/ }).click();
  await expect.poll(() => scriptIds(worker)).toContain('video-ads');
  const page = await context.newPage();

  await page.goto(`${host('www.youtube.com')}/watch?v=nexus`);
  expect(await playerState(page)).toEqual(QUIET);
  await page.evaluate(() => document.getElementById('player')?.classList.add('ad-showing'));
  await expect.poll(() => playerState(page)).toEqual(AD);
  await page.evaluate(() => document.getElementById('player')?.classList.remove('ad-showing'));
  await expect.poll(() => playerState(page)).toEqual(QUIET);

  await page.goto(`${host('www.twitch.tv')}/nexus`);
  await page.evaluate(() => {
    const label = document.createElement('span');
    label.dataset.aTarget = 'video-ad-label';
    label.id = 'ad-label';
    document.getElementById('overlay')?.append(label);
  });
  await expect.poll(() => playerState(page)).toEqual(AD);
  await page.evaluate(() => document.getElementById('ad-label')?.remove());
  await expect.poll(() => playerState(page)).toEqual(QUIET);
});

test('SponsorBlock acts per category, undoes a skip and is asked only by hash prefix', async ({
  context,
  extensionId,
  worker,
}) => {
  const VIDEO = 'dQw4w9WgXcQ';
  const sponsor = await startHttpsServer((req, res) => {
    hits.push(`sponsor.ajay.app${req.url ?? ''}`);
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(
      JSON.stringify([
        { videoID: 'otherVideo1', segments: [{ category: 'sponsor', segment: [1, 50] }] },
        {
          videoID: VIDEO,
          segments: [
            { category: 'sponsor', actionType: 'skip', segment: [10, 20] },
            { category: 'intro', actionType: 'skip', segment: [30, 40] },
            { category: 'selfpromo', actionType: 'skip', segment: [50, 60] },
          ],
        },
      ]),
    );
  }, SPONSORBLOCK_TEST_PORT);
  try {
    const dash = await dashboard(context, extensionId);
    await dash.getByRole('switch', { name: /SponsorBlock/ }).click();
    await expect.poll(() => scriptIds(worker)).toContain('yt-skip');
    // All 12 categories can be set; self-promotion goes from automatic to off.
    await expect(dash.locator('label.field select')).toHaveCount(12);
    await dash.getByLabel('Kendi tanıtımı').selectOption('off');
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (
              (await chrome.storage.local.get('settings')).settings as {
                video: { sponsorModes: Record<string, string> };
              }
            ).video.sponsorModes.selfpromo,
        ),
      )
      .toBe('off');

    const page = await context.newPage();
    await page.goto(`${host('www.youtube.com')}/watch?v=${VIDEO}`);
    const tick = (seek?: number) =>
      page.evaluate((to) => {
        const v = document.querySelector('video') as HTMLVideoElement;
        if (to !== undefined) v.currentTime = to;
        v.dispatchEvent(new Event('timeupdate'));
        return v.currentTime;
      }, seek);

    // Automatic: the sponsor is skipped, and one click brings it back.
    await tick(12);
    await expect.poll(() => tick()).toBe(20);
    await expect(page.getByRole('status')).toContainText('Atlandı: Sponsor');
    await page.getByRole('button', { name: 'Geri al' }).click();
    expect(await tick()).toBe(10);
    await tick(13);
    expect(await tick()).toBe(13);

    // Button: the intro waits for a click.
    await tick(31);
    expect(await tick()).toBe(31);
    await page.getByRole('button', { name: 'Atla: Giriş' }).click();
    expect(await tick()).toBe(40);

    // Off: self-promotion plays.
    await tick(51);
    expect(await tick()).toBe(51);

    const asked = hits.filter((h) => h.startsWith('sponsor.ajay.app'));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^sponsor\.ajay\.app\/api\/skipSegments\/5f6b\?categories=/);
    expect(asked.join()).not.toContain(VIDEO);
  } finally {
    sponsor.server.close();
  }
});
