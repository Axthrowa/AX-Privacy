import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const BRAVE_PATH =
  process.env.BRAVE_PATH ?? 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
export const EXTENSION_DIR = resolve(import.meta.dirname, '../dist/chrome');
/** Content scripts registered with default settings, sorted by id. */
export const BASE_SCRIPTS = [
  'cosmetic',
  'gpc',
  'link-clean',
  'popups',
  'scriptlets',
  'tw-ads',
  'yt-ads',
  'yt-sponsored',
];
/** Fake hosts resolved to the local test server; nothing leaves the machine. */
export const TEST_HOSTS = [
  '*.nexus-test.example',
  '*.nexus-other.example',
  'www.googletagmanager.com',
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'www.twitch.tv',
  'edge.ads.twitch.tv',
  // The Twitch filter's token and playlist hosts: unreachable here, never the real service.
  'gql.twitch.tv',
  'usher.ttvnw.net',
];

/** sponsor.ajay.app is mapped here (its port included), so SponsorBlock lookups stay local. */
export const SPONSORBLOCK_TEST_PORT = 47443;

const TEST_PAGE = `<!doctype html><title>AX test</title>
<div class="nexus-test-ad">AD</div><div class="keep">KEEP</div>`;

/**
 * Launches Brave with a throwaway profile; never touches the user's real profile. Shields are off
 * in that profile so what gets blocked is AX's doing.
 */
export async function launchBrave(extensions: string[], args: string[] = []) {
  const profile = await mkdtemp(join(tmpdir(), 'nexus-e2e-'));
  await mkdir(join(profile, 'Default'));
  await writeFile(
    join(profile, 'Default', 'Preferences'),
    JSON.stringify({ profile: { default_content_setting_values: { braveShields: 2 } } }),
  );
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: BRAVE_PATH,
    headless: true,
    // HSTS-preloaded test hosts (youtube.com, twitch.tv) are served with a throwaway certificate.
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extensions.join(',')}`,
      `--load-extension=${extensions.join(',')}`,
      '--no-first-run',
      '--no-default-browser-check',
      // ignoreHTTPSErrors does not reach the extension service worker (SponsorBlock lookups).
      '--ignore-certificate-errors',
      `--host-resolver-rules=${[
        ...TEST_HOSTS.map((h) => `MAP ${h} 127.0.0.1`),
        `MAP sponsor.ajay.app 127.0.0.1:${SPONSORBLOCK_TEST_PORT}`,
      ].join(', ')}`,
      ...args,
    ],
  });
  return {
    context,
    async close() {
      await context.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

export async function startServer(
  handler: string | RequestListener = TEST_PAGE,
): Promise<{ origin: string; port: number; server: Server }> {
  const server = createServer(
    typeof handler === 'string'
      ? (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(handler);
        }
      : handler,
  );
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, port, server };
}

const OPENSSL = process.env.OPENSSL ?? 'C:/Program Files/Git/usr/bin/openssl.exe';

/** HTTPS twin of `startServer`, with a self-signed certificate made for this run only. */
export async function startHttpsServer(
  handler: RequestListener,
  port = 0,
): Promise<{ port: number; server: HttpsServer }> {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-cert-'));
  const [key, cert] = [join(dir, 'key.pem'), join(dir, 'cert.pem')];
  execFileSync(
    OPENSSL,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=nexus-test',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  );
  const server = createHttpsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    handler,
  );
  await rm(dir, { recursive: true, force: true });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  return { port: (server.address() as AddressInfo).port, server };
}

export const test = base.extend<{
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  origin: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const brave = await launchBrave([EXTENSION_DIR]);
    await use(brave.context);
    await brave.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
  // eslint-disable-next-line no-empty-pattern
  origin: async ({}, use) => {
    const { origin, server } = await startServer();
    await use(origin);
    server.close();
  },
});

export const expect = test.expect;
