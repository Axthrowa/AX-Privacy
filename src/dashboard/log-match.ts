type Rule = chrome.declarativeNetRequest.Rule;

export interface LogEntry {
  time: number;
  url: string;
  type: string;
  /** null when it loaded; the browser's error name otherwise. */
  error: string | null;
  /** The rule that blocked it, once matched. */
  rule?: string;
}

/** A blocked request and the rule match the browser recorded for it are this close in time. */
const PAIR_MS = 1000;

/** One line for a matched rule: its list, id, action and what it matches. */
export function describeRule(rulesetId: string, ruleId: number, rule: Rule | undefined): string {
  const list =
    rulesetId === '_dynamic' ? 'AX' : rulesetId === '_session' ? 'AX (oturum)' : rulesetId;
  if (!rule) return `${list} #${ruleId}`;
  const c = rule.condition;
  const what =
    c.urlFilter ??
    c.regexFilter ??
    c.requestDomains?.slice(0, 3).join(', ') ??
    c.initiatorDomains?.slice(0, 3).join(', ') ??
    '*';
  return `${list} #${ruleId} ${rule.action.type}: ${what}`;
}

/**
 * Gives each blocked entry the closest unused match in time. Matches left over modified a request
 * (headers, redirects, allow rules) without stopping it.
 */
export function pairMatches(
  entries: LogEntry[],
  matches: { time: number; text: string }[],
): { entries: LogEntry[]; unpaired: string[] } {
  const left = [...matches].sort((a, b) => a.time - b.time);
  const out = entries.map((e) => {
    if (!e.error?.includes('BLOCKED_BY_CLIENT')) return e;
    let best = -1;
    for (let i = 0; i < left.length; i++) {
      const m = left[i];
      if (!m) continue;
      const d = Math.abs(m.time - e.time);
      if (d <= PAIR_MS && (best < 0 || d < Math.abs((left[best]?.time ?? 0) - e.time))) best = i;
    }
    if (best < 0) return e;
    const [m] = left.splice(best, 1);
    return { ...e, rule: m?.text };
  });
  return { entries: out, unpaired: left.map((m) => m.text) };
}
