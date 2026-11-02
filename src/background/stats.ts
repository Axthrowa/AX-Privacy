import {
  HOST_PREFIX,
  STAT_RETAIN_DAYS,
  classifyRulesets,
  daysAgo,
  summarize,
  utcDay,
  type SecurityEvent,
  type StatsDump,
  type StatsView,
} from '../engines/core/stats.ts';
import { addStats, clearStats, openNexusDB, pruneStatsBefore, statsSince } from '../storage/db.ts';

const EVENTS_KEY = 'securityLog';
const MAX_EVENTS = 50;
const FLUSH_MS = 500;
const MAX_HOST_LEN = 253;

const MATCH_CACHE_MAX = 500;

export class StatsRecorder {
  private pending = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private events: SecurityEvent[] | null = null;
  private matches = new Map<string, ReturnType<typeof classifyRulesets>>();

  private schedule(): void {
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  private bump(category: string, n = 1): void {
    this.pending.set(category, (this.pending.get(category) ?? 0) + n);
    this.schedule();
  }

  /** Count only if AX's own DNR rules matched; Shields / other extensions are ignored. */
  request(url: string, type: string, host: string): void {
    void this.classify(url, type, host);
  }

  forgetMatches(): void {
    this.matches.clear();
  }

  private async classify(url: string, type: string, host: string): Promise<void> {
    const key = `${type}\0${url}`;
    let cat = this.matches.get(key);
    if (cat === undefined) {
      try {
        const r = await chrome.declarativeNetRequest.testMatchOutcome({
          url,
          type: type as chrome.declarativeNetRequest.ResourceType,
        });
        cat = classifyRulesets(r.matchedRules.map((m) => m.rulesetId));
      } catch {
        return;
      }
      if (this.matches.size >= MATCH_CACHE_MAX) {
        this.matches.delete(this.matches.keys().next().value as string);
      }
      this.matches.set(key, cat);
    }
    if (!cat) return;
    this.bump(cat);
    if (host.length > 0 && host.length <= MAX_HOST_LEN) this.bump(`${HOST_PREFIX}${host}`);
  }

  consent(): void {
    this.bump('consent');
  }

  page(url: string, list: string): void {
    this.bump('pages');
    if (classifyRulesets([list]) === 'security') this.bump('security');
    void this.note({ at: Date.now(), kind: 'page', url, list });
  }

  popup(url: string): void {
    this.bump('popups');
    void this.note({ at: Date.now(), kind: 'popup', url });
  }

  private async loadEvents(): Promise<SecurityEvent[]> {
    if (this.events) return this.events;
    const raw = (await chrome.storage.local.get(EVENTS_KEY))[EVENTS_KEY];
    this.events = Array.isArray(raw) ? raw.filter(isEvent) : [];
    return this.events;
  }

  private async note(event: SecurityEvent): Promise<void> {
    const events = await this.loadEvents();
    events.unshift(event);
    this.events = events.slice(0, MAX_EVENTS);
    await chrome.storage.local.set({ [EVENTS_KEY]: this.events });
  }

  async flush(): Promise<void> {
    this.timer = null;
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    const db = await openNexusDB();
    await addStats(db, utcDay(), [...batch]);
    await pruneStatsBefore(db, daysAgo(STAT_RETAIN_DAYS));
  }

  async view(days: number): Promise<StatsView> {
    await this.flush();
    const to = utcDay();
    const from = daysAgo(Math.max(0, days - 1), to);
    const [rows, events] = await Promise.all([
      statsSince(await openNexusDB(), from),
      this.loadEvents(),
    ]);
    return summarize(rows, from, to, events);
  }

  async dump(): Promise<StatsDump> {
    await this.flush();
    return {
      rows: await statsSince(await openNexusDB(), daysAgo(STAT_RETAIN_DAYS - 1)),
      events: await this.loadEvents(),
    };
  }

  async restore(dump: StatsDump): Promise<void> {
    await this.reset();
    const db = await openNexusDB();
    const byDay = new Map<string, [string, number][]>();
    for (const row of dump.rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !row.category || row.count < 1) continue;
      const list = byDay.get(row.day) ?? [];
      list.push([row.category, row.count]);
      byDay.set(row.day, list);
    }
    for (const [day, entries] of byDay) await addStats(db, day, entries);
    this.events = dump.events.filter(isEvent).slice(0, MAX_EVENTS);
    await chrome.storage.local.set({ [EVENTS_KEY]: this.events });
  }

  async reset(): Promise<void> {
    this.pending.clear();
    this.events = [];
    await Promise.all([clearStats(await openNexusDB()), chrome.storage.local.remove(EVENTS_KEY)]);
  }
}

function isEvent(v: unknown): v is SecurityEvent {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as SecurityEvent;
  return (
    (e.kind === 'page' || e.kind === 'popup') &&
    typeof e.at === 'number' &&
    typeof e.url === 'string' &&
    e.url.length <= 2048 &&
    (e.list === undefined || (typeof e.list === 'string' && e.list.length <= 200))
  );
}

export function parseStatsDump(raw: unknown): StatsDump | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<StatsDump>;
  if (!Array.isArray(r.rows) || !Array.isArray(r.events)) return null;
  return {
    rows: r.rows.filter(
      (x) =>
        typeof x === 'object' &&
        x !== null &&
        typeof x.day === 'string' &&
        typeof x.category === 'string' &&
        typeof x.count === 'number',
    ),
    events: r.events.filter(isEvent),
  };
}
