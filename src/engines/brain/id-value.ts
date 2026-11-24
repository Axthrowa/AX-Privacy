// Tells a per-visitor ID from an ordinary value. Tiny on purpose: page scripts bundle it.

/** brain-signals.ts (main world) to brain-scan.ts (isolated world): one tracking note. */
export const SIGNAL_EVENT = 'ax-brain-signal';

/** Bits per character of `v`. */
function entropy(v: string): number {
  const counts = new Map<string, number>();
  for (const c of v) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / v.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Long, random, letters and digits mixed. Version strings, timestamps, words and short hashes do
 * not count.
 */
export function looksLikeId(v: string): boolean {
  if (v.length < 16 || v.length > 128 || !/^[A-Za-z0-9_.-]+$/.test(v)) return false;
  if (!/[0-9]/.test(v) || !/[A-Za-z]/.test(v)) return false;
  return entropy(v) >= 3.5;
}
