import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CompiledRule, ListStats } from '../engines/adblock/network.ts';

export interface EngineBlob {
  name: string;
  version: string;
  updatedAt: number;
  data: ArrayBuffer;
}

export interface DailyStat {
  day: string;
  category: string;
  count: number;
}

export interface StoredList {
  url: string;
  text: string | null;
  fetchedAt: number | null;
  error: string | null;
  stats: ListStats | null;
}

/** A packaged list's difference from its newest download; only valid for the same extension version. */
export interface ListUpdate {
  id: string;
  version: string;
  fetchedAt: number;
  /** Per downloaded file, what to send so the server can answer "not modified". */
  validators: Record<string, string>;
  add: CompiledRule[];
  disableIds: number[];
  popupRules: CompiledRule[];
  documentRules: CompiledRule[];
}

interface NexusSchema extends DBSchema {
  engines: { key: string; value: EngineBlob };
  stats: { key: [string, string]; value: DailyStat; indexes: { byDay: string } };
  lists: { key: string; value: StoredList };
  updates: { key: string; value: ListUpdate };
}

export type NexusDB = IDBPDatabase<NexusSchema>;

export function openNexusDB(name = 'nexus'): Promise<NexusDB> {
  return openDB<NexusSchema>(name, 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('engines', { keyPath: 'name' });
        const stats = db.createObjectStore('stats', { keyPath: ['day', 'category'] });
        stats.createIndex('byDay', 'day');
      }
      if (oldVersion < 2) db.createObjectStore('lists', { keyPath: 'url' });
      if (oldVersion < 3) db.createObjectStore('updates', { keyPath: 'id' });
    },
  });
}

export function putEngine(db: NexusDB, blob: EngineBlob): Promise<string> {
  return db.put('engines', blob);
}

export function getEngine(db: NexusDB, name: string): Promise<EngineBlob | undefined> {
  return db.get('engines', name);
}

export function deleteEngine(db: NexusDB, name: string): Promise<void> {
  return db.delete('engines', name);
}

export function getUpdate(db: NexusDB, id: string): Promise<ListUpdate | undefined> {
  return db.get('updates', id);
}

export function putUpdate(db: NexusDB, update: ListUpdate): Promise<string> {
  return db.put('updates', update);
}

export function putList(db: NexusDB, list: StoredList): Promise<string> {
  return db.put('lists', list);
}

export function getList(db: NexusDB, url: string): Promise<StoredList | undefined> {
  return db.get('lists', url);
}

export function deleteList(db: NexusDB, url: string): Promise<void> {
  return db.delete('lists', url);
}

/** One transaction for a day's batch; one per key was waking IDB repeatedly. */
export async function addStats(
  db: NexusDB,
  day: string,
  entries: readonly [string, number][],
): Promise<void> {
  if (entries.length === 0) return;
  const tx = db.transaction('stats', 'readwrite');
  for (const [category, n] of entries) {
    const prev = await tx.store.get([day, category]);
    await tx.store.put({ day, category, count: (prev?.count ?? 0) + n });
  }
  await tx.done;
}

export function statsSince(db: NexusDB, fromDay: string): Promise<DailyStat[]> {
  return db.getAllFromIndex('stats', 'byDay', IDBKeyRange.lowerBound(fromDay));
}

export function clearStats(db: NexusDB): Promise<void> {
  return db.clear('stats');
}

export async function pruneStatsBefore(db: NexusDB, day: string): Promise<void> {
  const tx = db.transaction('stats', 'readwrite');
  let cursor = await tx.store.index('byDay').openCursor(IDBKeyRange.upperBound(day, true));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
