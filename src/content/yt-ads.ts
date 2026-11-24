import { pruneAds, pruneAdsText, YT_BACKOFF_KEY, YT_DATA } from '../engines/video/youtube.ts';

// MAIN world on YouTube pages, before the page's own scripts. The player reads its ad schedule
// from the initial player response and from later JSON responses; both lose their ad fields here.
// Nothing is fetched or sent: the page's own data is filtered as it arrives.

// After YouTube showed its ad blocker warning, this tab leaves YouTube alone until it is closed.
let backedOff = false;
try {
  backedOff = sessionStorage.getItem(YT_BACKOFF_KEY) !== null;
} catch {
  // Storage blocked: carry on.
}

const prune = (v: unknown) => {
  if (backedOff) return;
  try {
    pruneAds(v);
  } catch {
    // A frozen or exotic object: leave it as is rather than break the page.
  }
};

for (const name of ['ytInitialPlayerResponse', 'ytInitialReelWatchSequenceResponse']) {
  let current: unknown;
  Object.defineProperty(window, name, {
    configurable: true,
    get: () => current,
    set: (v: unknown) => {
      prune(v);
      current = v;
    },
  });
}

// Proxies keep the originals' name and length, and `toString()` answers for the original, so
// pages that check whether these built-ins were replaced see them unchanged.
const originals = new WeakMap<object, object>();
const disguise = <T extends object>(proxy: T, original: T): T => {
  originals.set(proxy, original);
  return proxy;
};
const toString = Function.prototype.toString;
Function.prototype.toString = disguise(
  new Proxy(toString, {
    apply(target, thisArg: object, args: []) {
      const original = originals.get(thisArg);
      // Back through the current toString: scriptlets may have wrapped the same built-in too, with
      // a disguise of their own; each layer then unwraps its proxy in turn.
      if (original) return Reflect.apply(Function.prototype.toString, original, args) as string;
      return Reflect.apply(target, thisArg, args) as string;
    },
  }),
  toString,
);

const parse = JSON.parse;
JSON.parse = disguise(
  new Proxy(parse, {
    apply(target, thisArg, args: Parameters<typeof JSON.parse>) {
      const v: unknown = Reflect.apply(target, thisArg, args);
      prune(v);
      return v;
    },
  }),
  parse,
);

const json = Response.prototype.json;
Response.prototype.json = disguise(
  new Proxy(json, {
    apply(target, thisArg: Response, args: []) {
      return (Reflect.apply(target, thisArg, args) as Promise<unknown>).then((v) => {
        prune(v);
        return v;
      });
    },
  }),
  json,
);

// XMLHttpRequest: the player API can also be read as text. Only its paths are touched, once each.
const urls = new WeakMap<XMLHttpRequest, string>();
const pruned = new WeakMap<XMLHttpRequest, string>();
const XHR = XMLHttpRequest.prototype;
const open = XHR.open;
XHR.open = disguise(
  new Proxy(open, {
    apply(target, thisArg: XMLHttpRequest, args: Parameters<typeof open>) {
      urls.set(thisArg, String(args[1]));
      pruned.delete(thisArg);
      return Reflect.apply(target, thisArg, args) as undefined;
    },
  }),
  open,
);
const isPlayerApi = (url: string | undefined) => {
  if (!url) return false;
  try {
    const { pathname } = new URL(url, location.href);
    return YT_DATA.xhrPaths.some((p) => pathname === p);
  } catch {
    return false;
  }
};
const textOf = (xhr: XMLHttpRequest, raw: string) => {
  if (backedOff || xhr.readyState !== 4 || !isPlayerApi(urls.get(xhr))) return raw;
  let text = pruned.get(xhr);
  if (text === undefined) {
    text = pruneAdsText(raw, parse);
    pruned.set(xhr, text);
  }
  return text;
};
for (const prop of ['responseText', 'response'] as const) {
  const desc = Object.getOwnPropertyDescriptor(XHR, prop);
  const get = desc?.get;
  if (!desc || !get) continue;
  Object.defineProperty(XHR, prop, {
    ...desc,
    get: disguise(
      new Proxy(get, {
        apply(target, thisArg: XMLHttpRequest, args: []) {
          const raw: unknown = Reflect.apply(target, thisArg, args);
          if (typeof raw === 'string') return textOf(thisArg, raw);
          // responseType "json": the object is parsed already; prune it in place.
          if (
            prop === 'response' &&
            thisArg.responseType === 'json' &&
            isPlayerApi(urls.get(thisArg))
          ) {
            prune(raw);
          }
          return raw;
        },
      }),
      get,
    ),
  });
}
