import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { unzip, zipDirectory } from './zip.ts';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  version: string;
};

const targets = ['chrome', 'firefox'] as const;
for (const name of targets) {
  const src = resolve(root, 'dist', name);
  const dest = resolve(root, 'dist', `ax-privacy-${version}-${name}.zip`);
  await zipDirectory(src, dest);
  const check = await mkdtemp(resolve(tmpdir(), 'nexus-pack-'));
  try {
    await unzip(dest, check);
    const manifest = JSON.parse(await readFile(resolve(check, 'manifest.json'), 'utf8')) as {
      version: string;
      name: string;
    };
    if (manifest.name !== 'AX Privacy' || manifest.version !== version) {
      throw new Error(`${name} zip manifest is ${manifest.name} ${manifest.version}`);
    }
  } finally {
    await rm(check, { recursive: true, force: true });
  }
  const bytes = (await stat(dest)).size;
  console.log(`${dest} (${Math.round(bytes / 1024 / 1024)} MB)`);
}
