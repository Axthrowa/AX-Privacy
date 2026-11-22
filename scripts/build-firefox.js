/**
 * AX-Privacy Firefox Build & Packager Script (MV3)
 * Converts root Chrome MV3 extension to Firefox MV3:
 *   - Background service_worker -> background.scripts with type: "module"
 *   - Adds browser_specific_settings.gecko with unique id and strict_min_version
 *   - Copies all assets (icons, popup, rules, scripts) to dist/firefox
 *   - Creates zip packages for both Firefox and Chrome
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const version = pkg.version;

const FIREFOX_DIR = path.join(ROOT_DIR, 'dist', 'firefox');
const CHROME_DIR = path.join(ROOT_DIR, 'dist', 'chrome');

// Clean and prepare output directories
fs.rmSync(FIREFOX_DIR, { recursive: true, force: true });
fs.rmSync(CHROME_DIR, { recursive: true, force: true });
fs.mkdirSync(FIREFOX_DIR, { recursive: true });
fs.mkdirSync(CHROME_DIR, { recursive: true });

// Read source manifest
const chromeManifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));

// Convert to Firefox MV3 Manifest
const firefoxManifest = JSON.parse(JSON.stringify(chromeManifest));

// 1. Background adaptation
if (firefoxManifest.background?.service_worker) {
  const sw = firefoxManifest.background.service_worker;
  firefoxManifest.background = {
    scripts: [sw],
    type: 'module'
  };
}

// 2. Browser specific settings
firefoxManifest.browser_specific_settings = {
  gecko: {
    id: 'ax-privacy@axthrowa.local',
    strict_min_version: '140.0',
    data_collection_permissions: {
      required: ['none']
    }
  },
  gecko_android: {
    strict_min_version: '142.0'
  }
};

// 3. Clean any chrome-only properties
delete firefoxManifest.minimum_chrome_version;

// Write manifests
fs.writeFileSync(path.join(FIREFOX_DIR, 'manifest.json'), JSON.stringify(firefoxManifest, null, 2) + '\n');
fs.writeFileSync(path.join(CHROME_DIR, 'manifest.json'), JSON.stringify(chromeManifest, null, 2) + '\n');

// Helper to recursively copy directories
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '_metadata' && entry.name !== '.git') {
        copyDir(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Assets to copy into distributions
const singleFiles = [
  'ax-brain.js',
  'background.js',
  'content.js',
  'popup-shield.js',
  'youtube-shield.js',
  'twitch-shield.js'
];

const directories = ['popup', 'icons', 'rules'];

for (const targetDir of [FIREFOX_DIR, CHROME_DIR]) {
  for (const file of singleFiles) {
    const src = path.join(ROOT_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(targetDir, file));
    }
  }
  for (const dir of directories) {
    const src = path.join(ROOT_DIR, dir);
    if (fs.existsSync(src)) {
      copyDir(src, path.join(targetDir, dir));
      // Minify JSON rules to ensure file size stays strictly under Mozilla AMO 5.0 MB limit
      if (dir === 'rules') {
        const destRulesDir = path.join(targetDir, 'rules');
        for (const rf of fs.readdirSync(destRulesDir)) {
          if (rf.endsWith('.json')) {
            const p = path.join(destRulesDir, rf);
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
            fs.writeFileSync(p, JSON.stringify(parsed));
          }
        }
      }
    }
  }
  if (fs.existsSync(path.join(ROOT_DIR, 'public', 'surrogates'))) {
    copyDir(path.join(ROOT_DIR, 'public', 'surrogates'), path.join(targetDir, 'surrogates'));
  }
}

console.log(`[build-firefox] Successfully synchronized files to dist/firefox and dist/chrome (v${version})`);

// CRC32 and Zip Implementation using built-in Node modules
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

function getFilesRecursively(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== '_metadata') {
        out.push(...getFilesRecursively(full));
      }
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function zipDirectory(srcDir, destZip) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;

  const allFiles = getFilesRecursively(srcDir).sort();

  for (const file of allFiles) {
    const relName = path.relative(srcDir, file).replace(/\\/g, '/');
    const nameBuf = Buffer.from(relName, 'utf8');
    const data = fs.readFileSync(file);
    const compressed = deflateRawSync(data);
    const fileCrc = crc32(data);

    const localHeader = Buffer.concat([
      u32(0x04034b50), // Local file header signature
      u16(20),         // Version needed
      u16(0x800),      // Flags (UTF-8)
      u16(8),          // Compression method (Deflate)
      u16(time),
      u16(date),
      u32(fileCrc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),          // Extra field length
      nameBuf
    ]);

    locals.push(localHeader, compressed);

    const centralHeader = Buffer.concat([
      u32(0x02014b50), // Central directory header signature
      u16(20),         // Version made by
      u16(20),         // Version needed
      u16(0x800),      // Flags (UTF-8)
      u16(8),          // Compression method (Deflate)
      u16(time),
      u16(date),
      u32(fileCrc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),          // Extra field length
      u16(0),          // File comment length
      u16(0),          // Disk number start
      u16(0),          // Internal file attributes
      u32(0),          // External file attributes
      u32(offset),     // Relative offset of local header
      nameBuf
    ]);

    centrals.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralSize = centrals.reduce((acc, b) => acc + b.length, 0);
  const endOfCentral = Buffer.concat([
    u32(0x06054b50),       // End of central directory signature
    u16(0),                // Number of this disk
    u16(0),                // Disk where central directory starts
    u16(allFiles.length),  // Number of central directory records on this disk
    u16(allFiles.length),  // Total number of central directory records
    u32(centralSize),      // Size of central directory
    u32(offset),           // Offset of start of central directory
    u16(0)                 // Comment length
  ]);

  const finalZipBuf = Buffer.concat([...locals, ...centrals, endOfCentral]);
  fs.writeFileSync(destZip, finalZipBuf);
  const stat = fs.statSync(destZip);
  console.log(`[build-firefox] Created package: ${destZip} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}

// Generate Zip packages
const firefoxZip = path.join(ROOT_DIR, 'dist', `ax-privacy-v${version}-firefox.zip`);
const chromeZip = path.join(ROOT_DIR, 'dist', `ax-privacy-v${version}-chrome.zip`);

zipDirectory(FIREFOX_DIR, firefoxZip);
zipDirectory(CHROME_DIR, chromeZip);

console.log('=== Firefox & Chrome packaging complete! ===');
