// Runs in the page's main world, before page scripts. Notes two kinds of tracking for AX-Brain
// layer 2 and names the script that did it: a canvas read back after text was drawn on it
// (fingerprinting), and an ID-like value written to localStorage. Nothing is blocked or changed
// here; brain-scan.ts (isolated world) passes each note to the background once.

import { looksLikeId, SIGNAL_EVENT } from '../engines/brain/id-value.ts';

/** The first web script on the stack: the caller of the wrapped function. */
function callerUrl(): string | null {
  // Chromium "at f (url:1:2)", Firefox "f@url:1:2"; blob: and extension frames do not match.
  const m = /(?:^|[\s(@])(https?:\/\/[^\s)]+?):\d+:\d+/m.exec(new Error().stack ?? '');
  return m?.[1] ?? null;
}

const sent = new Set<string>();
/** A page cannot flood the background through this; a handful per frame is all that matters. */
const MAX_SENT = 20;

function note(signal: 'storage' | 'fingerprint'): void {
  // In a third-party frame with inline code, the frame itself is the tracker.
  const source = callerUrl() ?? location.href;
  const key = `${signal}|${source}`;
  if (sent.has(key) || sent.size >= MAX_SENT) return;
  sent.add(key);
  document.dispatchEvent(
    new CustomEvent(SIGNAL_EVENT, { detail: JSON.stringify({ signal, source }) }),
  );
}

type Fn = (...args: never[]) => unknown;
function after<T extends object>(
  proto: T,
  name: keyof T,
  fn: (self: unknown, args: unknown[]) => void,
) {
  const original = proto[name] as unknown as Fn | undefined;
  if (typeof original !== 'function') return;
  const wrapped = {
    [name]: function (this: unknown, ...args: never[]) {
      try {
        fn(this, args);
      } catch {
        // A note must never break the page.
      }
      return original.apply(this, args);
    },
  }[name as string];
  Object.defineProperty(proto, name, { value: wrapped, writable: true, configurable: true });
}

const texted = new WeakSet<object>();
after(CanvasRenderingContext2D.prototype, 'fillText', (ctx) => {
  texted.add((ctx as CanvasRenderingContext2D).canvas);
});
after(CanvasRenderingContext2D.prototype, 'strokeText', (ctx) => {
  texted.add((ctx as CanvasRenderingContext2D).canvas);
});
const readback = (canvas: unknown) => {
  if (texted.has(canvas as object)) note('fingerprint');
};
after(HTMLCanvasElement.prototype, 'toDataURL', (c) => readback(c));
after(HTMLCanvasElement.prototype, 'toBlob', (c) => readback(c));
after(CanvasRenderingContext2D.prototype, 'getImageData', (ctx) =>
  readback((ctx as CanvasRenderingContext2D).canvas),
);

after(Storage.prototype, 'setItem', (store, args) => {
  if (store === globalThis.localStorage && looksLikeId(String(args[1]))) note('storage');
});
