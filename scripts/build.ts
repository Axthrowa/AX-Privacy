import react from '@vitejs/plugin-react';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import { CONSENT_RULES_PATH, CONTENT_SCRIPT_FILES } from '../src/engines/core/control.ts';
import { toFirefoxManifest } from './manifest.ts';

const root = resolve(import.meta.dirname, '..');
const chromeOut = resolve(root, 'dist/chrome');
const firefoxOut = resolve(root, 'dist/firefox');

await rm(chromeOut, { recursive: true, force: true });
await rm(firefoxOut, { recursive: true, force: true });

await build({
  configFile: false,
  root: resolve(root, 'src/dashboard'),
  base: './',
  publicDir: resolve(root, 'public'),
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: chromeOut,
    emptyOutDir: false,
    modulePreload: false,
    // The background bundles the cosmetic engine; extension files load from disk, not network.
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      input: {
        popup: resolve(root, 'src/dashboard/popup.html'),
        dashboard: resolve(root, 'src/dashboard/dashboard.html'),
        blocked: resolve(root, 'src/dashboard/blocked.html'),
        background: resolve(root, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

// Content scripts cannot import modules, so each one is a self-contained IIFE.
for (const [name, file] of Object.entries(CONTENT_SCRIPT_FILES)) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir: resolve(chromeOut, 'content'),
      emptyOutDir: false,
      lib: {
        entry: resolve(root, `src/content/${name}.ts`),
        formats: ['iife'],
        name: `nexus_${name.replaceAll('-', '_')}`,
        fileName: () => file.replace('content/', ''),
      },
    },
  });
}

await cp(
  resolve(root, 'node_modules/@duckduckgo/autoconsent/rules/compact-rules.json'),
  resolve(chromeOut, CONSENT_RULES_PATH),
);

await cp(chromeOut, firefoxOut, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(chromeOut, 'manifest.json'), 'utf8'));
await writeFile(
  resolve(firefoxOut, 'manifest.json'),
  `${JSON.stringify(toFirefoxManifest(manifest), null, 2)}\n`,
);

console.log(`Built ${chromeOut}\nBuilt ${firefoxOut}`);
