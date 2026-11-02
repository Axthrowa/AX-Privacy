/**
 * Which class names, ids and link words appear in a generic hiding rule at all. The content script
 * checks page features against this table and stays quiet when none match, so an ordinary page does
 * not wake the service worker and its filter engine. Hashes match the Ghostery engine's own index.
 */

/** Words nearly every link has; a rule never needs only these, and they would match every page. */
const COMMON_WORDS = ['http', 'https', 'www', 'com', 'net', 'org', 'html', 'php', 'htm'];

export function fastHash(s: string): number {
  let hash = 5011;
  for (let i = 0; i < s.length; i++) hash = (hash * 37) ^ s.charCodeAt(i);
  return hash >>> 0;
}

export const COMMON_HASHES: ReadonlySet<number> = new Set(COMMON_WORDS.map(fastHash));

export function encodeTokens(tokens: Iterable<number>): string {
  const sorted = Uint32Array.from(new Set(tokens)).sort();
  return btoa(String.fromCharCode(...new Uint8Array(sorted.buffer)));
}

export function decodeTokens(b64: string): Uint32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint32Array(bytes.buffer);
}

/** Every word a generic hiding rule of this engine is indexed under. */
export function usefulTokens(engine: {
  getFilters(): {
    cosmeticFilters: { isGenericHide(): boolean; isUnhide(): boolean; getTokens(): unknown }[];
  };
}): number[] {
  const out: number[] = [];
  for (const f of engine.getFilters().cosmeticFilters) {
    if (!f.isGenericHide() || f.isUnhide()) continue;
    for (const tokens of f.getTokens() as Uint32Array[]) {
      for (const h of tokens) if (!COMMON_HASHES.has(h)) out.push(h);
    }
  }
  return out;
}

export function hasToken(sorted: Uint32Array, hash: number): boolean {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid] ?? 0;
    if (v === hash) return true;
    if (v < hash) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

export interface Features {
  classes: string[];
  ids: string[];
  hrefs: string[];
}

/** The features a generic rule could match; empty lists mean nothing to ask the engine about. */
export function knownFeatures(f: Features, tables: readonly Uint32Array[]): Features {
  const inTables = (h: number) => tables.some((sorted) => hasToken(sorted, h));
  const known = (s: string) => inTables(fastHash(s));
  return {
    classes: f.classes.filter(known),
    ids: f.ids.filter(known),
    hrefs: f.hrefs.filter((href) =>
      (href.match(/[a-zA-Z0-9%]+/g) ?? []).some((word) => {
        const h = fastHash(word);
        return !COMMON_HASHES.has(h) && inTables(h);
      }),
    ),
  };
}
