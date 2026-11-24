/**
 * Downloads the built-in filter lists and compiles them into
 *   public/rulesets/<id>.json  DNR static ruleset (network filters)
 *   public/rulesets/<id>.popup.json  `$popup` filters for the popup guard
 *   public/rulesets/<id>.doc.json    page-blocking rules, to explain a blocked navigation
 *   public/engines/<id>.bin    serialized Ghostery cosmetic engine (element hiding)
 *   public/engines/default.bin the default lists' engine, merged here so startup never merges
 *   public/scriptlets/<id>.js  `+js()` rules as a string table for the page script
 *   public/rulesets/meta.json  versions and conversion statistics
 * Usage: node scripts/filters.ts [--offline] [--hits hosts.json]
 *   --offline reuses filters-cache/
 *   --hits    host -> crawled-site counts from scripts/brain-crawl.ts; if the default lists ever
 *             pass the browser's guaranteed 30,000 static rules, the least-seen rules go first
 */
import { FiltersEngine } from '@ghostery/adblocker';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { COSMETIC_ENGINE_CONFIG } from '../src/engines/adblock/engine-config.ts';
import { encodeTokens, usefulTokens } from '../src/engines/adblock/generic-tokens.ts';
import { compileScriptlets } from '../src/engines/adblock/scriptlets.ts';
import {
  compileList,
  fitBudget,
  shrinkCounts,
  withIds,
  type CompiledRule,
} from '../src/engines/adblock/network.ts';
import { BUILTIN_LISTS, strictHosts } from '../src/filters/catalog.ts';
import { safeCosmeticLines } from '../src/filters/custom.ts';
import type { BuiltinListMeta } from '../src/filters/meta.ts';
import { includesOf, preprocess } from '../src/filters/preprocess.ts';
import { listText } from '../src/filters/updates.ts';
import { dropExcluded } from './excluded.ts';
import { rejectedRegexes, type RegexQuery } from './regex-check.ts';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const cacheDir = resolve(root, 'filters-cache');
const rulesetDir = resolve(root, 'public/rulesets');
const engineDir = resolve(root, 'public/engines');
const scriptletDir = resolve(root, 'public/scriptlets');
const offline = process.argv.includes('--offline');
const hitsAt = process.argv.indexOf('--hits');
const hits = (
  hitsAt >= 0 ? JSON.parse(await readFile(process.argv[hitsAt + 1] ?? '', 'utf8')) : {}
) as Record<string, number>;
/** Chrome's guaranteed static rule count across enabled rulesets. */
const CORE_BUDGET = 30_000;

const cacheName = (url: string) => url.replace(/^https:\/\//, '').replace(/[^\w.-]+/g, '_');

async function fetchText(url: string): Promise<string> {
  const file = resolve(cacheDir, cacheName(url));
  if (offline) return dropExcluded(await readFile(file, 'utf8'));
  for (let attempt = 1; ; attempt++) {
    try {
      // Node 24's fetch dies on an internal assertion on some of these hosts, beyond any catch.
      const { stdout } = await run('curl', ['-sSLf', '--compressed', '-m', '120', url], {
        maxBuffer: 64 * 1024 * 1024,
      });
      await writeFile(file, stdout);
      return dropExcluded(stdout);
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function fetchIncludes(text: string, base: string, into: Map<string, string>): Promise<void> {
  for (const name of includesOf(text)) {
    const url = new URL(name, base);
    if (into.has(name) || url.origin !== new URL(base).origin) continue;
    const body = await fetchText(url.href);
    into.set(name, body);
    await fetchIncludes(body, url.href, into);
  }
}

const header = (text: string, key: string) =>
  new RegExp(`^!\\s*${key}:\\s*(.+)$`, 'mi').exec(text)?.[1]?.trim() ?? null;

await mkdir(cacheDir, { recursive: true });
await mkdir(rulesetDir, { recursive: true });
await mkdir(engineDir, { recursive: true });
await mkdir(scriptletDir, { recursive: true });

const meta: BuiltinListMeta[] = [];
const defaultCosmetic: string[] = [];
const compiled: { id: string; rules: CompiledRule[]; documentRules: CompiledRule[] }[] = [];
const genericTokens = new Set<number>();
for (const list of BUILTIN_LISTS) {
  const raw = await fetchText(list.url);
  const text = listText(list, raw);
  const includes = new Map<string, string>();
  await fetchIncludes(text, list.url, includes);
  const lines = preprocess(text, undefined, includes);

  const { rules, popupRules, documentRules, stats } = compileList(lines, {
    allowRegex: true,
    strictHosts: strictHosts(list),
  });
  compiled.push({ id: list.id, rules, documentRules });
  await writeFile(resolve(rulesetDir, `${list.id}.popup.json`), JSON.stringify(popupRules));

  // `##sel {css}` lines would join the grouped hiding rule and void every selector in it.
  const cosmetic = safeCosmeticLines(lines);
  if (list.defaultEnabled) defaultCosmetic.push(...cosmetic);
  const engine = FiltersEngine.parse(cosmetic.join('\n'), COSMETIC_ENGINE_CONFIG);
  const bin = engine.serialize();
  for (const h of usefulTokens(engine)) genericTokens.add(h);
  await writeFile(resolve(engineDir, `${list.id}.bin`), bin);

  const js = compileScriptlets(lines);
  if (list.scriptlets) {
    await writeFile(
      resolve(scriptletDir, `${list.id}.js`),
      `(self.__nexusSl||=[]).push(${JSON.stringify(js.table)});\n`,
    );
    console.log(
      `  scriptlets: ${js.rules} rules, ${js.skipped} skipped, ${Math.round(js.table.length / 1024)} KB`,
    );
  } else if (js.rules > 0) {
    throw new Error(`${list.id} has +js() rules; set scriptlets: true in the catalog`);
  }
  if (list.scriptlets && js.rules === 0)
    console.warn(`  ${list.id}: no +js() rules, drop the flag`);

  meta.push({
    id: list.id,
    version: header(text, 'Version') ?? header(text, 'Last modified') ?? header(text, 'Updated'),
    builtAt: new Date().toISOString(),
    lines: lines.length,
    includes: [...includes.keys()],
    engineBytes: bin.byteLength,
    stats,
  });
  console.log(
    `${list.id}: ${lines.length} lines, ${stats.converted}/${stats.networkFilters} network → ${stats.dnrRules} DNR + ${stats.popupRules} popup rules, ${stats.cosmetic} cosmetic, engine ${Math.round(bin.byteLength / 1024)} KB`,
  );
}
// Lowered counts can only widen a pattern, so whole-page rules are dropped instead of rewritten.
const queryOf = (r: CompiledRule, regex: string): RegexQuery => ({
  regex,
  isCaseSensitive: r.condition.isUrlFilterCaseSensitive ?? false,
});
const withRegex = compiled.flatMap((c) => c.rules.filter((r) => r.condition.regexFilter));
const first = await rejectedRegexes(
  withRegex.map((r) => queryOf(r, r.condition.regexFilter ?? '')),
);
let pending = withRegex.filter(
  (r, i) => first.has(i) && !r.condition.resourceTypes?.includes('main_frame'),
);
const dropped = new Set(withRegex.filter((_, i) => first.has(i)));
for (const level of [1, 2, 3] as const) {
  const bad = await rejectedRegexes(
    pending.map((r) => queryOf(r, shrinkCounts(r.condition.regexFilter ?? '', level))),
  );
  pending.forEach((r, i) => {
    if (bad.has(i)) return;
    r.condition.regexFilter = shrinkCounts(r.condition.regexFilter ?? '', level);
    dropped.delete(r);
  });
  pending = pending.filter((_, i) => bad.has(i));
}
console.log(
  `regex: ${withRegex.length} rules, ${first.size} over the browser's limit, ${dropped.size} dropped`,
);
const always = compiled
  .filter((c) => BUILTIN_LISTS.find((l) => l.id === c.id)?.defaultEnabled)
  .flatMap((c) => c.rules.filter((r) => !dropped.has(r)));
const core = new Set(fitBudget(always, CORE_BUDGET, hits));
for (const r of always) if (!core.has(r)) dropped.add(r);
console.log(
  `core: ${always.length} default rules, ${always.length - core.size} over the ${CORE_BUDGET} budget dropped`,
);
for (const { id, rules, documentRules } of compiled) {
  const kept = rules.filter((r) => !dropped.has(r));
  await writeFile(resolve(rulesetDir, `${id}.json`), JSON.stringify(withIds(kept, 1)));
  await writeFile(
    resolve(rulesetDir, `${id}.doc.json`),
    JSON.stringify(documentRules.filter((r) => !dropped.has(r))),
  );
  const entry = meta.find((m) => m.id === id);
  if (entry) entry.stats.dnrRules = kept.length;
}

await writeFile(
  resolve(engineDir, 'default.bin'),
  FiltersEngine.parse(defaultCosmetic.join('\n'), COSMETIC_ENGINE_CONFIG).serialize(),
);
await writeFile(
  resolve(root, 'public/content/generic-tokens.js'),
  `self.__nexusTokens=${JSON.stringify(encodeTokens(genericTokens))};\n`,
);
console.log(`generic tokens: ${genericTokens.size}`);
await writeFile(resolve(rulesetDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
