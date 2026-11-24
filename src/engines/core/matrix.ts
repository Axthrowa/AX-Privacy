/**
 * Advanced mode: uBlock Origin–style dynamic filtering. Each rule is one line
 * `site target type action`: on pages of `site` (`*` = every site), requests to the third party
 * `target` (`*` = every third party) of `type` get `action`. The most specific rule wins: a named
 * site beats `*`, then a named target, then a named type.
 *
 * - `block`: block, whatever the filter lists say.
 * - `allow`: let through, filter lists included (unbreaks a site).
 * - `noop`: cancel a broader matrix rule here; the filter lists decide as usual.
 */
import { isValidSite } from '../../shared/site.ts';

export const MATRIX_TYPES = [
  '*',
  'script',
  'frame',
  'image',
  'xhr',
  'css',
  'font',
  'media',
] as const;
export type MatrixType = (typeof MATRIX_TYPES)[number];
export const MATRIX_ACTIONS = ['block', 'allow', 'noop'] as const;
export type MatrixAction = (typeof MATRIX_ACTIONS)[number];

export interface MatrixRule {
  site: string;
  target: string;
  type: MatrixType;
  action: MatrixAction;
}

/** Dynamic rule IDs 500–999, inside the control range (filter rules start at 1000). */
export const MATRIX_FIRST_ID = 500;
export const MAX_MATRIX_RULES = 500;
/** Above list rules and paranoid script blocking, below pausing and site switches. */
export const MATRIX_BASE_PRIORITY = 200;

type ResourceType = chrome.declarativeNetRequest.ResourceType;
const DNR_TYPES: Record<Exclude<MatrixType, '*'>, string[]> = {
  script: ['script'],
  frame: ['sub_frame'],
  image: ['image'],
  xhr: ['xmlhttprequest', 'websocket', 'ping'],
  css: ['stylesheet'],
  font: ['font'],
  media: ['media'],
};

const isHostOrAny = (h: string) => h === '*' || isValidSite(h);

/** One line, or null when it is not a valid rule. Hosts are lower-cased. */
export function parseMatrixLine(line: string): MatrixRule | null {
  const parts = line.trim().toLowerCase().split(/\s+/);
  if (parts.length !== 4) return null;
  const [site = '', target = '', type = '', action = ''] = parts;
  if (!isHostOrAny(site) || !isHostOrAny(target)) return null;
  if (!(MATRIX_TYPES as readonly string[]).includes(type)) return null;
  if (!(MATRIX_ACTIONS as readonly string[]).includes(action)) return null;
  return { site, target, type: type as MatrixType, action: action as MatrixAction };
}

export const matrixLine = (r: MatrixRule) => `${r.site} ${r.target} ${r.type} ${r.action}`;

/** Valid, de-duplicated rules; a later line for the same cell replaces an earlier one. */
export function parseMatrix(lines: readonly string[]): MatrixRule[] {
  const cells = new Map<string, MatrixRule>();
  for (const l of lines) {
    const r = parseMatrixLine(l);
    if (r) cells.set(`${r.site} ${r.target} ${r.type}`, r);
  }
  return [...cells.values()].slice(0, MAX_MATRIX_RULES);
}

/** Sets (or with `null` clears) one cell, as the popup does. */
export function setCell(
  lines: readonly string[],
  cell: Omit<MatrixRule, 'action'>,
  action: MatrixAction | null,
): string[] {
  const key = `${cell.site} ${cell.target} ${cell.type}`;
  const rest = parseMatrix(lines).filter((r) => `${r.site} ${r.target} ${r.type}` !== key);
  return [...rest, ...(action ? [{ ...cell, action }] : [])].map(matrixLine);
}

/** The action that applies to one request, as the compiled rules decide it; null if none. */
export function matrixVerdict(
  rules: readonly MatrixRule[],
  site: string,
  target: string,
  type: MatrixType,
): MatrixAction | null {
  const on = (host: string, d: string) => d === '*' || host === d || host.endsWith(`.${d}`);
  let best: MatrixRule | null = null;
  for (const r of rules) {
    if (!on(site, r.site) || !on(target, r.target) || (r.type !== '*' && r.type !== type)) continue;
    if (!best || specificity(r) > specificity(best)) best = r;
  }
  return best?.action ?? null;
}

const specificity = (r: MatrixRule) =>
  (r.site !== '*' ? 4 : 0) + (r.target !== '*' ? 2 : 0) + (r.type !== '*' ? 1 : 0);

const covers = (broad: MatrixRule, narrow: MatrixRule) =>
  specificity(broad) < specificity(narrow) &&
  (broad.site === '*' || broad.site === narrow.site) &&
  (broad.target === '*' || broad.target === narrow.target) &&
  (broad.type === '*' || broad.type === narrow.type);

/**
 * DNR rules for the matrix. `allow` and `block` are rules at a priority by specificity. A `noop`
 * cell has no DNR action that leaves the lists in charge, so it is cut out of every broader
 * block/allow rule instead.
 * shortcut: a noop that differs from the broader rule in its site drops that rule on the whole site
 * (all targets and types); exact cutting would need a rule per remaining cell.
 */
export function matrixRules(rules: readonly MatrixRule[]): chrome.declarativeNetRequest.Rule[] {
  const noops = rules.filter((r) => r.action === 'noop');
  return rules
    .filter((r) => r.action !== 'noop')
    .map((r, i) => {
      const cond: chrome.declarativeNetRequest.RuleCondition = {
        domainType: 'thirdParty' as chrome.declarativeNetRequest.DomainType,
        excludedResourceTypes: ['main_frame' as ResourceType],
      };
      if (r.site !== '*') cond.initiatorDomains = [r.site];
      if (r.target !== '*') cond.requestDomains = [r.target];
      if (r.type !== '*') {
        cond.resourceTypes = DNR_TYPES[r.type] as ResourceType[];
        delete cond.excludedResourceTypes;
      }
      const sites = new Set<string>();
      const targets = new Set<string>();
      const types = new Set<string>();
      for (const n of noops) {
        if (!covers(r, n)) continue;
        if (n.site !== r.site) sites.add(n.site);
        else if (n.target !== r.target) targets.add(n.target);
        else if (n.type !== '*') for (const t of DNR_TYPES[n.type]) types.add(t);
      }
      if (sites.size) cond.excludedInitiatorDomains = [...sites].sort();
      if (targets.size) cond.excludedRequestDomains = [...targets].sort();
      if (types.size) {
        cond.excludedResourceTypes = [
          ...(cond.excludedResourceTypes ?? []),
          ...([...types] as ResourceType[]),
        ];
      }
      return {
        id: MATRIX_FIRST_ID + i,
        priority: MATRIX_BASE_PRIORITY + specificity(r) * 2 + (r.action === 'allow' ? 1 : 0),
        action: {
          type: (r.action === 'allow'
            ? 'allow'
            : 'block') as chrome.declarativeNetRequest.RuleActionType,
        },
        condition: cond,
      };
    });
}
