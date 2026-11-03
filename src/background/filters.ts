import { FiltersEngine } from '@ghostery/adblocker';
import { COSMETIC_ENGINE_CONFIG } from '../engines/adblock/engine-config.ts';
import { compileList, type CompiledRule } from '../engines/adblock/network.ts';
import { CONTROL_RULE_IDS } from '../engines/core/control.ts';
import { createPopupMatcher, type PopupMatcher } from '../engines/popup/matcher.ts';
import { BUILTIN_LISTS } from '../filters/catalog.ts';
import { safeCosmeticLines, splitRules } from '../filters/custom.ts';
import { buildDynamicRules, MAX_FILTER_RULES, type SourceReport } from '../filters/dynamic.ts';
import type { BuiltinListMeta } from '../filters/meta.ts';
import { preprocess } from '../filters/preprocess.ts';
import type { CustomRulesResult, ListsView, ListUpdateStatus, Settings } from '../shared/types.ts';
import {
  deleteEngine,
  deleteList,
  getEngine,
  getList,
  getUpdate,
  openNexusDB,
  putEngine,
  putList,
  type ListUpdate,
  type NexusDB,
} from '../storage/db.ts';
import { DEFAULT_SETTINGS, isValidListUrl } from '../storage/settings.ts';

export const USER_LIST_MAX_BYTES = 10 * 1024 * 1024;
export const USER_LIST_TIMEOUT_MS = 30_000;
/** Chrome's limit on static rules switched off at once, across all rulesets. */
const MAX_DISABLED_STATIC_RULES = 5_000;
const CUSTOM_SOURCE = 'custom';
const userEngineName = (url: string) => `user:${url}`;

let dbPromise: Promise<NexusDB> | null = null;
export const db = () => (dbPromise ??= openNexusDB());
export const updateEngineName = (id: string) => `update:${id}`;

/** The newest download of a packaged list, unless it was made for another extension version. */
async function liveUpdate(id: string): Promise<ListUpdate | null> {
  const update = await getUpdate(await db(), id);
  return update?.version === chrome.runtime.getManifest().version ? update : null;
}

/** Drops caches built from list updates; the next page rebuilds them. */
export function forgetFilterCaches(): void {
  engineCache = null;
  popupCache = null;
  documentCache = null;
}

export async function fetchPackaged<T>(path: string, as: 'json' | 'bytes'): Promise<T> {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (as === 'json' ? await res.json() : new Uint8Array(await res.arrayBuffer())) as T;
}

let metaPromise: Promise<BuiltinListMeta[]> | null = null;
const builtinMeta = () =>
  (metaPromise ??= fetchPackaged<BuiltinListMeta[]>('rulesets/meta.json', 'json'));

/** Lines of the enabled user lists that downloaded successfully, in settings order. */
async function userListLines(s: Settings): Promise<{ url: string; lines: string[] }[]> {
  const out = [];
  for (const ref of s.userLists) {
    if (!ref.enabled) continue;
    const stored = await getList(await db(), ref.url);
    if (stored?.text) out.push({ url: ref.url, lines: preprocess(stored.text) });
  }
  return out;
}

const REPORTS_KEY = 'filterReports';
const FILTER_RULES_KEY = 'lastFilterRules';

/** Survives service worker restarts but not browser restarts, matching when `applyFilters` runs. */
async function lastReports(): Promise<Map<string, SourceReport>> {
  const stored = await chrome.storage.session.get(REPORTS_KEY);
  return new Map(Object.entries((stored[REPORTS_KEY] ?? {}) as Record<string, SourceReport>));
}

let engineCache: { key: string; engine: Promise<FiltersEngine | null> } | null = null;
let popupCache: { key: string; matcher: Promise<PopupMatcher> } | null = null;

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(hash).join();
}

function cacheKey(s: Settings, fetched: readonly (number | null)[]): string {
  return JSON.stringify([s.enabledLists, s.customRules, s.userLists, fetched]);
}

async function userFetchTimes(s: Settings): Promise<(number | null)[]> {
  const d = await db();
  return Promise.all(s.userLists.map(async (l) => (await getList(d, l.url))?.fetchedAt ?? null));
}

/**
 * Pushes the filter part of the settings into the browser: static rulesets on or off, custom and
 * user-list rules as dynamic rules. Control rules (IDs < 1000) are left alone.
 */
export async function applyFilters(s: Settings): Promise<void> {
  const enabled = new Set(s.enabledLists);
  const current = new Set(await chrome.declarativeNetRequest.getEnabledRulesets());
  const enableRulesetIds = BUILTIN_LISTS.map((l) => l.id).filter(
    (id) => enabled.has(id) && !current.has(id),
  );
  const disableRulesetIds = [...current].filter((id) => !enabled.has(id));
  if (enableRulesetIds.length || disableRulesetIds.length) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds,
    });
  }

  const updates = (
    await Promise.all(BUILTIN_LISTS.filter((l) => enabled.has(l.id)).map((l) => liveUpdate(l.id)))
  ).filter((u): u is ListUpdate => u !== null);
  const sources = [
    { name: CUSTOM_SOURCE, lines: splitRules(s.customRules).network },
    ...(await userListLines(s)).map((l) => ({ name: l.url, lines: l.lines })),
  ];
  const build = await buildDynamicRules(
    sources,
    async (regex, isCaseSensitive) =>
      (await chrome.declarativeNetRequest.isRegexSupported({ regex, isCaseSensitive })).isSupported,
    updates.flatMap((u) => u.add),
  );
  // Only a digest: session storage holds 10 MB, and one big list can compile to more than that.
  const payload = await sha256(JSON.stringify(build.rules));
  const prev = (await chrome.storage.session.get(FILTER_RULES_KEY))[FILTER_RULES_KEY];
  if (prev !== payload) {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id).filter((id) => !CONTROL_RULE_IDS.includes(id)),
      addRules: build.rules as chrome.declarativeNetRequest.Rule[],
    });
    await chrome.storage.session.set({ [FILTER_RULES_KEY]: payload });
  }

  // After the additions: if those fail, old rules stay on instead of leaving a gap.
  // A rule the list dropped stays on once this limit is reached: stale, not missing protection.
  let disableBudget = MAX_DISABLED_STATIC_RULES;
  for (const list of BUILTIN_LISTS) {
    if (!enabled.has(list.id)) continue;
    const update = updates.find((u) => u.id === list.id);
    const want = (update?.disableIds ?? []).slice(0, disableBudget);
    disableBudget -= want.length;
    const have = await chrome.declarativeNetRequest.getDisabledRuleIds({ rulesetId: list.id });
    const wanted = new Set(want);
    const off = want.filter((id) => !have.includes(id));
    const on = have.filter((id) => !wanted.has(id));
    if (off.length || on.length) {
      await chrome.declarativeNetRequest.updateStaticRules({
        rulesetId: list.id,
        disableRuleIds: off,
        enableRuleIds: on,
      });
    }
  }

  await chrome.storage.session.set({ [REPORTS_KEY]: Object.fromEntries(build.reports) });
  const key = cacheKey(s, await userFetchTimes(s));
  if (engineCache?.key !== key) {
    engineCache = null;
    popupCache = null;
    documentCache = null;
  }
}

async function buildCosmeticEngine(s: Settings): Promise<FiltersEngine | null> {
  const engines: FiltersEngine[] = [];
  // Merging costs far more than loading, so the default set is merged once, at build time.
  const defaults = DEFAULT_SETTINGS.enabledLists;
  const isDefault =
    s.enabledLists.length === defaults.length &&
    defaults.every((id) => s.enabledLists.includes(id));
  const d = await db();
  const thisVersion = chrome.runtime.getManifest().version;
  for (const id of isDefault ? ['default'] : s.enabledLists) {
    const updated = await getEngine(d, updateEngineName(id));
    engines.push(
      FiltersEngine.deserialize(
        updated?.version === thisVersion
          ? new Uint8Array(updated.data)
          : await fetchPackaged<Uint8Array>(`engines/${id}.bin`, 'bytes'),
      ),
    );
  }
  for (const ref of s.userLists) {
    const blob = ref.enabled ? await getEngine(d, userEngineName(ref.url)) : undefined;
    if (!blob) continue;
    try {
      engines.push(FiltersEngine.deserialize(new Uint8Array(blob.data)));
    } catch {
      // Engine format changed with an update; the next list refresh rebuilds it.
    }
  }
  const custom = splitRules(s.customRules).cosmetic;
  if (custom.length) engines.push(FiltersEngine.parse(custom.join('\n'), COSMETIC_ENGINE_CONFIG));
  if (engines.length === 0) return null;
  return engines.length === 1 ? (engines[0] ?? null) : FiltersEngine.merge(engines);
}

export async function cosmeticEngine(s: Settings): Promise<FiltersEngine | null> {
  const key = cacheKey(s, await userFetchTimes(s));
  if (engineCache?.key !== key) {
    const engine = buildCosmeticEngine(s);
    engineCache = { key, engine };
    engine.catch(() => {
      if (engineCache?.engine === engine) engineCache = null;
    });
  }
  return engineCache.engine;
}

export async function popupMatcher(s: Settings): Promise<PopupMatcher> {
  const key = cacheKey(s, await userFetchTimes(s));
  if (popupCache?.key !== key) {
    const matcher = (async () => {
      const rules = compileList(splitRules(s.customRules).network, { allowRegex: true }).popupRules;
      for (const l of await userListLines(s)) {
        rules.push(...compileList(l.lines, { allowRegex: true }).popupRules);
      }
      for (const id of s.enabledLists) {
        const update = await liveUpdate(id);
        rules.push(
          ...(update?.popupRules ??
            (await fetchPackaged<CompiledRule[]>(`rulesets/${id}.popup.json`, 'json'))),
        );
      }
      return createPopupMatcher(rules);
    })();
    popupCache = { key, matcher };
    matcher.catch(() => {
      if (popupCache?.matcher === matcher) popupCache = null;
    });
  }
  return popupCache.matcher;
}

interface DocumentSource {
  name: string;
  blocks: PopupMatcher;
}

let documentCache: {
  key: string;
  sources: Promise<{ all: PopupMatcher; lists: DocumentSource[] }>;
} | null = null;

async function buildDocumentSources(s: Settings) {
  const sources: { name: string; rules: CompiledRule[] }[] = [
    {
      name: 'Özel kurallar',
      rules: compileList(splitRules(s.customRules).network, { allowRegex: true }).documentRules,
    },
  ];
  for (const l of await userListLines(s)) {
    sources.push({ name: l.url, rules: compileList(l.lines, { allowRegex: true }).documentRules });
  }
  for (const list of BUILTIN_LISTS) {
    if (!s.enabledLists.includes(list.id)) continue;
    sources.push({
      name: list.name,
      rules:
        (await liveUpdate(list.id))?.documentRules ??
        (await fetchPackaged<CompiledRule[]>(`rulesets/${list.id}.doc.json`, 'json')),
    });
  }
  return {
    all: createPopupMatcher(sources.flatMap((x) => x.rules)),
    lists: sources.map((x) => ({ name: x.name, blocks: createPopupMatcher(x.rules) })),
  };
}

/**
 * Name of the enabled list whose page-blocking rule matches `url`, or null if none of ours would
 * block it (exceptions from every list count, as they do in DNR).
 */
export async function blockingList(s: Settings, url: string): Promise<string | null> {
  const key = cacheKey(s, await userFetchTimes(s));
  if (documentCache?.key !== key) {
    const sources = buildDocumentSources(s);
    documentCache = { key, sources };
    sources.catch(() => {
      if (documentCache?.sources === sources) documentCache = null;
    });
  }
  const { all, lists } = await documentCache.sources;
  if (!all(url, url)) return null;
  return lists.find((l) => l.blocks(url, url))?.name ?? null;
}

export async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > USER_LIST_MAX_BYTES) throw new Error('Liste 10 MB sınırını aşıyor');
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > USER_LIST_MAX_BYTES) {
      await reader.cancel();
      throw new Error('Liste 10 MB sınırını aşıyor');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

/** Downloads a user list, stores its text and a prebuilt cosmetic engine. Errors are stored too. */
export async function refreshUserList(url: string): Promise<void> {
  const d = await db();
  const prev = await getList(d, url);
  try {
    const res = await fetch(url, {
      cache: 'no-cache',
      credentials: 'omit',
      signal: AbortSignal.timeout(USER_LIST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!isValidListUrl(res.url)) throw new Error('Güvenli olmayan bir adrese yönlendirildi');
    const text = await readCapped(res);
    if (/^\s*</.test(text)) throw new Error('Filtre listesi değil (HTML döndü)');
    const lines = preprocess(text);
    const { stats } = compileList(lines, { allowRegex: true });
    const engine = FiltersEngine.parse(safeCosmeticLines(lines).join('\n'), COSMETIC_ENGINE_CONFIG);
    const data = engine.serialize();
    await putEngine(d, {
      name: userEngineName(url),
      version: '1',
      updatedAt: Date.now(),
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    });
    await putList(d, { url, text, fetchedAt: Date.now(), error: null, stats });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await putList(d, {
      url,
      text: prev?.text ?? null,
      fetchedAt: prev?.fetchedAt ?? null,
      error,
      stats: prev?.stats ?? null,
    });
  }
}

export async function forgetUserList(url: string): Promise<void> {
  const d = await db();
  await deleteList(d, url);
  await deleteEngine(d, userEngineName(url));
}

export async function listsView(s: Settings): Promise<ListsView> {
  const meta = new Map((await builtinMeta()).map((m) => [m.id, m]));
  const d = await db();
  const dynamic = await chrome.declarativeNetRequest.getDynamicRules();
  const reports = await lastReports();
  return {
    builtin: BUILTIN_LISTS.map((l) => ({
      id: l.id,
      name: l.name,
      category: l.category,
      buildOnly: l.buildOnly === true,
      homepage: l.homepage,
      license: l.license,
      enabled: s.enabledLists.includes(l.id),
      version: meta.get(l.id)?.version ?? null,
      builtAt: meta.get(l.id)?.builtAt ?? null,
      stats: meta.get(l.id)?.stats ?? null,
    })),
    user: await Promise.all(
      s.userLists.map(async (ref) => {
        const stored = await getList(d, ref.url);
        const report = reports.get(ref.url);
        return {
          ...ref,
          fetchedAt: stored?.fetchedAt ?? null,
          error: stored?.error ?? null,
          stats: report?.stats ?? stored?.stats ?? null,
          truncated: report?.truncated ?? 0,
        };
      }),
    ),
    updates: {
      auto: s.autoUpdateLists,
      status:
        ((await chrome.storage.local.get('listUpdateStatus')).listUpdateStatus as
          ListUpdateStatus | undefined) ?? null,
    },
    availableStaticRules: await chrome.declarativeNetRequest.getAvailableStaticRuleCount(),
    dynamicRules: dynamic.filter((r) => !CONTROL_RULE_IDS.includes(r.id)).length,
    maxDynamicRules: MAX_FILTER_RULES,
  };
}

/** Report for the custom rules box, including regexes the browser rejected on the last apply. */
export async function customRulesReport(s: Settings): Promise<CustomRulesResult> {
  const split = splitRules(s.customRules);
  const report = (await lastReports()).get(CUSTOM_SOURCE);
  const regexRejected = report?.stats.unsupported.regex ?? 0;
  return {
    network: split.network.length - regexRejected,
    cosmetic: split.cosmetic.length,
    rejected: [
      ...split.rejected,
      ...(regexRejected
        ? [
            {
              line: `${regexRejected} regex kuralı`,
              reason: 'Tarayıcının regex motoru desteklemiyor',
            },
          ]
        : []),
      ...(report?.truncated
        ? [{ line: `${report.truncated} kural`, reason: 'Dinamik kural kotası doldu' }]
        : []),
    ],
  };
}
