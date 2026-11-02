import { shrinkCounts, type CompiledRule, type DnrRule } from '../engines/adblock/network.ts';
import type { BuiltinList } from './catalog.ts';

/**
 * Static rulesets ship inside the extension and cannot be edited, so a newer list is applied as a
 * difference: rules the package lacks become dynamic rules, rules the list dropped are switched off.
 */

/** A fresh list this much smaller than the packaged one is more likely broken than improved. */
export const MIN_SIZE_RATIO = 0.5;

/** One hostname per line becomes filter syntax; the other lists already are. */
export function listText(list: BuiltinList, raw: string): string {
  if (!list.format) return raw;
  const suffix = list.format === 'domains' ? '$all' : '';
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .map((l) => (l.startsWith('#') ? `!${l.slice(1)}` : l))
    .map((l) => (l && !l.startsWith('!') ? `||${l}^${suffix}` : l))
    .join('\n');
}

const keyOf = (rule: CompiledRule) =>
  JSON.stringify({ priority: rule.priority, action: rule.action, condition: rule.condition });

export function diffRules(
  bundled: readonly DnrRule[],
  fresh: readonly CompiledRule[],
): { add: CompiledRule[]; disableIds: number[] } {
  const wanted = new Set(fresh.map(keyOf));
  const have = new Set(bundled.map(keyOf));
  return {
    add: fresh.filter((r) => !have.has(keyOf(r))),
    disableIds: bundled.filter((r) => !wanted.has(keyOf(r))).map((r) => r.id),
  };
}

/** The same fitting the build does, so an unchanged regex compares equal to its packaged form. */
export async function fitRegexRules(
  rules: readonly CompiledRule[],
  isSupported: (regex: string, caseSensitive: boolean) => Promise<boolean>,
): Promise<CompiledRule[]> {
  const out: CompiledRule[] = [];
  for (const rule of rules) {
    const regex = rule.condition.regexFilter;
    if (regex === undefined) {
      out.push(rule);
      continue;
    }
    const caseSensitive = rule.condition.isUrlFilterCaseSensitive ?? false;
    if (await isSupported(regex, caseSensitive)) {
      out.push(rule);
      continue;
    }
    // Lowered counts widen a pattern, which whole-page rules must not risk.
    if (rule.condition.resourceTypes?.includes('main_frame')) continue;
    for (const level of [1, 2, 3] as const) {
      const shrunk = shrinkCounts(regex, level);
      if (await isSupported(shrunk, caseSensitive)) {
        out.push({ ...rule, condition: { ...rule.condition, regexFilter: shrunk } });
        break;
      }
    }
  }
  return out;
}
