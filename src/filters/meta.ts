import type { ListStats } from '../engines/adblock/network.ts';

/** Written by `scripts/filters.ts` into `public/rulesets/meta.json`. */
export interface BuiltinListMeta {
  id: string;
  version: string | null;
  builtAt: string;
  lines: number;
  includes: string[];
  engineBytes: number;
  stats: ListStats;
}
