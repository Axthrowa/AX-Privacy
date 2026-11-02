import { pruneAds } from '../engines/video/youtube.ts';

// MAIN world on YouTube pages, before the page's own scripts. The player reads its ad schedule
// from the initial player response and from later JSON responses; both lose their ad fields here.
// Nothing is fetched or sent: the page's own data is filtered as it arrives.

const prune = (v: unknown) => {
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
      return Reflect.apply(target, originals.get(thisArg) ?? thisArg, args) as string;
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
