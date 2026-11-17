import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { BrowserContext, Worker } from '@playwright/test';
import { expect, startServer, test } from './fixtures.ts';

// A local news page with the players the beta layer knows. Nothing leaves the machine: the ad
// server request is answered by the extension's own empty VAST before any connection is made.
const SITE = 'news.nexus-test.example';
let port = 0;
const MP4 = readFileSync(resolve(import.meta.dirname, '../public/surrogates/noop-1s.mp4'));

const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6,
content1.ts
#EXT-X-CUE-OUT:6
#EXTINF:6,
ad1.ts
#EXT-X-CUE-IN
#EXTINF:6,
content2.ts
#EXT-X-ENDLIST`;

const PAGE = `<!doctype html><title>haber</title>
<script>
window.jwplayer = function () {
  return { setup(config) { window.__jwConfig = JSON.stringify(config); return this; } };
};
window.jwplayer('p').setup({ file: 'a.m3u8', advertising: { client: 'vast' } });
window.Hls = function () {};
</script>
<div class="jw-flag-ads"><video id="ad" src="/ad.mp4" muted></video></div>
<video id="content" src="/ad.mp4"></video>`;

function handle(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/live.m3u8') {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    res.end(PLAYLIST);
  } else if (path === '/ad.mp4') {
    // Range answers make the clip seekable, as on any real video server.
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const start = m ? Number(m[1]) : 0;
    const end = m?.[2] ? Number(m[2]) : MP4.length - 1;
    res.writeHead(m ? 206 : 200, {
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
      ...(m && { 'content-range': `bytes ${start}-${end}/${MP4.length}` }),
    });
    res.end(MP4.subarray(start, end + 1));
  } else {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  }
}

let server: Awaited<ReturnType<typeof startServer>>['server'];
test.beforeAll(async () => {
  ({ server, port } = await startServer(handle));
});
test.afterAll(() => server.close());

async function turnOn(context: BrowserContext, extensionId: string, worker: Worker) {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#video`);
  await dash.getByRole('switch', { name: /Diğer sitelerdeki oynatıcılarda/ }).click();
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
      ),
    )
    .toContain('video-generic');
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id),
      ),
    )
    .toContain(14);
  await dash.close();
}

test('the beta player layer is off until chosen, then strips player ads', async ({
  context,
  extensionId,
  worker,
}) => {
  const url = `http://${SITE}:${port}/`;
  const playlist = async (page: import('@playwright/test').Page) =>
    page.evaluate(async () => {
      const viaFetch = await (await fetch('/live.m3u8')).text();
      const viaXhr = await new Promise<string>((done) => {
        const x = new XMLHttpRequest();
        x.open('GET', '/live.m3u8');
        x.onload = () => done(x.responseText);
        x.send();
      });
      return [viaFetch.includes('ad1.ts'), viaXhr.includes('ad1.ts')];
    });

  // Off by default: the page is left alone.
  const before = await context.newPage();
  await before.goto(url);
  expect(
    await before.evaluate(() => (window as unknown as { __jwConfig: string }).__jwConfig),
  ).toContain('advertising');
  expect(await playlist(before)).toEqual([true, true]);
  await before.close();

  await turnOn(context, extensionId, worker);
  const page = await context.newPage();
  await page.goto(url);
  expect(
    JSON.parse(await page.evaluate(() => (window as unknown as { __jwConfig: string }).__jwConfig)),
  ).toEqual({
    file: 'a.m3u8',
  });
  expect(await playlist(page)).toEqual([false, false]);
  // The ad video is wound to its end; the content video is not touched.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ad = document.getElementById('ad') as HTMLVideoElement;
        return ad.duration > 0 && ad.currentTime >= ad.duration - 0.01;
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => (document.getElementById('content') as HTMLVideoElement).currentTime),
  ).toBe(0);
  // FreeWheel's ad request gets "no ads" without reaching the network.
  const vast = await page.evaluate(
    () =>
      new Promise<string>((done) => {
        const x = new XMLHttpRequest();
        x.open('GET', 'https://ads1.v.fwmrm.net/ad/g/1?prof=test');
        x.onload = () => done(x.responseText);
        x.onerror = () => done('error');
        x.send();
      }),
  );
  expect(vast).toContain('<VAST');
});
