import react from '@vitejs/plugin-react';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import {
  CONSENT_RULES_JS,
  CONTENT_SCRIPT_FILES,
  AD_MODES,
  adModeFile,
  FP_SEED_DIGITS,
  fpSeedFile,
  YT_SPONSORED_CSS,
  YT_SPONSORED_HIDE_CSS,
} from '../src/engines/core/control.ts';
import { sponsoredCss } from '../src/engines/video/youtube.ts';
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
        // AX-Brain layer 3 runs the Prompt API here; workers do not get it.
        nano: resolve(root, 'src/dashboard/nano.html'),
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

// A string, parsed only by a frame that asks for rules; JSON.parse beats a literal this size.
const consentRules = await readFile(
  resolve(root, 'node_modules/@duckduckgo/autoconsent/rules/compact-rules.json'),
  'utf8',
);
await writeFile(
  resolve(chromeOut, CONSENT_RULES_JS),
  `self.__axConsentRules = ${JSON.stringify(JSON.stringify(JSON.parse(consentRules)))};
`,
);

// Sponsored-card stylesheets come from the YouTube data file, so a renamed element is a data edit.
await writeFile(resolve(chromeOut, YT_SPONSORED_CSS), sponsoredCss('mark'));
await writeFile(resolve(chromeOut, YT_SPONSORED_HIDE_CSS), sponsoredCss('hide'));

// One digit each; the worker registers a random ordered pick per browser session (see control.ts).
await mkdir(resolve(chromeOut, 'content/fp-seed'), { recursive: true });
for (let d = 0; d < FP_SEED_DIGITS; d++) {
  await writeFile(resolve(chromeOut, fpSeedFile(d)), `(self.__axSeed ??= []).push(${d});\n`);
}

await mkdir(resolve(chromeOut, 'content/ad-mode'), { recursive: true });
for (const m of AD_MODES) {
  await writeFile(
    resolve(chromeOut, adModeFile(m)),
    `(self.__axAdModes ??= []).push('${m}');
`,
  );
}

// package.json is the one place the version is written; both manifests take it from there.
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  version: string;
};
const manifest = {
  ...JSON.parse(await readFile(resolve(chromeOut, 'manifest.json'), 'utf8')),
  version,
};
await writeFile(
  resolve(chromeOut, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}
`,
);
await cp(chromeOut, firefoxOut, { recursive: true });
await writeFile(
  resolve(firefoxOut, 'manifest.json'),
  `${JSON.stringify(toFirefoxManifest(manifest), null, 2)}\n`,
);

console.log(`Built ${chromeOut}\nBuilt ${firefoxOut}`);
