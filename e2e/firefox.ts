/**
 * End-to-end smoke test of dist/firefox in a real Firefox. Playwright's Firefox cannot load
 * extensions, so this drives Firefox's built-in WebDriver BiDi directly (webExtension.install).
 * Every hostname resolves to 127.0.0.1 in the throwaway profile: nothing leaves the machine.
 * Usage: npm run build && node e2e/firefox.ts   (FIREFOX_PATH overrides the binary)
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FIREFOX_ID } from '../scripts/manifest.ts';

const FIREFOX = process.env.FIREFOX_PATH ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
const EXTENSION = process.env.AX_FIREFOX_DIR ?? resolve(import.meta.dirname, '../dist/firefox');
const PLAYER = { videoDetails: { videoId: 'nexus' }, adPlacements: [{}], playerAds: [{}] };
const hits: string[] = [];
const server = createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0] ?? '';
  hits.push(`${host}${req.url ?? ''}`);
  const send = (type: string, body: string) => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  };
  if (req.url?.endsWith('.js')) send('application/javascript', 'window.__loaded = true;');
  else if (host === 'www.youtube.com') {
    send(
      'text/html; charset=utf-8',
      `<!doctype html><script>var ytInitialPlayerResponse = ${JSON.stringify(PLAYER)};</script>
<ytd-rich-item-renderer id="ad-card"><ad-badge-view-model>Sponsorlu</ad-badge-view-model></ytd-rich-item-renderer>`,
    );
  } else {
    send(
      'text/html; charset=utf-8',
      `<!doctype html><div id="div-gpt-ad-1">ad</div><div id="keep">keep</div>`,
    );
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const port = (server.address() as AddressInfo).port;

const profile = await mkdtemp(join(tmpdir(), 'nexus-firefox-'));
const prefs: Record<string, string | number | boolean> = {
  'network.dns.forceResolve': '127.0.0.1',
  'network.proxy.type': 0,
  'network.stricttransportsecurity.preloadlist': false,
  'dom.security.https_first': false,
  'dom.security.https_first_pbm': false,
  'dom.security.https_only_mode': false,
  'extensions.originControls.grantByDefault': true,
  'browser.shell.checkDefaultBrowser': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.enabled': false,
  'app.update.disabledForTesting': true,
  'toolkit.startup.max_resumed_crashes': -1,
};
await writeFile(
  join(profile, 'user.js'),
  Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join('\n'),
);

const firefox = spawn(
  FIREFOX,
  ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', '0'],
  // Safe mode would start with extensions disabled; test harnesses turn the automatic switch off.
  { env: { ...process.env, MOZ_DISABLE_AUTO_SAFE_MODE: '1' } },
);
// On Windows firefox.exe is a launcher; the browser is its child, so the whole tree is ended.
const killFirefox = () =>
  process.platform === 'win32' && firefox.pid !== undefined
    ? new Promise((done) =>
        spawn('taskkill', ['/T', '/F', '/PID', String(firefox.pid)]).on('exit', done),
      )
    : Promise.resolve(firefox.kill());
const deadline = setTimeout(() => {
  console.log('FAIL timeout: Firefox did not finish in 3 minutes');
  void killFirefox().then(() => process.exit(1));
}, 180_000);
const wsUrl = await new Promise<string>((done, fail) => {
  let out = '';
  const onData = (d: Buffer) => {
    out += d.toString();
    const m = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(out);
    if (m?.[1]) done(m[1]);
  };
  firefox.stderr.on('data', onData);
  firefox.stdout.on('data', onData);
  firefox.on('exit', () => fail(new Error(`Firefox exited:\n${out}`)));
});

const ws = new WebSocket(`${wsUrl}/session`);
await new Promise((done) => ws.addEventListener('open', done, { once: true }));
let nextId = 1;
const pending = new Map<
  number,
  (m: { result?: unknown; error?: string; message?: string }) => void
>();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: string };
  if (m.id !== undefined) pending.get(m.id)?.(m);
});
async function bidi<T>(method: string, params: object): Promise<T> {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  const m = await new Promise<{ result?: unknown; error?: string; message?: string }>((done) =>
    pending.set(id, done),
  );
  if (m.error) throw new Error(`${method}: ${m.error} ${m.message ?? ''}`);
  return m.result as T;
}

let context = '';
const navigate = (url: string) =>
  bidi('browsingContext.navigate', { context, url, wait: 'complete' });
/** Evaluates `expr` (an expression producing JSON-serialisable data) in the page. */
async function evaluate<T>(expr: string): Promise<T> {
  const r = await bidi<{ type: string; result?: { value?: string }; exceptionDetails?: unknown }>(
    'script.evaluate',
    {
      expression: `(async () => JSON.stringify(await (${expr})))()`,
      target: { context },
      awaitPromise: true,
    },
  );
  if (r.type !== 'success') throw new Error(`evaluate failed: ${JSON.stringify(r)}`);
  return JSON.parse(r.result?.value ?? 'null') as T;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await sleep(250);
    v = await fn();
  }
  return v;
}

const results: { name: string; pass: boolean; detail: unknown }[] = [];
const check = (name: string, pass: boolean, detail: unknown) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${pass ? '' : JSON.stringify(detail)}`);
};

try {
  const session = await bidi<{ capabilities: { browserName: string; browserVersion: string } }>(
    'session.new',
    { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } },
  );
  console.log(`${session.capabilities.browserName} ${session.capabilities.browserVersion}`);
  const installed = await bidi<{ extension: string }>('webExtension.install', {
    extensionData: { type: 'path', path: EXTENSION },
  });
  check('extension installs', installed.extension === FIREFOX_ID, installed);
  const tree = await bidi<{ contexts: { context: string }[] }>('browsingContext.getTree', {});
  context = tree.contexts[0]?.context ?? '';

  const site = `http://www.nexus-test.example:${port}/`;
  const page = await poll(
    async () => {
      await navigate(site);
      return evaluate<{ hidden: boolean; keep: boolean }>(`({
        hidden: getComputedStyle(document.getElementById('div-gpt-ad-1')).display === 'none',
        keep: getComputedStyle(document.getElementById('keep')).display !== 'none',
      })`);
    },
    (v) => v.hidden,
    20_000,
  );
  check('element hiding from the built-in lists', page.hidden && page.keep, page);

  const load = (src: string) =>
    evaluate<string>(`new Promise((done) => {
      const s = document.createElement('script');
      s.src = ${JSON.stringify(src)};
      s.onload = () => done('load');
      s.onerror = () => done('error');
      document.head.append(s);
    })`);
  const ad = await load(`http://pagead2.googlesyndication.com:${port}/pagead/js/adsbygoogle.js`);
  const own = await load(`/static/app.js`);
  check('network blocking (ad blocked, first party loads)', ad === 'error' && own === 'load', {
    ad,
    own,
    reachedServer: hits.filter((h) => h.startsWith('pagead2')),
  });

  await navigate(`http://www.youtube.com:${port}/watch?v=nexus`);
  const yt = await evaluate<{ keys: string[]; native: string; untouched: string }>(`({
    keys: Object.keys(window.ytInitialPlayerResponse).sort(),
    native: Function.prototype.toString.call(JSON.parse),
    untouched: Function.prototype.toString.call(JSON.stringify).replace('stringify', 'parse'),
  })`);
  check(
    'YouTube ad schedule removed (MAIN-world script), wrappers look native',
    yt.keys.join() === 'videoDetails' && yt.native === yt.untouched,
    yt,
  );

  const outline = await evaluate<string>(
    `getComputedStyle(document.getElementById('ad-card')).outlineStyle`,
  );
  check('sponsored card marked (CSS-only registered script)', outline === 'dashed', outline);
} catch (e) {
  check('run', false, e instanceof Error ? e.message : String(e));
} finally {
  clearTimeout(deadline);
  ws.close();
  await killFirefox();
  server.close();
  await sleep(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.pass) ? 0 : 1;
