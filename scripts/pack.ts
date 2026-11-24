import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { unzip, zipDirectory } from './zip.ts';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  version: string;
};

const targets = ['chrome', 'firefox'] as const;
const sums: string[] = [];
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
  // sha256sum format, so `sha256sum -c SHA256SUMS` verifies a download.
  sums.push(
    `${createHash('sha256')
      .update(await readFile(dest))
      .digest('hex')}  ${basename(dest)}`,
  );
  const bytes = (await stat(dest)).size;
  console.log(`${dest} (${Math.round(bytes / 1024 / 1024)} MB)`);
}
// Software bill of materials: every runtime package that ends up in the zips (CycloneDX).
// Time and serial number are dropped, so the same lock file always gives the same file.
const sbomName = `ax-privacy-${version}.cdx.json`;
const sbom = JSON.parse(
  execFileSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  }),
) as { serialNumber?: string; metadata: { timestamp?: string; component?: { name?: string } } };
delete sbom.serialNumber;
delete sbom.metadata.timestamp;
if (sbom.metadata.component) sbom.metadata.component.name = 'ax-privacy';
const sbomText = `${JSON.stringify(sbom, null, 2)}\n`;
await writeFile(resolve(root, 'dist', sbomName), sbomText);
sums.push(`${createHash('sha256').update(sbomText).digest('hex')}  ${sbomName}`);

await writeFile(resolve(root, 'dist', 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(sums.join('\n'));
