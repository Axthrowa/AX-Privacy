import { surrogatePath } from './surrogates.ts';

/**
 * Compiles ABP/uBO/AdGuard network filters into declarativeNetRequest rules.
 * Anything DNR cannot express faithfully is reported as unsupported instead of approximated.
 */

export type ResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'media'
  | 'websocket'
  | 'other';

export interface DnrCondition {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  resourceTypes?: ResourceType[];
  excludedResourceTypes?: ResourceType[];
  domainType?: 'firstParty' | 'thirdParty';
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  requestMethods?: string[];
  excludedRequestMethods?: string[];
}

export type DnrAction =
  | { type: 'block' | 'allow' | 'allowAllRequests' }
  | { type: 'redirect'; redirect: { extensionPath: string } }
  | {
      type: 'modifyHeaders';
      responseHeaders: { header: string; operation: 'append'; value: string }[];
    }
  | { type: 'redirect'; redirect: { transform: { queryTransform: { removeParams: string[] } } } };

export interface DnrRule {
  id: number;
  priority: number;
  action: DnrAction;
  condition: DnrCondition;
}

export type CompiledRule = Omit<DnrRule, 'id'>;

export type Outcome =
  /** `param` is set for `$removeparam` rules, which `compileList` scopes by their exceptions. */
  | { kind: 'rule'; rule: CompiledRule; param?: string }
  /** `@@...$removeparam[=name]`: stop removing `name` (null: every parameter) on these hosts. */
  | { kind: 'paramException'; param: string | null; hosts: string[] }
  /** `$popup` filters; DNR cannot see popups, so these feed the popup guard instead. */
  | { kind: 'popup'; rule: CompiledRule }
  | { kind: 'comment' }
  | { kind: 'cosmetic' }
  | { kind: 'unsupported'; reason: string };

export interface CompileOptions {
  /** Regex filters need `isRegexSupported` validation, which only exists at runtime. */
  allowRegex: boolean;
}

export interface ListStats {
  networkFilters: number;
  converted: number;
  dnrRules: number;
  popupRules: number;
  cosmetic: number;
  badfiltered: number;
  unsupported: Record<string, number>;
}

const TYPES: Record<string, ResourceType[]> = {
  script: ['script'],
  image: ['image'],
  stylesheet: ['stylesheet'],
  css: ['stylesheet'],
  object: ['object'],
  'object-subrequest': ['object'],
  xmlhttprequest: ['xmlhttprequest'],
  xhr: ['xmlhttprequest'],
  subdocument: ['sub_frame'],
  frame: ['sub_frame'],
  ping: ['ping'],
  beacon: ['ping'],
  media: ['media'],
  font: ['font'],
  websocket: ['websocket'],
  other: ['other'],
};
/** `$all`: DNR leaves out main_frame when no types are listed, so name every type. */
export const ALL_TYPES: readonly ResourceType[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
];
const METHODS = new Set(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put']);
const COSMETIC_EXCEPTIONS = new Set([
  'generichide',
  'ghide',
  'elemhide',
  'ehide',
  'specifichide',
  'shide',
]);
const UNSUPPORTED_ACTIONS = new Set(['redirect-rule', 'rewrite']);

/**
 * ABP precedence: exception > block, `$important` block > exception.
 * DNR picks the highest priority, and at equal priority allow > allowAllRequests > block > redirect,
 * so a surrogate needs its own step to beat the plain block of the same URL.
 */
export const PRIORITY = { block: 1, redirect: 2, allow: 3, important: 10 } as const;
const COSMETIC_RE = /#@?[?$%]?#|\$@?\$/;
const DOMAIN_ONLY_RE = /^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)+)\^$/;
const PARAM_NAME_RE = /^[\w.[\]-]+$/;
const PATTERN_HOST_RE = /^\|\|([^/^*|$]+)(?:[/^]|$)/;
const PARAM_TYPES: ResourceType[] = ['main_frame', 'sub_frame', 'xmlhttprequest'];

/** Lowercased punycode hostname, or null if `d` is not a bare hostname. */
export function toAsciiDomain(d: string): string | null {
  if (/[/:@?#\s]/.test(d)) return null;
  try {
    const host = new URL(`http://${d}/`).hostname;
    return /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * `site.*` means any top-level domain, which DNR cannot say. Sites that hop domains stay on a short
 * list of cheap ones.
 * shortcut: fixed list, so a site moving to another ending escapes; add endings as they appear.
 */
const WILDCARD_TLDS =
  'com net org co io me tv cc to ws info biz xyz site online live top pro club app in eu ru de fr es it nl pl br tr com.tr net.tr org.tr co.uk mx vip fun lol icu sbs cfd'.split(
    ' ',
  );

function splitDomains(value: string, include: string[], exclude: string[]): boolean {
  if (!value) return false;
  for (const raw of value.split('|')) {
    const neg = raw.startsWith('~');
    const d = neg ? raw.slice(1) : raw;
    if (d.endsWith('.*') && !d.slice(0, -2).includes('*')) {
      const name = toAsciiDomain(d.slice(0, -2));
      if (!name) return false;
      (neg ? exclude : include).push(...WILDCARD_TLDS.map((tld) => `${name}.${tld}`));
      continue;
    }
    if (!d || d.includes('*') || d.startsWith('/')) return false;
    const ascii = toAsciiDomain(d);
    if (!ascii) return false;
    (neg ? exclude : include).push(ascii);
  }
  return true;
}

function splitOptions(body: string): { pattern: string; options: string[] } {
  const i = body.lastIndexOf('$');
  if (i < 0 || !/^[~\w-]/.test(body.slice(i + 1))) return { pattern: body, options: [] };
  return { pattern: body.slice(0, i), options: body.slice(i + 1).split(',') };
}

const unsupported = (reason: string): Outcome => ({ kind: 'unsupported', reason });

/**
 * Counted repeats are what push a regex over DNR's memory limit: `x{5,16}` compiles to 16 copies,
 * `x{5,}` to 5. Each level keeps the pattern's shape and lowers more counts, which can only make it
 * match more, so the build uses the first level the browser accepts.
 */
export const SHRINK_LEVELS = 3;

export function shrinkCounts(regex: string, level: 1 | 2 | 3 = 1): string {
  const cap = level === 3 ? 4 : 16;
  return regex.replace(/\{(\d+)(?:,(\d*))?\}/g, (whole, low: string, high?: string) => {
    const min = Number(low);
    const max = high ? Number(high) : high === '' ? Infinity : min;
    if (level === 1 && max <= cap) return whole;
    if (min === max && max <= cap) return whole;
    return `{${Math.min(min, cap)},}`;
  });
}

/**
 * JS regex source as RE2, which DNR uses. Lookaheads are dropped, like uBO Lite does, which can only
 * make the pattern match more; `loosened` says so. Forms with no RE2 meaning return null.
 */
export function toRe2(source: string): { regex: string; loosened: boolean } | null {
  if (/\(\?<?!|\(\?<[=]|\\[1-9]|[^\x20-\x7e]/.test(source)) return null;
  let regex = source;
  let loosened = false;
  for (let at = regex.indexOf('(?='); at >= 0; at = regex.indexOf('(?=')) {
    let depth = 0;
    let end = at;
    for (; end < regex.length; end++) {
      const c = regex[end];
      if (c === '\\') end++;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
    }
    if (end >= regex.length) return null;
    regex = regex.slice(0, at) + regex.slice(end + 1);
    loosened = true;
  }
  return { regex, loosened };
}

export function compileFilter(line: string, opts: CompileOptions): Outcome {
  if (!line || line.startsWith('!') || line.startsWith('[')) return { kind: 'comment' };
  if (COSMETIC_RE.test(line)) return { kind: 'cosmetic' };
  // A `$csp` policy is the one option whose value has spaces.
  if (/\s/.test(line) && !/[$,]csp=/.test(line)) return unsupported('syntax');

  const exception = line.startsWith('@@');
  const { pattern, options } = splitOptions(exception ? line.slice(2) : line);

  const types = new Set<ResourceType>();
  const excludedTypes = new Set<ResourceType>();
  const initiators: string[] = [];
  const excludedInitiators: string[] = [];
  const requestDomains: string[] = [];
  const excludedRequestDomains: string[] = [];
  const methods: string[] = [];
  const excludedMethods: string[] = [];
  let domainType: DnrCondition['domainType'];
  let important = false;
  let matchCase = false;
  let document = false;
  let popup = false;
  let surrogate: string | null = null;
  let csp: string | null = null;
  /** undefined: not a `$removeparam` filter; null: regex or every parameter. */
  let removeParam: string | null | undefined;

  for (const raw of options) {
    const neg = raw.startsWith('~');
    const [rawName = '', ...rest] = (neg ? raw.slice(1) : raw).split('=');
    const name = rawName.toLowerCase();
    const value = rest.join('=');
    const typeList = TYPES[name];
    if (typeList) {
      for (const t of typeList) (neg ? excludedTypes : types).add(t);
      continue;
    }
    if (COSMETIC_EXCEPTIONS.has(name)) return { kind: 'cosmetic' };
    if (UNSUPPORTED_ACTIONS.has(name)) return unsupported(name);
    switch (name) {
      // uBO blocks when it cannot redirect; a name we do not ship stays a plain block.
      case 'redirect':
        if (neg || exception) return unsupported('redirect');
        surrogate = surrogatePath(value);
        break;
      case 'empty':
      case 'mp4':
        if (neg || exception) return unsupported(name);
        surrogate = surrogatePath(name === 'mp4' ? 'noopmp4-1s' : 'empty');
        break;
      case 'csp':
        if (neg || exception || !value) return unsupported('csp');
        csp = value;
        break;
      case 'popunder':
      case 'popup':
        if (neg) return unsupported('popup');
        popup = true;
        break;
      case 'third-party':
      case '3p':
        domainType = neg ? 'firstParty' : 'thirdParty';
        break;
      case 'first-party':
      case '1p':
        domainType = neg ? 'thirdParty' : 'firstParty';
        break;
      case 'domain':
      case 'from':
        if (neg || !splitDomains(value, initiators, excludedInitiators))
          return unsupported('domain');
        break;
      case 'to':
        if (neg || !splitDomains(value, requestDomains, excludedRequestDomains)) {
          return unsupported('to');
        }
        break;
      case 'denyallow':
        if (neg || value.includes('~') || !splitDomains(value, excludedRequestDomains, [])) {
          return unsupported('denyallow');
        }
        break;
      case 'method':
        for (const m of value.toLowerCase().split('|')) {
          const mneg = m.startsWith('~');
          const mm = mneg ? m.slice(1) : m;
          if (!METHODS.has(mm)) return unsupported('method');
          (mneg ? excludedMethods : methods).push(mm);
        }
        break;
      case 'important':
        important = true;
        break;
      case 'match-case':
        matchCase = true;
        break;
      case 'document':
      case 'doc':
        if (neg) return unsupported('document');
        document = true;
        break;
      case 'all':
        if (neg) return unsupported('all');
        for (const t of ALL_TYPES) types.add(t);
        break;
      case 'removeparam':
      case 'queryprune':
        if (neg) return unsupported('removeparam');
        removeParam = PARAM_NAME_RE.test(value) ? value : null;
        break;
      default:
        return unsupported(name || 'syntax');
    }
  }

  if (removeParam !== undefined && exception) {
    const host = toAsciiDomain(PATTERN_HOST_RE.exec(pattern)?.[1] ?? '');
    const hosts = [...(host ? [host] : []), ...initiators];
    if (popup || hosts.length === 0) return unsupported('removeparam-exception');
    return { kind: 'paramException', param: removeParam, hosts };
  }
  if (removeParam !== undefined) {
    // DNR removes parameters by exact name only.
    if (removeParam === null || popup) return unsupported('removeparam');
    const wanted = new Set(types);
    if (document) wanted.add('main_frame').add('sub_frame');
    let rt = (wanted.size ? [...wanted] : PARAM_TYPES).filter((t) => !excludedTypes.has(t));
    const condition: DnrCondition = {};
    if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
      if (!opts.allowRegex) return unsupported('regex');
      const re2 = toRe2(pattern.slice(1, -1));
      if (!re2) return unsupported('regex');
      condition.regexFilter = re2.regex;
    } else {
      if (/[^\x20-\x7e]/.test(pattern)) return unsupported('non-ascii');
      const p = pattern.replace(/^\*+/, '').replace(/\*+$/, '');
      condition.urlFilter = p || `${removeParam}=`;
    }
    if (matchCase) condition.isUrlFilterCaseSensitive = true;
    if (initiators.length || excludedInitiators.length) {
      // For documents uBO matches `domain=` against the page itself, i.e. the request.
      const docs = rt.filter((t) => t === 'main_frame' || t === 'sub_frame');
      if (docs.length) {
        rt = docs;
        if (initiators.length) condition.requestDomains = initiators;
        if (excludedInitiators.length) condition.excludedRequestDomains = excludedInitiators;
      } else {
        if (initiators.length) condition.initiatorDomains = initiators;
        if (excludedInitiators.length) condition.excludedInitiatorDomains = excludedInitiators;
      }
    }
    if (rt.length === 0) return unsupported('types');
    condition.resourceTypes = rt;
    if (domainType) condition.domainType = domainType;
    if (requestDomains.length) condition.requestDomains = requestDomains;
    if (excludedRequestDomains.length) {
      condition.excludedRequestDomains = [
        ...(condition.excludedRequestDomains ?? []),
        ...excludedRequestDomains,
      ];
    }
    if (methods.length) condition.requestMethods = methods;
    const rule: CompiledRule = {
      priority: PRIORITY.block + (important ? PRIORITY.important : 0),
      action: {
        type: 'redirect',
        redirect: { transform: { queryTransform: { removeParams: [removeParam] } } },
      },
      condition,
    };
    return { kind: 'rule', rule, param: removeParam };
  }

  if (csp !== null) {
    // A policy belongs to the page being loaded, so `domain=` names that page, not an initiator.
    if (popup || pattern.startsWith('/') || types.size > 0 || /[^\x20-\x7e]/.test(pattern)) {
      return unsupported('csp');
    }
    const p = ['', '*'].includes(pattern) ? '' : pattern.replace(/\*+$/, '');
    const condition: DnrCondition = { resourceTypes: ['main_frame', 'sub_frame'] };
    if (p) condition.urlFilter = p;
    if (initiators.length) condition.requestDomains = initiators;
    if (excludedInitiators.length) condition.excludedRequestDomains = excludedInitiators;
    if (!p && !initiators.length) return unsupported('too-broad');
    return {
      kind: 'rule',
      rule: {
        priority: PRIORITY.block + (important ? PRIORITY.important : 0),
        action: {
          type: 'modifyHeaders',
          responseHeaders: [{ header: 'content-security-policy', operation: 'append', value: csp }],
        },
        condition,
      },
    };
  }

  if (popup && (types.size > 0 || document)) return unsupported('popup');
  // Blocking a page: the navigation never reaches the server, and the background shows a
  // warning page with a way through (see background/security.ts).
  if (document && !exception) {
    types.add('main_frame').add('sub_frame');
    document = false;
  }

  const condition: DnrCondition = {};
  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    if (!opts.allowRegex) return unsupported('regex');
    const re2 = toRe2(pattern.slice(1, -1));
    if (!re2) return unsupported('regex');
    // A loosened pattern is fine for what a page loads; it must not block whole pages.
    if (re2.loosened && (document || types.has('main_frame'))) return unsupported('regex');
    condition.regexFilter = re2.regex;
  } else {
    if (/[^\x20-\x7e]/.test(pattern)) return unsupported('non-ascii');
    if (pattern.startsWith('||*')) return unsupported('syntax');
    const p = ['', '*', '|', '||', '|*'].includes(pattern)
      ? ''
      : pattern.replace(/^\*+/, '').replace(/\*+$/, '');
    if (p) condition.urlFilter = p;
  }
  if (matchCase) condition.isUrlFilterCaseSensitive = true;

  if (document) {
    condition.resourceTypes = ['main_frame', 'sub_frame'];
  } else if (types.size > 0) {
    const resourceTypes = [...types].filter((t) => !excludedTypes.has(t));
    if (resourceTypes.length === 0) return unsupported('types');
    condition.resourceTypes = resourceTypes;
  } else if (excludedTypes.size > 0) {
    condition.excludedResourceTypes = [...excludedTypes];
  }
  if (domainType) condition.domainType = domainType;
  if (initiators.length) condition.initiatorDomains = initiators;
  if (excludedInitiators.length) condition.excludedInitiatorDomains = excludedInitiators;
  if (requestDomains.length) condition.requestDomains = requestDomains;
  if (excludedRequestDomains.length) condition.excludedRequestDomains = excludedRequestDomains;
  if (methods.length) condition.requestMethods = methods;
  if (excludedMethods.length) condition.excludedRequestMethods = excludedMethods;

  if (
    !condition.urlFilter &&
    !condition.regexFilter &&
    !initiators.length &&
    !requestDomains.length
  ) {
    return unsupported('too-broad');
  }

  const action: CompiledRule['action'] = surrogate
    ? { type: 'redirect', redirect: { extensionPath: surrogate } }
    : { type: document ? 'allowAllRequests' : exception ? 'allow' : 'block' };
  const base = exception ? PRIORITY.allow : surrogate ? PRIORITY.redirect : PRIORITY.block;
  const rule = { priority: base + (important ? PRIORITY.important : 0), action, condition };
  return { kind: popup ? 'popup' : 'rule', rule };
}

const BADFILTER_RE = /(\$|,)badfilter(?=,|$)/;

function stripBadfilter(line: string): string {
  return line
    .replace(/,badfilter(?=,|$)/, '')
    .replace(/\$badfilter,?/, (m) => (m.endsWith(',') ? '$' : ''));
}

/**
 * Compiles a whole list: honours `$badfilter`, dedupes, and merges plain `||domain^` rules that
 * share every other property into one rule with `requestDomains`.
 */
export function compileList(
  lines: readonly string[],
  opts: CompileOptions,
): {
  rules: CompiledRule[];
  popupRules: CompiledRule[];
  /** The page-blocking subset of `rules`, kept to explain a blocked navigation. */
  documentRules: CompiledRule[];
  stats: ListStats;
} {
  const stats: ListStats = {
    networkFilters: 0,
    converted: 0,
    dnrRules: 0,
    popupRules: 0,
    cosmetic: 0,
    badfiltered: 0,
    unsupported: {},
  };
  const disabled = new Set(lines.filter((l) => BADFILTER_RE.test(l)).map(stripBadfilter));
  const merged = new Map<string, { base: CompiledRule; domains: Set<string> }>();
  const plain = new Map<string, CompiledRule>();
  const popups = new Map<string, CompiledRule>();
  const paramRules: { rule: CompiledRule; param: string }[] = [];
  /** Parameter name, or '*' for all, to hosts where it must be kept. */
  const keepParams = new Map<string, Set<string>>();

  for (const line of lines) {
    if (BADFILTER_RE.test(line)) continue;
    const out = compileFilter(line, opts);
    if (out.kind === 'comment') continue;
    if (out.kind === 'cosmetic') {
      stats.cosmetic++;
      continue;
    }
    stats.networkFilters++;
    if (disabled.has(line)) {
      stats.badfiltered++;
      continue;
    }
    if (out.kind === 'unsupported') {
      stats.unsupported[out.reason] = (stats.unsupported[out.reason] ?? 0) + 1;
      continue;
    }
    stats.converted++;
    if (out.kind === 'paramException') {
      const key = out.param ?? '*';
      const hosts = keepParams.get(key) ?? new Set<string>();
      for (const h of out.hosts) hosts.add(h);
      keepParams.set(key, hosts);
      continue;
    }
    const { rule } = out;
    if (out.kind === 'rule' && out.param !== undefined) {
      paramRules.push({ rule, param: out.param });
      continue;
    }
    if (out.kind === 'popup') {
      popups.set(JSON.stringify(rule), rule);
      continue;
    }
    const domain = DOMAIN_ONLY_RE.exec(rule.condition.urlFilter ?? '')?.[1];
    if (domain && !rule.condition.requestDomains && !rule.condition.excludedRequestDomains) {
      const rest = { ...rule.condition };
      delete rest.urlFilter;
      const base = { ...rule, condition: rest };
      const key = JSON.stringify(base);
      const group = merged.get(key) ?? { base, domains: new Set<string>() };
      group.domains.add(domain);
      merged.set(key, group);
    } else {
      plain.set(JSON.stringify(rule), rule);
    }
  }

  // An exception keeps the parameter on its whole host, even if it named a narrower URL.
  for (const { rule, param } of paramRules) {
    const keep = [...(keepParams.get(param) ?? []), ...(keepParams.get('*') ?? [])];
    const excluded = [...new Set([...(rule.condition.excludedRequestDomains ?? []), ...keep])];
    const scoped = excluded.length
      ? { ...rule, condition: { ...rule.condition, excludedRequestDomains: excluded.sort() } }
      : rule;
    plain.set(JSON.stringify(scoped), scoped);
  }

  const rules: CompiledRule[] = [
    ...[...merged.values()].map(({ base, domains }) => ({
      ...base,
      condition: { ...base.condition, requestDomains: [...domains].sort() },
    })),
    ...plain.values(),
  ];
  stats.dnrRules = rules.length;
  stats.popupRules = popups.size;
  const documentRules = rules.filter(
    (r) =>
      r.action.type === 'allowAllRequests' ||
      ((r.action.type === 'block' || r.action.type === 'allow') &&
        r.condition.resourceTypes?.includes('main_frame')),
  );
  return { rules, popupRules: [...popups.values()], documentRules, stats };
}

export function withIds(rules: readonly CompiledRule[], firstId: number): DnrRule[] {
  return rules.map((r, i) => ({ id: firstId + i, ...r }));
}
