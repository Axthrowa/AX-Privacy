import { compileFilter, type CompiledRule } from '../engines/adblock/network.ts';
import { urlFilterToRegExp } from '../engines/popup/matcher.ts';
import { L } from '../shared/i18n.ts';
import { cosmeticProblem, reasonText } from './custom.ts';

/** Highlight classes; the dashboard colours them. */
export type TokenClass =
  'comment' | 'domain' | 'separator' | 'selector' | 'pattern' | 'option' | 'exception' | 'error';
export interface Token {
  text: string;
  cls: TokenClass | null;
}

export type LineCheck =
  | { kind: 'empty' | 'comment' }
  | { kind: 'network' | 'popup'; rule: CompiledRule }
  | { kind: 'cosmetic' }
  | { kind: 'error'; reason: string };

/** The same verdict saving gives, for one line, so errors show while typing. */
export function checkLine(raw: string): LineCheck {
  const line = raw.trim();
  if (!line) return { kind: 'empty' };
  const res = compileFilter(line, { allowRegex: true });
  switch (res.kind) {
    case 'comment':
      return { kind: 'comment' };
    case 'cosmetic': {
      const problem = cosmeticProblem(line);
      return problem ? { kind: 'error', reason: problem } : { kind: 'cosmetic' };
    }
    case 'unsupported':
      return { kind: 'error', reason: reasonText(res.reason) };
    case 'popup':
      return { kind: 'popup', rule: res.rule };
    case 'rule':
      return { kind: 'network', rule: res.rule };
    default:
      return { kind: 'network', rule: { priority: 1, action: { type: 'allow' }, condition: {} } };
  }
}

const COSMETIC_SEP = /#[@?$%]?#|#@[?$%]#/;

/** Splits a line into coloured parts; an invalid line is one error token. */
export function lineTokens(raw: string): Token[] {
  const check = checkLine(raw);
  if (check.kind === 'empty') return [{ text: raw, cls: null }];
  if (check.kind === 'comment') return [{ text: raw, cls: 'comment' }];
  if (check.kind === 'error') return [{ text: raw, cls: 'error' }];
  if (check.kind === 'cosmetic') {
    const m = COSMETIC_SEP.exec(raw);
    if (!m) return [{ text: raw, cls: 'selector' }];
    return [
      { text: raw.slice(0, m.index), cls: 'domain' },
      { text: m[0], cls: m[0].includes('@') ? 'exception' : 'separator' },
      { text: raw.slice(m.index + m[0].length), cls: 'selector' },
    ];
  }
  const out: Token[] = [];
  let rest = raw;
  if (rest.trimStart().startsWith('@@')) {
    const at = rest.indexOf('@@');
    out.push({ text: rest.slice(0, at + 2), cls: 'exception' });
    rest = rest.slice(at + 2);
  }
  // `$` in a regex body (/...$/) is not the options mark.
  const isRegex = /^\/.*\/(\$|$)/.test(rest.trim());
  const dollar = isRegex ? rest.lastIndexOf('/$') + 1 || -1 : rest.indexOf('$');
  if (dollar > 0) {
    out.push({ text: rest.slice(0, dollar), cls: 'pattern' });
    out.push({ text: rest.slice(dollar), cls: 'option' });
  } else {
    out.push({ text: rest, cls: 'pattern' });
  }
  return out;
}

function cosmeticDomains(line: string): { on: string[]; off: string[] } {
  const m = COSMETIC_SEP.exec(line);
  const head = m ? line.slice(0, m.index) : '';
  const parts = head
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return {
    on: parts.filter((d) => !d.startsWith('~')),
    off: parts.filter((d) => d.startsWith('~')).map((d) => d.slice(1)),
  };
}

const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Where a line applies, in words. */
export function ruleScope(raw: string): string | null {
  const check = checkLine(raw);
  if (check.kind === 'cosmetic') {
    const { on, off } = cosmeticDomains(raw.trim());
    const where = on.length ? on.join(', ') : L('tüm siteler', 'all sites');
    const exception = COSMETIC_SEP.exec(raw)?.[0].includes('@');
    const but = off.length ? L(` (${off.join(', ')} hariç)`, ` (except ${off.join(', ')})`) : '';
    return exception
      ? L(`Gizlemeyi kaldırır: ${where}${but}`, `Stops hiding on: ${where}${but}`)
      : L(`Gizler: ${where}${but}`, `Hides on: ${where}${but}`);
  }
  if (check.kind !== 'network' && check.kind !== 'popup') return null;
  const c = check.rule.condition;
  const what = c.urlFilter ?? (c.regexFilter ? `/${c.regexFilter}/` : '*');
  const pages = c.initiatorDomains?.length
    ? L(
        `yalnız ${c.initiatorDomains.join(', ')} sayfalarında`,
        `only on ${c.initiatorDomains.join(', ')}`,
      )
    : L('tüm sitelerde', 'on all sites');
  const verb =
    check.kind === 'popup'
      ? L('Açılır pencereyi engeller', 'Blocks pop-ups to')
      : check.rule.action.type === 'allow' || check.rule.action.type === 'allowAllRequests'
        ? L('İzin verir', 'Allows')
        : check.rule.action.type === 'redirect'
          ? L('Değiştirir', 'Rewrites')
          : L('Engeller', 'Blocks');
  const types = c.resourceTypes?.length ? ` [${c.resourceTypes.join(', ')}]` : '';
  return `${verb}: ${what}${types}, ${pages}`;
}

/**
 * Whether a line acts on `address`: a hiding rule on that page, a network rule on a request to it.
 * Network rules limited to some pages count when `address` is on one of them.
 */
export function matchesAddress(raw: string, address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const check = checkLine(raw);
  if (check.kind === 'cosmetic') {
    const { on, off } = cosmeticDomains(raw.trim());
    if (off.some((d) => onHost(host, d))) return false;
    return on.length === 0 || on.some((d) => onHost(host, d));
  }
  if (check.kind !== 'network' && check.kind !== 'popup') return false;
  const c = check.rule.condition;
  if (c.requestDomains && !c.requestDomains.some((d) => onHost(host, d))) return false;
  if (c.excludedRequestDomains?.some((d) => onHost(host, d))) return false;
  if (c.urlFilter) return urlFilterToRegExp(c.urlFilter, c.isUrlFilterCaseSensitive).test(url.href);
  if (c.regexFilter) {
    try {
      return new RegExp(c.regexFilter, c.isUrlFilterCaseSensitive ? '' : 'i').test(url.href);
    } catch {
      return false;
    }
  }
  return true;
}
