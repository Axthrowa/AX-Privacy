import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    // Brave writes this when a folder is loaded unpacked. It is not part of the package.
    if (ent.isDirectory()) {
      if (ent.name !== '_metadata') out.push(...(await files(path)));
    } else if (ent.isFile()) out.push(path);
  }
  return out;
}

/** Zip of `src` with forward-slash names at the archive root. shortcut: no Zip64, one file must stay under 4 GiB. */
export async function zipDirectory(src: string, dest: string): Promise<void> {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of (await files(src)).sort()) {
    const name = Buffer.from(relative(src, file).replaceAll('\\', '/'));
    const data = new Uint8Array(await readFile(file));
    const compressed = deflateRawSync(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x800),
      u16(8),
      u16(time),
      u16(date),
      u32(crc32(data)),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    locals.push(local);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x800),
        u16(8),
        u16(time),
        u16(date),
        u32(crc32(data)),
        u32(compressed.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  await writeFile(
    dest,
    Buffer.concat([
      ...locals,
      central,
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(centrals.length),
      u16(centrals.length),
      u32(central.length),
      u32(offset),
      u16(0),
    ]),
  );
}

export async function unzip(zipPath: string, dest: string): Promise<void> {
  const buf = await readFile(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end record missing');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extra + comment;
    if (name.endsWith('/')) continue;
    if (name.startsWith('/') || name.split('/').includes('..'))
      throw new Error(`zip: bad name ${name}`);
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const compressed = buf.subarray(dataAt, dataAt + size);
    const raw = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!raw) throw new Error(`zip: method ${method}`);
    const out = join(dest, name);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, raw);
  }
}
