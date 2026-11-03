import {
  compileList,
  type CompiledRule,
  type DnrRule,
  type ListStats,
} from '../engines/adblock/network.ts';

/** IDs below this are control rules (see `engines/core/control.ts`). */
export const FIRST_DYNAMIC_ID = 1000;
/** Chrome's dynamic rule cap is 30,000; keep room for the control rules. */
export const MAX_FILTER_RULES = 29_000;
/** Chrome caps dynamic regex rules at 1,000. */
export const MAX_REGEX_RULES = 1_000;
/** Chrome caps dynamic "unsafe" rules (redirect, modifyHeaders) at 5,000; keep room for control. */
export const MAX_UNSAFE_RULES = 4_900;

export interface DynamicSource {
  name: string;
  lines: readonly string[];
}

export interface SourceReport {
  stats: ListStats;
  /** Rules dropped because a quota was full. */
  truncated: number;
}

export interface DynamicBuild {
  rules: DnrRule[];
  reports: Map<string, SourceReport>;
}

export type RegexCheck = (regex: string, caseSensitive: boolean) => Promise<boolean>;

/** Compiles sources in order (custom rules first), so earlier sources win when quotas run out. */
export async function buildDynamicRules(
  sources: readonly DynamicSource[],
  isRegexSupported: RegexCheck,
  /** Rules from list updates, already fitted; custom rules and user lists keep their quota first. */
  precompiled: readonly CompiledRule[] = [],
): Promise<DynamicBuild> {
  const rules: DnrRule[] = [];
  const reports = new Map<string, SourceReport>();
  let regex = 0;
  let unsafe = 0;
  /** Adds the rule unless a quota is full. */
  const take = (rule: CompiledRule): boolean => {
    const re = rule.condition.regexFilter;
    const isUnsafe = rule.action.type === 'redirect' || rule.action.type === 'modifyHeaders';
    if (
      rules.length >= MAX_FILTER_RULES ||
      (re !== undefined && regex >= MAX_REGEX_RULES) ||
      (isUnsafe && unsafe >= MAX_UNSAFE_RULES)
    ) {
      return false;
    }
    if (re !== undefined) regex++;
    if (isUnsafe) unsafe++;
    rules.push({ id: FIRST_DYNAMIC_ID + rules.length, ...rule });
    return true;
  };
  for (const src of sources) {
    const compiled = compileList(src.lines, { allowRegex: true });
    const { stats } = compiled;
    let truncated = 0;
    for (const rule of compiled.rules) {
      const re = rule.condition.regexFilter;
      if (
        re !== undefined &&
        !(await isRegexSupported(re, !!rule.condition.isUrlFilterCaseSensitive))
      ) {
        stats.unsupported.regex = (stats.unsupported.regex ?? 0) + 1;
        stats.converted--;
        stats.dnrRules--;
        continue;
      }
      if (!take(rule)) truncated++;
    }
    reports.set(src.name, { stats, truncated });
  }
  let truncatedUpdates = 0;
  for (const rule of precompiled) {
    if (!take(rule)) truncatedUpdates++;
  }
  if (truncatedUpdates > 0) {
    console.warn(`Dinamik kural kotası doldu: ${truncatedUpdates} güncelleme kuralı atlandı`);
  }
  return { rules, reports };
}
