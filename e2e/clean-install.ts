/**
 * Loads the Chrome zip in a throwaway Brave profile (not the user's profile) and checks that
 * the lists are on and a known tracker does not run. Usage: npm run pack && node e2e/clean-install.ts
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchBrave, startServer } from './fixtures.ts';
import { unzip } from '../scripts/zip.ts';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
  version: string;
};
const zip = join(root, 'dist', `ax-privacy-${version}-chrome.zip`);
const dir = await mkdtemp(join(tmpdir(), 'nexus-clean-'));
await unzip(zip, dir);

const { port, server } = await startServer('<!doctype html><title>clean</title>');
const brave = await launchBrave([dir]);
try {
  const worker =
    brave.context.serviceWorkers()[0] ?? (await brave.context.waitForEvent('serviceworker'));
  const info = await worker.evaluate(async () => ({
    version: chrome.runtime.getManifest().version,
    rules: await chrome.declarativeNetRequest.getEnabledRulesets(),
  }));
  if (info.version !== version) throw new Error(`version ${info.version}`);
  if (!info.rules.includes('easylist') || !info.rules.includes('easyprivacy')) {
    throw new Error(`rules ${info.rules.join(',')}`);
  }
  const id = new URL(worker.url()).host;
  const dash = await brave.context.newPage();
  await dash.goto(`chrome-extension://${id}/dashboard.html#about`);
  await dash.getByText('Geçmiş sunucuya gitmez.').waitFor();

  const page = await brave.context.newPage();
  await page.goto(`http://site.nexus-test.example:${port}/`);
  const loaded = await page.evaluate(
    (src) =>
      new Promise<boolean>((done) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => done(true);
        s.onerror = () => done(false);
        document.head.append(s);
      }),
    `http://www.googletagmanager.com:${port}/gtm.js`,
  );
  if (loaded) throw new Error('tracker script was not blocked');
  console.log(`clean install ${version}: lists on, tracker blocked, about page opened`);
} finally {
  server.close();
  await brave.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
