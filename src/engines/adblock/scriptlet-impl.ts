import { decoy } from '../popup/decoy.ts';

/**
 * Page-world implementations of the `+js()` rules the bundled lists use most.
 * Written against the behaviour uBO's scriptlets document; nothing here fetches or evaluates text
 * from a list: rule arguments only ever become patterns, property paths, fixed constants and plain
 * replacements (see `safeReplacement`).
 */

type Fn = (...args: unknown[]) => unknown;
type Owner = Record<string, unknown>;

const isObject = (v: unknown): v is object =>
  (typeof v === 'object' && v !== null) || typeof v === 'function';

/** `/re/flags` or a literal; empty matches everything, a leading `!` inverts. */
export function matcher(pattern = ''): (s: string) => boolean {
  const negate = pattern.startsWith('!');
  const p = negate ? pattern.slice(1) : pattern;
  if (p === '' || p === '*') return () => !negate;
  const m = /^\/(.+)\/([dgimsuvy]*)$/.exec(p);
  let test = (s: string) => s.includes(p);
  if (m) {
    try {
      const re = new RegExp(m[1] ?? '', (m[2] ?? '').replace(/[gy]/g, ''));
      test = (s) => re.test(s);
    } catch {
      return () => false;
    }
  }
  return (s) => test(s) !== negate;
}

/** Reaches `a.b.c`, waiting through setters for the parts the page has not created yet. */
function onLeaf(owner: Owner, path: string, leaf: (owner: Owner, prop: string) => void): void {
  const dot = path.indexOf('.');
  if (dot < 0) {
    leaf(owner, path);
    return;
  }
  const head = path.slice(0, dot);
  const rest = path.slice(dot + 1);
  let value = owner[head];
  if (isObject(value)) {
    onLeaf(value as Owner, rest, leaf);
    return;
  }
  const desc = Object.getOwnPropertyDescriptor(owner, head);
  if (desc && !desc.configurable) return;
  Object.defineProperty(owner, head, {
    configurable: true,
    get: () => value,
    set(next: unknown) {
      value = next;
      if (isObject(value)) onLeaf(value as Owner, rest, leaf);
    },
  });
}

const aborted = () => new ReferenceError('nexus');

function guardProp(path: string, shouldAbort: () => boolean, on: 'read' | 'write' | 'both'): void {
  onLeaf(window as unknown as Owner, path, (owner, prop) => {
    const desc = Object.getOwnPropertyDescriptor(owner, prop);
    if (desc && !desc.configurable) return;
    let value = owner[prop];
    Object.defineProperty(owner, prop, {
      configurable: true,
      get() {
        if (on !== 'write' && shouldAbort()) throw aborted();
        return desc?.get ? desc.get.call(owner) : value;
      },
      set(next: unknown) {
        if (on !== 'read' && shouldAbort()) throw aborted();
        if (desc?.set) desc.set.call(owner, next);
        else value = next;
      },
    });
  });
}

const CONSTANTS: Readonly<Record<string, () => unknown>> = {
  undefined: () => undefined,
  null: () => null,
  true: () => true,
  false: () => false,
  yes: () => true,
  no: () => false,
  '': () => '',
  "''": () => '',
  noopFunc: () => () => undefined,
  trueFunc: () => () => true,
  falseFunc: () => () => false,
  throwFunc: () => () => {
    throw aborted();
  },
  noopPromiseResolve: () => () => Promise.resolve(),
  noopPromiseReject: () => () => Promise.reject(aborted()),
  emptyObj: () => ({}),
  '{}': () => ({}),
  emptyArr: () => [],
  '[]': () => [],
  NaN: () => NaN,
};

export function constant(raw = ''): { ok: boolean; value?: unknown } {
  if (Object.hasOwn(CONSTANTS, raw)) return { ok: true, value: CONSTANTS[raw]?.() };
  if (/^-?\d+(\.\d+)?$/.test(raw) && Math.abs(Number(raw)) <= 0x7fff) {
    return { ok: true, value: Number(raw) };
  }
  if (/^(['"]).*\1$/.test(raw)) return { ok: true, value: raw.slice(1, -1) };
  return { ok: false };
}

const originals = new WeakMap<object, object>();
let toStringHidden = false;

/** Proxies keep name and length; this makes `toString()` answer for the original as well. */
function hideToString(): void {
  if (toStringHidden) return;
  toStringHidden = true;
  const native = Function.prototype.toString;
  const proxy = new Proxy(native, {
    apply: (target, self: object, args: []) =>
      Reflect.apply(target, originals.get(self) ?? self, args),
  });
  originals.set(proxy, native);
  Function.prototype.toString = proxy;
}

/** Wraps a native so that page checks still see the original. */
function wrap(
  owner: object,
  prop: string,
  apply: (native: Fn, self: unknown, args: unknown[]) => unknown,
): void {
  const native = (owner as Owner)[prop] as Fn | undefined;
  if (typeof native !== 'function') return;
  hideToString();
  const proxy = new Proxy(native, {
    apply: (target, self, args: unknown[]) => apply(target, self, args),
  });
  originals.set(proxy, native);
  (owner as Owner)[prop] = proxy;
}

const callbackText = (cb: unknown) => (typeof cb === 'function' ? cb.toString() : String(cb));

/** `no-setTimeout-if` and friends: the callback is emptied, the timer itself still runs. */
function defuseTimer(prop: 'setTimeout' | 'setInterval', needle = '', delay = ''): void {
  const hit = matcher(needle);
  const negate = delay.startsWith('!');
  const want = parseInt(negate ? delay.slice(1) : delay, 10);
  wrap(window, prop, (native, self, args) => {
    const delayOk = Number.isNaN(want) || (Number(args[1] ?? 0) === want) !== negate;
    if (delayOk && hit(callbackText(args[0]))) args[0] = () => undefined;
    return Reflect.apply(native, self, args);
  });
}

function boostTimer(prop: 'setTimeout' | 'setInterval', needle = '', delay = '', boost = ''): void {
  const hit = matcher(needle);
  const parsed = parseInt(delay, 10);
  const wanted = Number.isNaN(parsed) ? 1000 : parsed;
  const b = parseFloat(boost);
  const factor = b >= 0.001 && b <= 50 ? b : 0.05;
  wrap(window, prop, (native, self, args) => {
    if ((delay === '*' || Number(args[1]) === wanted) && hit(callbackText(args[0]))) {
      args[1] = Number(args[1] ?? 0) * factor;
    }
    return Reflect.apply(native, self, args);
  });
}

/** `url:/ads/ method:POST`, or a bare pattern against the URL. */
export function requestMatcher(raw = ''): (props: Record<string, string>) => boolean {
  if (raw === '' || raw === '*') return () => true;
  const tests: [string, (s: string) => boolean][] = [];
  for (const part of raw.split(/\s+/)) {
    const m = /^(\w+):(.*)$/.exec(part);
    tests.push(m ? [m[1] ?? 'url', matcher(m[2])] : ['url', matcher(part)]);
  }
  return (props) => tests.every(([k, t]) => t(props[k] ?? ''));
}

function requestProps(input: unknown, init?: RequestInit): Record<string, string> {
  const req = input instanceof Request ? input : null;
  const out: Record<string, string> = {
    url: req ? req.url : String(input),
    method: init?.method ?? req?.method ?? 'GET',
  };
  if (typeof init?.body === 'string') out.body = init.body;
  return out;
}

function noFetchIf(pattern = '', body = ''): void {
  const hit = requestMatcher(pattern);
  const text = body === 'emptyObj' ? '{}' : body === 'emptyArr' ? '[]' : '';
  wrap(window, 'fetch', (native, self, args) =>
    hit(requestProps(args[0], args[1] as RequestInit | undefined))
      ? Promise.resolve(new Response(text, { status: 200 }))
      : Reflect.apply(native, self, args),
  );
}

function noXhrIf(pattern = ''): void {
  const hit = requestMatcher(pattern);
  const blocked = new WeakSet<XMLHttpRequest>();
  wrap(XMLHttpRequest.prototype, 'open', (native, self, args) => {
    const xhr = self as XMLHttpRequest;
    if (hit({ method: String(args[0]), url: String(args[1]) })) blocked.add(xhr);
    else blocked.delete(xhr);
    return Reflect.apply(native, self, args);
  });
  wrap(XMLHttpRequest.prototype, 'send', (native, self, args) => {
    const xhr = self as XMLHttpRequest;
    if (!blocked.has(xhr)) return Reflect.apply(native, self, args);
    for (const [k, value] of [
      ['readyState', 4],
      ['status', 200],
      ['statusText', 'OK'],
      ['response', ''],
      ['responseText', ''],
    ] as const) {
      Object.defineProperty(xhr, k, { configurable: true, value });
    }
    setTimeout(() => {
      for (const t of ['readystatechange', 'load', 'loadend']) xhr.dispatchEvent(new Event(t));
    });
    return undefined;
  });
}

/** Runs `apply` on existing and new nodes until the page has loaded, or for good with `stay`. */
function watchDom(apply: (nodes: Node[] | null) => void, stay = false): void {
  apply(null);
  const observer = new MutationObserver((records) => {
    apply(records.flatMap((r) => [...r.addedNodes]));
  });
  observer.observe(document, { childList: true, subtree: true });
  if (!stay) {
    addEventListener(
      'load',
      () => {
        apply(null);
        observer.disconnect();
      },
      { once: true },
    );
  }
}

/**
 * Pages enforcing Trusted Types refuse plain text on script nodes. A page's CSP may also refuse this
 * policy; an edit that cannot happen must stay silent, or the rule itself would raise page errors.
 */
function scriptTextSetter(): (el: Element, text: string) => void {
  let policy: { createScript(s: string): unknown } | undefined;
  try {
    policy = (
      self as unknown as {
        trustedTypes?: {
          createPolicy(n: string, p: { createScript(s: string): string }): typeof policy;
        };
      }
    ).trustedTypes?.createPolicy('nexus-node-text', { createScript: (s) => s });
  } catch {
    policy = undefined;
  }
  return (el, text) => {
    try {
      const value = el instanceof HTMLScriptElement && policy ? policy.createScript(text) : text;
      el.textContent = value as string;
    } catch {
      if (text === '') el.remove();
    }
  };
}

/** With no `replacement`, the whole text of a matching node goes: that is what `rmnt` means. */
function replaceNodeText(nodeName = '', pattern = '', replacement?: string): void {
  const tag = nodeName.toUpperCase();
  const hit = matcher(pattern);
  const m = /^\/(.+)\/([dimsuv]*)$/.exec(pattern);
  const setText = scriptTextSetter();
  // Each node once: a replacement that still matches would otherwise retrigger the observer forever.
  const done = new WeakSet<Element>();
  const edit = (el: Element) => {
    const text = el.textContent ?? '';
    if (done.has(el) || !hit(text)) return;
    done.add(el);
    if (replacement === undefined) {
      setText(el, '');
      return;
    }
    setText(
      el,
      m
        ? text.replace(new RegExp(m[1] ?? '', `g${m[2] ?? ''}`), replacement)
        : text.replaceAll(pattern, replacement),
    );
  };
  watchDom((nodes) => {
    if (nodes === null) {
      for (const el of document.querySelectorAll(nodeName)) edit(el);
      return;
    }
    for (const n of nodes) {
      if (n instanceof Element && n.nodeName === tag) edit(n);
      else if (n instanceof Text && n.parentElement?.nodeName === tag) edit(n.parentElement);
    }
  });
}

function strip(
  tokens: string,
  selector: string,
  behavior: string,
  remove: (el: Element, token: string) => void,
  near: (t: string) => string,
): void {
  const list = tokens.split(/\s*\|\s*/).filter(Boolean);
  if (list.length === 0) return;
  const query = selector || list.map(near).join(',');
  let queued = false;
  const run = () => {
    queued = false;
    for (const el of document.querySelectorAll(query)) for (const t of list) remove(el, t);
  };
  // Attribute and class edits batch per frame: these pages often mutate the DOM constantly.
  watchDom(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  }, behavior.includes('stay'));
}

/** Paths like `a.b`, `a.[].b`, `a.*.b`, as json-prune writes them. */
export function pruneJson(
  root: unknown,
  paths: readonly string[],
  required: readonly string[] = [],
): void {
  const walk = (o: unknown, parts: readonly string[], act: (p: Owner, k: string) => void): void => {
    if (!isObject(o) || parts.length === 0) return;
    const [head = '', ...rest] = parts;
    const obj = o as Owner;
    const all = head === '[]' || head === '[-]' || head === '*';
    const keys = all ? Object.keys(obj) : head in obj ? [head] : [];
    for (const k of keys) {
      if (rest.length === 0) act(obj, k);
      else walk(obj[k], rest, act);
    }
  };
  for (const r of required) {
    let seen = false;
    walk(root, r.split('.'), () => {
      seen = true;
    });
    if (!seen) return;
  }
  for (const p of paths) {
    walk(root, p.split('.'), (obj, k) => {
      Reflect.deleteProperty(obj, k);
    });
  }
}

const words = (s = '') => s.split(/\s+/).filter(Boolean);

/** Response body of an XHR as the page would read it, after `edit`. */
function filterXhrText(
  hit: (props: Record<string, string>) => boolean,
  edit: (text: string) => string,
): void {
  const urls = new WeakMap<XMLHttpRequest, Record<string, string>>();
  wrap(XMLHttpRequest.prototype, 'open', (native, self, args) => {
    urls.set(self as XMLHttpRequest, { method: String(args[0]), url: String(args[1]) });
    return Reflect.apply(native, self, args);
  });
  for (const prop of ['response', 'responseText'] as const) {
    const desc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, prop);
    if (!desc?.get) continue;
    const get = desc.get;
    Object.defineProperty(XMLHttpRequest.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get(this: XMLHttpRequest) {
        const value: unknown = get.call(this);
        const props = urls.get(this);
        if (typeof value !== 'string' || !props || !hit(props)) return value;
        try {
          return edit(value);
        } catch {
          return value;
        }
      },
    });
  }
}

function propsAfter(rest: readonly string[]): (props: Record<string, string>) => boolean {
  const at = rest.indexOf('propsToMatch');
  return requestMatcher(at >= 0 ? rest[at + 1] : '');
}

function jsonPruneXhr(paths = '', required = '', ...rest: string[]): void {
  const list = words(paths);
  if (list.length === 0) return;
  const need = words(required);
  filterXhrText(propsAfter(rest), (text) => {
    const data: unknown = JSON.parse(text);
    pruneJson(data, list, need);
    return JSON.stringify(data);
  });
}

/** Removes matching nodes from an XML response: ad periods in video manifests and VAST files. */
function xmlPrune(selector = '', needle = '', url = ''): void {
  if (!selector) return;
  const urlHit = matcher(url);
  const textHit = matcher(needle);
  const xpath = /^xpath\((.+)\)$/.exec(selector)?.[1];
  const prune = (text: string): string => {
    if (!text.trimStart().startsWith('<') || !textHit(text)) return text;
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) return text;
    let nodes: Node[];
    if (xpath) {
      const found = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      nodes = Array.from({ length: found.snapshotLength }, (_, i) => found.snapshotItem(i)).filter(
        (n): n is Node => n !== null,
      );
    } else {
      nodes = [...doc.querySelectorAll(selector)];
    }
    if (nodes.length === 0) return text;
    for (const n of nodes) {
      if (n instanceof Attr) n.ownerElement?.removeAttributeNode(n);
      else n.parentNode?.removeChild(n);
    }
    return new XMLSerializer().serializeToString(doc);
  };
  filterXhrText((props) => urlHit(props.url ?? ''), prune);
  wrap(Response.prototype, 'text', (native, self, args) =>
    (Reflect.apply(native, self, args) as Promise<string>).then((text) =>
      urlHit((self as Response).url) ? prune(text) : text,
    ),
  );
}

/** A link's `href` replaced by the real target it already carries in its text, a parameter or an attribute. */
function hrefSanitizer(selector = '', source = 'text'): void {
  if (!selector) return;
  let queued = false;
  const targetOf = (a: HTMLAnchorElement): string | null => {
    if (source === 'text') return a.textContent?.trim() ?? null;
    if (source.startsWith('?')) return new URL(a.href).searchParams.get(source.slice(1));
    if (source.startsWith('[')) return a.getAttribute(source.slice(1, -1));
    return null;
  };
  const run = () => {
    queued = false;
    for (const a of document.querySelectorAll(selector)) {
      if (!(a instanceof HTMLAnchorElement)) continue;
      try {
        const target = new URL(targetOf(a) ?? '');
        if (/^https?:$/.test(target.protocol)) a.href = target.href;
      } catch {
        // Not a URL: leave the link as the page made it.
      }
    }
  };
  watchDom(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  });
}

function removeCookies(needle = ''): void {
  const hit = matcher(needle);
  const run = () => {
    const labels = location.hostname.split('.');
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]?.trim() ?? '';
      if (!name || !hit(name)) continue;
      for (let i = 0; i < labels.length - 1; i++) {
        const domain = labels.slice(i).join('.');
        document.cookie = `${name}=; max-age=0; path=/; domain=${domain}`;
      }
      document.cookie = `${name}=; max-age=0; path=/`;
    }
  };
  run();
  addEventListener('load', run, { once: true });
  addEventListener('beforeunload', run);
}

/** The anti-adblock libraries' API, reporting that nothing is blocked. */
function fakeDetector(...names: string[]): void {
  class Detector {
    check() {
      return true;
    }
    clearEvent() {
      return this;
    }
    emitEvent() {
      return this;
    }
    on(detected: boolean, fn: () => void) {
      if (!detected) fn();
      return this;
    }
    onDetected() {
      return this;
    }
    onNotDetected(fn: () => void) {
      if (typeof fn === 'function') fn();
      return this;
    }
    setOption() {
      return this;
    }
  }
  const page = window as unknown as Owner;
  for (const name of names) {
    page[name] = /^[A-Z]/.test(name) ? Detector : new Detector();
  }
}

/** Value text with uBO's time placeholders; never more than one cookie or storage value. */
function literalValue(value: string): string {
  if (value === '$now$') return String(Date.now());
  if (value === '$currentDate$') return new Date().toUTCString();
  if (value === '$currentISODate$') return new Date().toISOString();
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function setAttr(selector = '', attr = '', value = ''): void {
  // Event handlers and URLs are how an attribute becomes code or a request.
  if (!selector || !/^[\w-]+$/.test(attr) || /^(on|src|href|srcdoc|action)/i.test(attr)) return;
  if (!/^[\w\s.:-]*$/.test(value)) return;
  watchDom(() => {
    for (const el of document.querySelectorAll(selector)) el.setAttribute(attr, value);
  }, true);
}

/** Replaces one argument of a method with a fixed constant, optionally only when it matches. */
function replaceArgument(path = '', position = '0', raw = '', ...rest: string[]): void {
  const c = constant(raw);
  const index = Number(position);
  if (!c.ok || !Number.isInteger(index)) return;
  const at = rest.indexOf('condition');
  const hit = matcher(at >= 0 ? rest[at + 1] : '');
  const dot = path.lastIndexOf('.');
  const ownerPath = path.slice(0, dot);
  const method = path.slice(dot + 1);
  if (dot < 0 || !method) return;
  const owner = ownerPath
    .split('.')
    .reduce<unknown>((o, key) => (isObject(o) ? (o as Owner)[key] : undefined), window);
  if (!isObject(owner)) return;
  wrap(owner, method, (native, self, args) => {
    if (index < args.length && hit(String(args[index]))) args[index] = c.value;
    return Reflect.apply(native, self, args);
  });
}

const COOKIE_VALUE =
  /^(?:\d{1,5}|true|false|yes|no|y|n|on|off|ok|okay|accept(?:ed)?|allow(?:ed)?|den(?:y|ied)|reject(?:ed)?|necessary|required|essential|dismiss(?:ed)?|hidden?|closed?|done|disabled?|enabled?|t|f)$/i;
const STORAGE_VALUE =
  /^(?:undefined|null|true|false|yes|no|on|off|\d{1,5}|accepted|rejected|emptyObj|emptyArr|)$/;

function setStorage(store: Storage, key = '', value = ''): void {
  if (!key) return;
  if (value === '$remove$') {
    store.removeItem(key);
  } else if (STORAGE_VALUE.test(value)) {
    const text = value === 'emptyObj' ? '{}' : value === 'emptyArr' ? '[]' : value;
    if (store.getItem(key) !== text) store.setItem(key, text);
  }
}

/** `trusted-set` also takes JSON, optionally as `{"value": ...}`. It stays data: parsed, never run. */
function jsonConstant(raw = ''): { ok: boolean; value?: unknown } {
  const plain = constant(raw);
  if (plain.ok) return plain;
  try {
    const parsed: unknown = JSON.parse(raw);
    const wrapped = isObject(parsed) && 'value' in parsed;
    return { ok: true, value: wrapped ? (parsed as { value: unknown }).value : parsed };
  } catch {
    return { ok: false };
  }
}

function setConstant(path: string, c: { ok: boolean; value?: unknown }): void {
  if (!c.ok) return;
  onLeaf(window as unknown as Owner, path, (owner, prop) => {
    const desc = Object.getOwnPropertyDescriptor(owner, prop);
    if (desc && !desc.configurable) return;
    Object.defineProperty(owner, prop, {
      configurable: true,
      enumerable: desc?.enumerable ?? true,
      get: () => c.value,
      set() {
        // The page's own assignment must not undo the rule.
      },
    });
  });
}

export const SCRIPTLETS: Readonly<Record<string, (...args: string[]) => void>> = {
  aopr: (path = '') => guardProp(path, () => true, 'read'),
  aopw: (path = '') => guardProp(path, () => true, 'write'),
  acs(path = '', needle = '') {
    const hit = matcher(needle);
    const own = document.currentScript;
    guardProp(
      path,
      () => {
        const e = document.currentScript;
        if (!(e instanceof HTMLScriptElement) || e === own) return false;
        return hit(`${e.src} ${e.textContent ?? ''}`);
      },
      'both',
    );
  },
  aost(path = '', needle = '') {
    const hit = matcher(needle);
    guardProp(path, () => hit(new Error().stack ?? ''), 'both');
  },
  set: (path = '', raw = '') => setConstant(path, constant(raw)),
  'trusted-set': (path = '', raw = '') => setConstant(path, jsonConstant(raw)),
  nowoif(pattern = '') {
    const hit = matcher(pattern);
    wrap(window, 'open', (native, self, args) => {
      const url = args[0] instanceof URL ? args[0].href : String(args[0] ?? '');
      return hit(url) ? decoy() : Reflect.apply(native, self, args);
    });
  },
  nostif: (needle, delay) => defuseTimer('setTimeout', needle, delay),
  nosiif: (needle, delay) => defuseTimer('setInterval', needle, delay),
  'nano-sib': (needle, delay, boost) => boostTimer('setInterval', needle, delay, boost),
  'nano-stb': (needle, delay, boost) => boostTimer('setTimeout', needle, delay, boost),
  aeld(type = '', needle = '') {
    const typeHit = matcher(type);
    const hit = matcher(needle);
    wrap(EventTarget.prototype, 'addEventListener', (native, self, args) => {
      if (typeHit(String(args[0])) && hit(args[1] ? String(args[1] as object) : '')) {
        return undefined;
      }
      return Reflect.apply(native, self, args);
    });
  },
  'no-fetch-if': noFetchIf,
  'no-xhr-if': noXhrIf,
  rmnt: (nodeName, pattern) => replaceNodeText(nodeName, pattern),
  rpnt: (nodeName, pattern, replacement = '') => replaceNodeText(nodeName, pattern, replacement),
  ra: (tokens = '', selector = '', behavior = '') =>
    strip(
      tokens,
      selector,
      behavior,
      (el, t) => el.removeAttribute(t),
      (t) => `[${t}]`,
    ),
  rc: (tokens = '', selector = '', behavior = '') =>
    strip(
      tokens,
      selector,
      behavior,
      (el, t) => el.classList.remove(t),
      (t) => `.${t}`,
    ),
  'noeval-if'(needle = '') {
    const hit = matcher(needle);
    wrap(window, 'eval', (native, self, args) =>
      hit(String(args[0])) ? undefined : Reflect.apply(native, self, args),
    );
  },
  'json-prune'(paths = '', required = '') {
    const list = words(paths);
    if (list.length === 0) return;
    const need = words(required);
    wrap(JSON, 'parse', (native, self, args) => {
      const v = Reflect.apply(native, self, args);
      pruneJson(v, list, need);
      return v;
    });
    wrap(Response.prototype, 'json', (native, self, args) =>
      (Reflect.apply(native, self, args) as Promise<unknown>).then((v) => {
        pruneJson(v, list, need);
        return v;
      }),
    );
  },
  'json-prune-fetch-response'(paths = '', required = '', ...rest) {
    const list = words(paths);
    if (list.length === 0) return;
    const need = words(required);
    const at = rest.indexOf('propsToMatch');
    const hit = requestMatcher(at >= 0 ? rest[at + 1] : '');
    wrap(window, 'fetch', (native, self, args) => {
      const out = Reflect.apply(native, self, args) as Promise<Response>;
      if (!hit(requestProps(args[0], args[1] as RequestInit | undefined))) return out;
      return out.then(async (res) => {
        try {
          const data: unknown = await res.clone().json();
          pruneJson(data, list, need);
          return new Response(JSON.stringify(data), res);
        } catch {
          return res;
        }
      });
    });
  },
  'set-cookie'(name = '', value = '', path = '/') {
    if (!name || !COOKIE_VALUE.test(value)) return;
    const key = `${encodeURIComponent(name)}=`;
    if (document.cookie.split('; ').some((c) => c.startsWith(key))) return;
    const scope = path === 'none' ? '' : `; path=${path === '' ? '/' : path}`;
    document.cookie = `${key}${value}${scope}; max-age=31536000; SameSite=Lax`;
  },
  'href-sanitizer': hrefSanitizer,
  'remove-cookie': removeCookies,
  nobab: () => fakeDetector('BlockAdBlock', 'blockAdBlock', 'SniffAdBlock', 'sniffAdBlock'),
  nofab: () => fakeDetector('FuckAdBlock', 'fuckAdBlock'),
  'popads-dummy'() {
    for (const name of ['PopAds', 'popns']) {
      Object.defineProperty(window, name, { configurable: true, value: {} });
    }
  },
  'json-prune-xhr-response': jsonPruneXhr,
  'xml-prune': xmlPrune,
  'refresh-defuser'() {
    watchDom(() => {
      for (const meta of document.querySelectorAll('meta[http-equiv="refresh" i]')) meta.remove();
    });
  },
  'set-attr': setAttr,
  'trusted-set-cookie'(name = '', value = '') {
    if (!name || /[;\r\n]/.test(name)) return;
    const text = literalValue(value);
    if (/[;\r\n]/.test(text)) return;
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(text)}; path=/; max-age=31536000; SameSite=Lax`;
  },
  'trusted-set-local-storage-item': (key = '', value = '') =>
    localStorage.setItem(key, literalValue(value)),
  'trusted-set-session-storage-item': (key = '', value = '') =>
    sessionStorage.setItem(key, literalValue(value)),
  'prevent-innerHTML'(selector = '', needle = '') {
    const hit = matcher(needle);
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    const set = desc?.set;
    if (!desc || !set) return;
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ...desc,
      set(this: Element, value: string) {
        if ((selector === '' || this.matches(selector)) && hit(String(value))) return;
        set.call(this, value);
      },
    });
  },
  norafif(needle = '') {
    const hit = matcher(needle);
    wrap(window, 'requestAnimationFrame', (native, self, args) => {
      if (hit(callbackText(args[0]))) args[0] = () => undefined;
      return Reflect.apply(native, self, args);
    });
  },
  'trusted-replace-argument': replaceArgument,
  'set-local-storage-item': (key, value) => setStorage(localStorage, key, value),
  'set-session-storage-item': (key, value) => setStorage(sessionStorage, key, value),
  nowebrtc() {
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
      if (!(name in window)) continue;
      Object.defineProperty(window, name, {
        configurable: true,
        value() {
          throw new DOMException('Blocked', 'NotAllowedError');
        },
      });
    }
  },
};
