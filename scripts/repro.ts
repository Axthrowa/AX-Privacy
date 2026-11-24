/**
 * Reproducible build check: builds and packs twice from the same tree and fails when any zip or
 * the SBOM differs between the two runs, so a published SHA-256 can be rebuilt from source.
 *
 * Usage: node scripts/repro.ts
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = (script: string) =>
  execFileSync('npm', ['run', script], {
    cwd: root,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

async function once(): Promise<string> {
  run('build');
  run('pack');
  return readFile(resolve(root, 'dist', 'SHA256SUMS'), 'utf8');
}

const first = await once();
const second = await once();
if (first !== second) {
  console.error(`Build is not reproducible:\n--- first\n${first}--- second\n${second}`);
  process.exit(1);
}
console.log(`Reproducible:\n${first}`);
