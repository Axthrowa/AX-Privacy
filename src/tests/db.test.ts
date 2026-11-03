import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  addStats,
  clearStats,
  getEngine,
  openNexusDB,
  type NexusDB,
  pruneStatsBefore,
  putEngine,
  statsSince,
} from '../storage/db.ts';

let n = 0;
const freshDb = () => openNexusDB(`test-${n++}`);

describe('engines store', () => {
  it('round-trips binary engine blobs', async () => {
    const db = await freshDb();
    const data = new Uint8Array([1, 2, 3]).buffer;
    await putEngine(db, { name: 'cosmetic', version: '1', updatedAt: 5, data });
    const got = await getEngine(db, 'cosmetic');
    expect(got && new Uint8Array(got.data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await getEngine(db, 'missing')).toBeUndefined();
  });
});

const addStat = (db: NexusDB, day: string, category: string, n: number) =>
  addStats(db, day, [[category, n]]);

describe('stats store', () => {
  it('accumulates counts per day and category', async () => {
    const db = await freshDb();
    await addStat(db, '2026-11-01', 'ads', 2);
    await addStat(db, '2026-11-01', 'ads', 3);
    await addStat(db, '2026-11-01', 'trackers', 1);
    await addStat(db, '2026-11-02', 'ads', 7);
    const all = await statsSince(db, '2026-11-01');
    expect(all).toEqual(
      expect.arrayContaining([
        { day: '2026-11-01', category: 'ads', count: 5 },
        { day: '2026-11-01', category: 'trackers', count: 1 },
        { day: '2026-11-02', category: 'ads', count: 7 },
      ]),
    );
    expect(await statsSince(db, '2026-11-02')).toEqual([
      { day: '2026-11-02', category: 'ads', count: 7 },
    ]);
  });

  it('prunes days older than the retention cutoff', async () => {
    const db = await freshDb();
    await addStat(db, '2026-10-01', 'ads', 1);
    await addStat(db, '2026-11-01', 'ads', 1);
    await pruneStatsBefore(db, '2026-11-01');
    expect(await statsSince(db, '2000-01-01')).toEqual([
      { day: '2026-11-01', category: 'ads', count: 1 },
    ]);
  });

  it('writes a day batch in one pass', async () => {
    const db = await freshDb();
    await addStats(db, '2026-11-01', [
      ['ads', 2],
      ['trackers', 3],
      ['ads', 1],
    ]);
    expect(await statsSince(db, '2026-11-01')).toEqual(
      expect.arrayContaining([
        { day: '2026-11-01', category: 'ads', count: 3 },
        { day: '2026-11-01', category: 'trackers', count: 3 },
      ]),
    );
  });

  it('clears every stored count', async () => {
    const db = await freshDb();
    await addStat(db, '2026-11-01', 'requests', 4);
    await clearStats(db);
    expect(await statsSince(db, '2000-01-01')).toEqual([]);
  });
});
