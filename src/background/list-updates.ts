import { FiltersEngine } from '@ghostery/adblocker';
import { COSMETIC_ENGINE_CONFIG } from '../engines/adblock/engine-config.ts';
import {
  decodeTokens,
  encodeTokens,
  hasToken,
  usefulTokens,
} from '../engines/adblock/generic-tokens.ts';
import { compileList, type DnrRule } from '../engines/adblock/network.ts';
import { BUILTIN_LISTS, type BuiltinList } from '../filters/catalog.ts';
import { safeCosmeticLines } from '../filters/custom.ts';
import { includesOf, preprocess } from '../filters/preprocess.ts';
import { diffRules, fitRegexRules, listText, MIN_SIZE_RATIO } from '../filters/updates.ts';
import type { ListUpdateStatus } from '../shared/types.ts';
import { getEngine, getUpdate, putEngine, putUpdate, type EngineBlob } from '../storage/db.ts';
import { DEFAULT_SETTINGS, loadSettings } from '../storage/settings.ts';
import {
  db,
  fetchPackaged,
  readCapped,
  updateEngineName,
  USER_LIST_TIMEOUT_MS,
} from './filters.ts';

export const STATUS_KEY = 'listUpdateStatus';
export const EXTRA_TOKENS_KEY = 'genericTokensExtra';

const version = () => chrome.runtime.getManifest().version;

/** ETag or Last-Modified, stored with its kind so it goes back in the right request header. */
function validatorOf(res: Response): string {
  const etag = res.headers.get('etag');
  if (etag) return `e:${etag}`;
  const modified = res.headers.get('last-modified');
  return modified ? `m:${modified}` : '';
}

function validatorHeaders(validator: string | undefined): Record<string, string> {
  if (validator?.startsWith('e:')) return { 'if-none-match': validator.slice(2) };
  if (validator?.startsWith('m:')) return { 'if-modified-since': validator.slice(2) };
  return {};
}

const request = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, {
    cache: 'no-cache',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers,
    signal: AbortSignal.timeout(USER_LIST_TIMEOUT_MS),
  });

/** True if the server says nothing changed for any file of this list since the last download. */
async function unchanged(validators: Record<string, string>): Promise<boolean> {
  const urls = Object.keys(validators);
  if (urls.length === 0 || urls.some((u) => !validators[u])) return false;
  const answers = await Promise.all(urls.map((u) => request(u, validatorHeaders(validators[u]))));
  for (const res of answers) await res.body?.cancel();
  return answers.every((res) => res.status === 304);
}

async function download(url: string, validators: Record<string, string>): Promise<string> {
  const res = await request(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await readCapped(res);
  if (/^\s*</.test(text)) throw new Error('Filtre listesi değil (HTML döndü)');
  validators[url] = validatorOf(res);
  return text;
}

async function downloadIncludes(
  text: string,
  base: string,
  validators: Record<string, string>,
  into: Map<string, string>,
): Promise<void> {
  for (const name of includesOf(text)) {
    const url = new URL(name, base);
    if (into.has(name) || url.origin !== new URL(base).origin) continue;
    const body = await download(url.href, validators);
    into.set(name, body);
    await downloadIncludes(body, url.href, validators, into);
  }
}

const regexCheck = async (regex: string, isCaseSensitive: boolean) =>
  (await chrome.declarativeNetRequest.isRegexSupported({ regex, isCaseSensitive })).isSupported;

/** Downloads one list if it changed and stores its difference from the package. */
async function updateList(list: BuiltinList): Promise<{ added: number; removed: number } | null> {
  const d = await db();
  const prev = await getUpdate(d, list.id);
  if (prev?.version === version() && (await unchanged(prev.validators))) return null;

  const validators: Record<string, string> = {};
  const raw = await download(list.url, validators);
  const text = listText(list, raw);
  const includes = new Map<string, string>();
  await downloadIncludes(text, list.url, validators, includes);
  const lines = preprocess(text, undefined, includes);
  const { rules, popupRules, documentRules } = compileList(lines, { allowRegex: true });

  const bundled = await fetchPackaged<DnrRule[]>(`rulesets/${list.id}.json`, 'json');
  const fitted = await fitRegexRules(rules, regexCheck);
  if (fitted.length < bundled.length * MIN_SIZE_RATIO) {
    throw new Error(`Liste beklenenden çok küçük (${fitted.length}/${bundled.length} kural)`);
  }
  const { add, disableIds } = diffRules(bundled, fitted);

  const engine = FiltersEngine.parse(safeCosmeticLines(lines).join('\n'), COSMETIC_ENGINE_CONFIG);
  await saveEngine(updateEngineName(list.id), engine);
  await putUpdate(d, {
    id: list.id,
    version: version(),
    fetchedAt: Date.now(),
    validators,
    add,
    disableIds,
    popupRules,
    documentRules,
  });
  return { added: add.length, removed: disableIds.length };
}

async function saveEngine(name: string, engine: FiltersEngine): Promise<void> {
  const data = engine.serialize();
  const blob: EngineBlob = {
    name,
    version: version(),
    updatedAt: Date.now(),
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  };
  await putEngine(await db(), blob);
}

async function currentEngine(id: string): Promise<FiltersEngine> {
  const blob = await getEngine(await db(), updateEngineName(id));
  return FiltersEngine.deserialize(
    blob?.version === version()
      ? new Uint8Array(blob.data)
      : await fetchPackaged<Uint8Array>(`engines/${id}.bin`, 'bytes'),
  );
}

/**
 * Merged here, off the browsing path, so a page never waits for it. The new generic-rule words the
 * packaged table lacks are published for the content script.
 */
async function rebuildDefaults(): Promise<void> {
  const engines = await Promise.all(DEFAULT_SETTINGS.enabledLists.map(currentEngine));
  await saveEngine(updateEngineName('default'), FiltersEngine.merge(engines));
  const packaged = await (await fetch(chrome.runtime.getURL('content/generic-tokens.js'))).text();
  const table = decodeTokens(/"([^"]*)"/.exec(packaged)?.[1] ?? '');
  const everyList = await Promise.all(BUILTIN_LISTS.map((l) => currentEngine(l.id)));
  const extra = everyList.flatMap((e) => usefulTokens(e)).filter((h) => !hasToken(table, h));
  await chrome.storage.local.set({ [EXTRA_TOKENS_KEY]: encodeTokens(extra) });
}

let running: Promise<ListUpdateStatus> | null = null;

/** Brings every enabled list up to date. A list that fails keeps what it had. */
export function updateBuiltinLists(apply: () => Promise<void>): Promise<ListUpdateStatus> {
  running ??= (async () => {
    const s = await loadSettings();
    const status: ListUpdateStatus = {
      at: Date.now(),
      added: 0,
      removed: 0,
      changed: [],
      errors: {},
    };
    for (const list of BUILTIN_LISTS) {
      if (!s.enabledLists.includes(list.id)) continue;
      try {
        const result = await updateList(list);
        if (result) {
          status.changed.push(list.id);
          status.added += result.added;
          status.removed += result.removed;
        }
      } catch (e) {
        status.errors[list.id] = e instanceof Error ? e.message : String(e);
      }
    }
    if (status.changed.length > 0) {
      await rebuildDefaults();
      await apply();
    }
    await chrome.storage.local.set({ [STATUS_KEY]: status });
    return status;
  })().finally(() => {
    running = null;
  });
  return running;
}
