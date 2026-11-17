import {
  AD_VIDEO_SELECTOR,
  PLAYER_GLOBALS,
  pruneJwConfig,
  stripAdBreaks,
} from '../engines/video/generic.ts';

// MAIN world, opt-in (beta). Sleeps until the page loads a known player (JW Player, hls.js, Shaka,
// dash.js, Video.js); only then are HLS playlists filtered and ad videos wound to their end, so
// pages without a player pay nothing. Any failure leaves the player as it was.

const POLL_MS = 500;
let awake = false;

function wake() {
  if (awake) return;
  awake = true;
  hookPlaylists();
  setInterval(windAdVideos, POLL_MS);
}

const safeStrip = (text: string) => {
  try {
    return stripAdBreaks(text);
  } catch {
    return text;
  }
};

/** Playlists arrive as text through fetch or XMLHttpRequest; only ones starting `#EXTM3U` change. */
function hookPlaylists() {
  const text = Response.prototype.text;
  Response.prototype.text = function (this: Response) {
    return text.call(this).then((t) => (t.startsWith('#EXTM3U') ? safeStrip(t) : t));
  };
  const XHR = XMLHttpRequest.prototype;
  const seen = new WeakMap<XMLHttpRequest, [string, string]>();
  for (const prop of ['responseText', 'response'] as const) {
    const desc = Object.getOwnPropertyDescriptor(XHR, prop);
    const get = desc?.get;
    if (!desc || !get) continue;
    Object.defineProperty(XHR, prop, {
      ...desc,
      get(this: XMLHttpRequest) {
        const raw: unknown = get.call(this);
        if (typeof raw !== 'string' || !raw.startsWith('#EXTM3U') || this.readyState !== 4) {
          return raw;
        }
        const cached = seen.get(this);
        if (cached?.[0] === raw) return cached[1];
        const out = safeStrip(raw);
        seen.set(this, [raw, out]);
        return out;
      },
    });
  }
}

/** A separate ad <video> (pre-roll): muted and moved to its end, so the player goes on. */
function windAdVideos() {
  for (const v of document.querySelectorAll<HTMLVideoElement>(AD_VIDEO_SELECTOR)) {
    if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.25) {
      v.muted = true;
      v.currentTime = v.duration;
    }
  }
}

const wrappedApis = new WeakSet<object>();
function wrapJw(value: unknown): unknown {
  if (typeof value !== 'function') return value;
  return new Proxy(value, {
    apply(target, thisArg, args) {
      const api: unknown = Reflect.apply(target, thisArg, args);
      if (typeof api === 'object' && api !== null && !wrappedApis.has(api)) {
        const a = api as { setup?: (config: unknown) => unknown };
        const setup = a.setup;
        if (typeof setup === 'function') {
          wrappedApis.add(api);
          a.setup = function (this: unknown, config: unknown) {
            try {
              pruneJwConfig(config);
            } catch {
              // A frozen config: play it as given.
            }
            return setup.call(this, config);
          };
        }
      }
      return api;
    },
  });
}

for (const name of PLAYER_GLOBALS) {
  if (Object.getOwnPropertyDescriptor(window, name)) {
    wake();
    continue;
  }
  let value: unknown;
  try {
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set(v: unknown) {
        value = name === 'jwplayer' ? wrapJw(v) : v;
        wake();
      },
    });
  } catch {
    // The page defined it first in a way that cannot be changed: leave it.
  }
}
