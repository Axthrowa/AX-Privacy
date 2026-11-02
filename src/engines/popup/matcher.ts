import type { CompiledRule } from '../adblock/network.ts';
import { hostMatches } from '../../shared/site.ts';
import { siteKey } from '../../shared/url.ts';

/**
 * Evaluates `$popup` filters, which DNR cannot see: a popup is just a new tab's navigation.
 * The opener's frame URL plays the role of the request initiator.
 */
export type PopupMatcher = (url: string, openerUrl: string) => boolean;

/** DNR `urlFilter` syntax (`||`, `|`, `*`, `^`) as a RegExp. */
export function urlFilterToRegExp(filter: string, caseSensitive = false): RegExp {
  let src = '';
  let body = filter;
  if (body.startsWith('||')) {
    src = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#]*\\.)?';
    body = body.slice(2);
  } else if (body.startsWith('|')) {
    src = '^';
    body = body.slice(1);
  }
  const anchoredEnd = body.endsWith('|');
  if (anchoredEnd) body = body.slice(0, -1);
  for (const c of body) {
    if (c === '*') src += '.*';
    else if (c === '^') src += '(?:[^\\w.%-]|$)';
    else src += c.replace(/[.+?${}()[\]\\/|]/g, '\\$&');
  }
  return new RegExp(src + (anchoredEnd ? '$' : ''), caseSensitive ? '' : 'i');
}

interface Compiled {
  allow: boolean;
  priority: number;
  test: (url: string, host: string, openerHost: string, thirdParty: boolean) => boolean;
}

const anyMatch = (host: string, list: readonly string[] | undefined) =>
  !!list?.some((d) => hostMatches(host, d));

function compileRule(rule: CompiledRule): Compiled | null {
  const c = rule.condition;
  let re: RegExp | null = null;
  try {
    if (c.regexFilter !== undefined)
      re = new RegExp(c.regexFilter, c.isUrlFilterCaseSensitive ? '' : 'i');
    else if (c.urlFilter !== undefined)
      re = urlFilterToRegExp(c.urlFilter, c.isUrlFilterCaseSensitive);
  } catch {
    return null;
  }
  return {
    allow: rule.action.type === 'allow' || rule.action.type === 'allowAllRequests',
    priority: rule.priority,
    test(url, host, openerHost, thirdParty) {
      if (re && !re.test(url)) return false;
      if (c.requestDomains && !anyMatch(host, c.requestDomains)) return false;
      if (anyMatch(host, c.excludedRequestDomains)) return false;
      if (c.initiatorDomains && !anyMatch(openerHost, c.initiatorDomains)) return false;
      if (anyMatch(openerHost, c.excludedInitiatorDomains)) return false;
      if (c.domainType === 'thirdParty' && !thirdParty) return false;
      if (c.domainType === 'firstParty' && thirdParty) return false;
      return true;
    },
  };
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

/** Highest priority match wins; at equal priority an exception beats a block, as in DNR. */
export function createPopupMatcher(rules: readonly CompiledRule[]): PopupMatcher {
  const compiled = rules.map(compileRule).filter((r): r is Compiled => r !== null);
  return (url, openerUrl) => {
    const host = hostOf(url);
    const openerHost = hostOf(openerUrl);
    if (!host || !openerHost) return false;
    const thirdParty = siteKey(url) !== siteKey(openerUrl);
    let best: Compiled | null = null;
    for (const r of compiled) {
      if (best && (r.priority < best.priority || (r.priority === best.priority && best.allow)))
        continue;
      if (r.test(url, host, openerHost, thirdParty)) best = r;
    }
    return best !== null && !best.allow;
  };
}
