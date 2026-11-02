import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzip, zipDirectory } from '../../scripts/zip.ts';

describe('zip', () => {
  it('round-trips a nested file with a forward-slash name', async () => {
    const src = await mkdtemp(join(tmpdir(), 'nexus-zip-'));
    const out = join(tmpdir(), `nexus-out-${Date.now()}.zip`);
    const back = await mkdtemp(join(tmpdir(), 'nexus-unzip-'));
    try {
      await writeFile(join(src, 'manifest.json'), '{"name":"AX Privacy"}');
      await mkdir(join(src, 'rulesets'));
      await writeFile(join(src, 'rulesets', 'a.json'), '[]');
      await zipDirectory(src, out);
      await unzip(out, back);
      expect(await readFile(join(back, 'manifest.json'), 'utf8')).toBe('{"name":"AX Privacy"}');
      expect(await readFile(join(back, 'rulesets', 'a.json'), 'utf8')).toBe('[]');
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(back, { recursive: true, force: true });
      await rm(out, { force: true });
    }
  });
});
