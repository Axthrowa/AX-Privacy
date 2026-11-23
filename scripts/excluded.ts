import { createHash } from 'node:crypto';

// Name words of sites that must never appear in the packaged rules. Stored as SHA-256 only, so
// the names are not in the code either.
const EXCLUDED_WORD_HASHES: ReadonlySet<string> = new Set([
  'f44d5e7ea812835fb1c9585d28f98eb301a3416427cf7725a00a8b2e9d334e03',
  '228b721b3f5cd3518468e5924b95bd9934decdd3cd2a20384412f79e9908314c',
]);

const seen = new Map<string, boolean>();

export function mentionsExcluded(line: string): boolean {
  for (const word of line.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hit = seen.get(word);
    if (hit === undefined) {
      hit = EXCLUDED_WORD_HASHES.has(createHash('sha256').update(word).digest('hex'));
      seen.set(word, hit);
    }
    if (hit) return true;
  }
  return false;
}

/** The list without any filter line that names an excluded site. */
export function dropExcluded(text: string): string {
  return text
    .split('\n')
    .filter((line) => !mentionsExcluded(line))
    .join('\n');
}
