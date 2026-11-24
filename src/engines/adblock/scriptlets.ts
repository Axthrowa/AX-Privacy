/**
 * `+js()` rules, compiled at build time into a string table the page script searches directly:
 * uBO Lite's trick for running them before any page script, without waking the service worker.
 * Rows are `\nhost\t3,17\n` and `\n~3\t[name, ...args]\n`: lists repeat one call on hundreds of
 * hosts, and only the rows for this page are ever parsed.
 */

export type ScriptletCall = [name: string, ...args: string[]];

/** Names we implement, including the aliases uBO and AdGuard lists use for the same job. */
export const CANON: Readonly<Record<string, string>> = {
  aopr: 'aopr',
  'abort-on-property-read': 'aopr',
  aopw: 'aopw',
  'abort-on-property-write': 'aopw',
  acs: 'acs',
  'abort-current-script': 'acs',
  'abort-current-inline-script': 'acs',
  acis: 'acs',
  aost: 'aost',
  'abort-on-stack-trace': 'aost',
  set: 'set',
  'set-constant': 'set',
  nowoif: 'nowoif',
  'no-window-open-if': 'nowoif',
  'prevent-window-open': 'nowoif',
  'window.open-defuser': 'nowoif',
  nostif: 'nostif',
  'no-setTimeout-if': 'nostif',
  'prevent-setTimeout': 'nostif',
  'setTimeout-defuser': 'nostif',
  nosiif: 'nosiif',
  'no-setInterval-if': 'nosiif',
  'prevent-setInterval': 'nosiif',
  'setInterval-defuser': 'nosiif',
  'nano-sib': 'nano-sib',
  'nano-setInterval-booster': 'nano-sib',
  'adjust-setInterval': 'nano-sib',
  'nano-stb': 'nano-stb',
  'nano-setTimeout-booster': 'nano-stb',
  'adjust-setTimeout': 'nano-stb',
  aeld: 'aeld',
  'addEventListener-defuser': 'aeld',
  'prevent-addEventListener': 'aeld',
  'no-fetch-if': 'no-fetch-if',
  'prevent-fetch': 'no-fetch-if',
  'no-xhr-if': 'no-xhr-if',
  'prevent-xhr': 'no-xhr-if',
  rmnt: 'rmnt',
  'remove-node-text': 'rmnt',
  rpnt: 'rpnt',
  'replace-node-text': 'rpnt',
  ra: 'ra',
  'remove-attr': 'ra',
  rc: 'rc',
  'remove-class': 'rc',
  noeval: 'noeval-if',
  'noeval-silent': 'noeval-if',
  'noeval-if': 'noeval-if',
  'prevent-eval-if': 'noeval-if',
  'json-prune': 'json-prune',
  'json-prune-fetch-response': 'json-prune-fetch-response',
  'set-cookie': 'set-cookie',
  'set-local-storage-item': 'set-local-storage-item',
  'set-session-storage-item': 'set-session-storage-item',
  nowebrtc: 'nowebrtc',
  'href-sanitizer': 'href-sanitizer',
  'remove-cookie': 'remove-cookie',
  'cookie-remover': 'remove-cookie',
  nobab: 'nobab',
  'bab-defuser': 'nobab',
  nofab: 'nofab',
  'fuckadblock.js-3.2.0': 'nofab',
  'popads-dummy': 'popads-dummy',
  'json-prune-xhr-response': 'json-prune-xhr-response',
  'xml-prune': 'xml-prune',
  'refresh-defuser': 'refresh-defuser',
  'prevent-refresh': 'refresh-defuser',
  'set-attr': 'set-attr',
  'trusted-set-attr': 'set-attr',
  'trusted-set': 'trusted-set',
  'trusted-set-constant': 'trusted-set',
  'trusted-set-cookie': 'trusted-set-cookie',
  'set-cookie-reload': 'set-cookie-reload',
  'trusted-set-cookie-reload': 'trusted-set-cookie-reload',
  'spoof-css': 'spoof-css',
  // Lists only reach pages from the built-in catalog (build time), so their trusted variants are too.
  'trusted-rpfr': 'trusted-replace-fetch-response',
  'trusted-replace-fetch-response': 'trusted-replace-fetch-response',
  'trusted-replace-xhr-response': 'trusted-replace-xhr-response',
  'json-edit': 'json-edit',
  'm3u-prune': 'm3u-prune',
  'trusted-replace-outbound-text': 'trusted-replace-outbound-text',
  'trusted-prevent-dom-bypass': 'trusted-prevent-dom-bypass',
  'trusted-json-edit': 'trusted-json-edit',
  'json-edit-fetch-response': 'json-edit-fetch-response',
  'trusted-json-edit-fetch-response': 'trusted-json-edit-fetch-response',
  'json-edit-xhr-response': 'json-edit-xhr-response',
  'trusted-json-edit-xhr-response': 'trusted-json-edit-xhr-response',
  'trusted-set-local-storage-item': 'trusted-set-local-storage-item',
  'trusted-set-session-storage-item': 'trusted-set-session-storage-item',
  'prevent-innerHTML': 'prevent-innerHTML',
  norafif: 'norafif',
  'no-requestAnimationFrame-if': 'norafif',
  'trusted-replace-argument': 'trusted-replace-argument',
  'trusted-prevent-xhr': 'no-xhr-if',
  'trusted-prevent-fetch': 'no-fetch-if',
  // Replacements still pass `safeReplacement`: list text never becomes page code.
  'trusted-rpnt': 'rpnt',
  'trusted-replace-node-text': 'rpnt',
  'trusted-suppress-native-method': 'trusted-suppress-native-method',
  'trusted-create-html': 'trusted-create-html',
  'trusted-click-element': 'trusted-click-element',
  'trusted-edit-inbound-object': 'trusted-edit-inbound-object',
  'trusted-prune-inbound-object': 'trusted-prune-inbound-object',
  'trusted-override-element-method': 'trusted-override-element-method',
  'edit-object-on-setter': 'edit-object-on-setter',
  'trusted-edit-object-on-setter': 'trusted-edit-object-on-setter',
  'jsonl-edit-xhr-response': 'jsonl-edit-xhr-response',
  'trusted-jsonl-edit-xhr-response': 'trusted-jsonl-edit-xhr-response',
  'json-edit-fetch-request': 'json-edit-fetch-request',
  'trusted-json-edit-fetch-request': 'trusted-json-edit-fetch-request',
  'prevent-clipboard-write': 'prevent-clipboard-write',
  'disable-newtab-links': 'disable-newtab-links',
  'prevent-canvas': 'prevent-canvas',
  'prevent-dialog': 'prevent-dialog',
  'window-close-if': 'window-close-if',
  'alert-buster': 'alert-buster',
  'prevent-navigation': 'prevent-navigation',
  'popads.net': 'popads.net',
  'google-ima': 'google-ima',
  'google-ima3': 'google-ima',
  fingerprint2: 'fingerprint2',
};

export function canonScriptlet(name: string): string | null {
  const bare = name.trim().replace(/\.js$/, '');
  return Object.hasOwn(CANON, bare) ? (CANON[bare] ?? null) : null;
}

/**
 * `rpnt` writes its replacement into the page's script text, so a replacement is only accepted if it
 * cannot be code, and with no extra options (`condition`, `sedCount`) we do not implement. Lists use
 * the rest to patch in whole programs that work together with other rule types we do not run.
 */
export function safeReplacement(args: readonly string[]): boolean {
  return args.length <= 3 && /^[\w\s.,:"'=-]*$/.test(args[2] ?? '');
}

/** Splits `name, 'a,b', c\,d` the way uBO reads `+js()` arguments. */
export function parseArgs(raw: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= raw.length) {
    while (raw[i] === ' ') i++;
    const q = raw[i];
    if (q === "'" || q === '"' || q === '`') {
      let end = i + 1;
      while (end < raw.length && !(raw[end] === q && raw[end - 1] !== '\\')) end++;
      if (end < raw.length && /^\s*(,|$)/.test(raw.slice(end + 1))) {
        out.push(raw.slice(i + 1, end).replaceAll(`\\${q}`, q));
        const comma = raw.indexOf(',', end);
        if (comma < 0) return out;
        i = comma + 1;
        continue;
      }
    }
    let cur = '';
    for (; i < raw.length && raw[i] !== ','; i++) {
      if (raw[i] === '\\' && raw[i + 1] === ',') i++;
      cur += raw[i];
    }
    out.push(cur.trim());
    i++;
  }
  return out;
}

const LINE_RE = /^([^#]*)#(@?)#\+js\((.*)\)$/;

/** Exceptions are stored as calls with a `!` name; `!` alone turns every scriptlet off. */
export function compileScriptlets(lines: readonly string[]): {
  table: string;
  rules: number;
  skipped: number;
} {
  const byHost = new Map<string, Map<string, ScriptletCall>>();
  let rules = 0;
  let skipped = 0;
  const add = (host: string, call: ScriptletCall) => {
    const calls = byHost.get(host) ?? new Map<string, ScriptletCall>();
    calls.set(JSON.stringify(call), call);
    byHost.set(host, calls);
  };
  for (const line of lines) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, hostList = '', at, body = ''] = m;
    const exception = at === '@';
    let call: ScriptletCall;
    if (body === '') {
      if (!exception) continue;
      call = ['!'];
    } else {
      const [rawName = '', ...args] = parseArgs(body);
      const name = canonScriptlet(rawName);
      if (!name || (name === 'rpnt' && !safeReplacement(args))) {
        skipped++;
        continue;
      }
      call = [exception ? `!${name}` : name, ...args];
    }
    const hosts = hostList.split(',').filter(Boolean);
    const scoped = (h: string) => h.startsWith('/') || h.includes('>>');
    const positive = hosts.filter((h) => !h.startsWith('~') && !scoped(h));
    // A rule scoped only by forms we cannot match must not fall through to "every site".
    if (hosts.length > 0 && hosts.every(scoped)) {
      skipped++;
      continue;
    }
    rules++;
    const generic = hosts.filter((h) => !h.startsWith('~')).length === 0;
    if (generic && !exception) add('*', call);
    for (const h of positive) add(h, call);
    if (!exception) {
      for (const h of hosts) {
        if (h.startsWith('~')) add(h.slice(1), [`!${call[0]}`, ...call.slice(1)] as ScriptletCall);
      }
    }
  }
  const index = new Map<string, number>();
  let table = '\n';
  for (const [host, calls] of byHost) {
    const ids = [...calls.keys()].map((key) => {
      const id = index.get(key) ?? index.size;
      index.set(key, id);
      return id;
    });
    table += `${host}\t${ids.join(',')}\n`;
  }
  for (const [key, id] of index) table += `~${id}\t${key}\n`;
  return { table: table === '\n' ? '' : table, rules, skipped };
}

/** The host, its parent domains, and `name.*` forms of those for wildcard-TLD rules. */
function candidates(hostname: string): string[] {
  const labels = hostname.split('.');
  const out = ['*'];
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i);
    out.push(suffix.join('.'));
    // shortcut: strips at most a two-label TLD (`com.tr`); enough for every `name.*` list rule.
    for (const cut of [1, 2]) {
      if (suffix.length > cut) out.push(`${suffix.slice(0, -cut).join('.')}.*`);
    }
  }
  return out;
}

function row(table: string, key: string): string | null {
  const needle = `\n${key}\t`;
  const at = table.indexOf(needle);
  if (at < 0) return null;
  const start = at + needle.length;
  return table.slice(start, table.indexOf('\n', start));
}

/** Scriptlets for a page, exceptions applied. Rows come from `compileScriptlets`. */
export function callsFor(tables: readonly string[], hostname: string): ScriptletCall[] {
  const found = new Map<string, ScriptletCall>();
  const off = new Set<string>();
  let allOff = false;
  for (const host of candidates(hostname)) {
    for (const table of tables) {
      const ids = row(table, host);
      if (ids === null) continue;
      for (const id of ids.split(',')) {
        const call = JSON.parse(row(table, `~${id}`) ?? '["!"]') as ScriptletCall;
        if (call[0] === '!') allOff = true;
        else if (call[0].startsWith('!')) {
          off.add(JSON.stringify([call[0].slice(1), ...call.slice(1)]));
        } else found.set(JSON.stringify(call), call);
      }
    }
  }
  if (allOff) return [];
  return [...found].filter(([key]) => !off.has(key)).map(([, call]) => call);
}

/** host -> call keys (JSON), read back from a compiled table. */
function tableEntries(table: string): Map<string, string[]> {
  const calls = new Map<string, string>();
  const rows: [string, string][] = [];
  for (const line of table.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const key = line.slice(0, tab);
    const value = line.slice(tab + 1);
    if (key.startsWith('~')) calls.set(key.slice(1), value);
    else rows.push([key, value]);
  }
  return new Map(
    rows.map(([host, ids]) => [
      host,
      ids
        .split(',')
        .map((id) => calls.get(id))
        .filter((c): c is string => c !== undefined),
    ]),
  );
}

/**
 * The rows of an updated list's table that the packaged one lacks, as a table of their own. Only
 * this goes to pages between releases: data naming packaged scriptlets, never code.
 */
export function tableDelta(updated: string, packaged: string): string {
  const old = tableEntries(packaged);
  const lines: string[] = [];
  const index = new Map<string, number>();
  for (const [host, keys] of tableEntries(updated)) {
    const had = new Set(old.get(host));
    const ids = keys
      .filter((k) => !had.has(k))
      .map((k) => {
        const id = index.get(k) ?? index.size;
        index.set(k, id);
        return id;
      });
    if (ids.length) lines.push(`${host}\t${ids.join(',')}`);
  }
  if (!lines.length) return '';
  for (const [key, id] of index) lines.push(`~${id}\t${key}`);
  return `\n${lines.join('\n')}\n`;
}

/** List id -> `+js()` rows newer than the package, read by content/scriptlets-delta.ts. */
export const SCRIPTLET_DELTA_KEY = 'scriptletDelta';

/** The table inside a packaged `scriptlets/<id>.js` data file. */
export function packagedTable(file: string): string {
  const m = /\.push\(("(?:[^"\\]|\\.)*")\)/.exec(file);
  return m?.[1] ? (JSON.parse(m[1]) as string) : '';
}
