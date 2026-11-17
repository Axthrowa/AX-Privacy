// Runs in the page's main world, before page scripts. It changes canvas, WebGL and audio
// readback by a tiny amount that is stable per (browser session, top site, frame host): within a
// session a site always sees the same values, other sites and later sessions see different ones,
// so a readback hash links neither sites nor visits on different days. The session secret arrives
// through the `fp-seed/<digit>.js` files that run just before this one, and is removed here before
// any page script can read it.

import { prefixInlineWorkers } from '../shared/worker-prelude.ts';

const MAX_PIXELS = 4_000_000;
const seedHolder = self as { __axSeed?: number[] };
const secret = (seedHolder.__axSeed ?? []).join(',');
delete seedHolder.__axSeed;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const origins = location.ancestorOrigins;
const topOrigin = origins?.length ? origins[origins.length - 1] : location.origin;
const SEED = fnv1a(`${secret}|${topOrigin}|${location.hostname}`);

type Fn = (...args: never[]) => unknown;

/**
 * Canvas and WebGL readback noise for one global scope. Self-contained, because it is also
 * serialized into inline workers: it may use only its parameters and globals.
 */
function installCanvasNoise(seed: number, maxPixels: number) {
  const mix = (i: number): number => {
    let x = (seed ^ Math.imul(i, 0x9e3779b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return (x ^ (x >>> 16)) >>> 0;
  };

  /** Flips the low bit of one colour channel in about one of 16 non-transparent pixels. */
  const noisePixels = (data: Uint8Array | Uint8ClampedArray): void => {
    if (data.length / 4 > maxPixels) return;
    for (let p = 0; p + 3 < data.length; p += 4) {
      const h = mix(p >>> 2);
      if ((h & 15) !== 0 || data[p + 3] === 0) continue;
      const c = p + ((h >>> 4) % 3);
      data[c] = (data[c] ?? 0) ^ 1;
    }
  };

  const wrap = <T extends object, K extends keyof T>(
    proto: T | undefined,
    name: K,
    make: (orig: T[K] & Fn) => T[K],
  ): void => {
    const orig = proto?.[name];
    if (proto && typeof orig === 'function') {
      Object.defineProperty(proto, name, { value: make(orig as T[K] & Fn) });
    }
  };

  for (const proto of [
    globalThis.CanvasRenderingContext2D?.prototype,
    globalThis.OffscreenCanvasRenderingContext2D?.prototype,
  ]) {
    wrap(
      proto as CanvasRenderingContext2D | undefined,
      'getImageData',
      (orig) =>
        function (this: unknown, ...args: unknown[]) {
          const img = Reflect.apply(orig, this, args) as ImageData;
          noisePixels(img.data);
          return img;
        },
    );
  }

  for (const proto of [
    globalThis.WebGLRenderingContext?.prototype,
    globalThis.WebGL2RenderingContext?.prototype,
  ]) {
    wrap(
      proto as WebGLRenderingContext | undefined,
      'readPixels',
      (orig) =>
        function (this: unknown, ...args: unknown[]) {
          const result = Reflect.apply(orig, this, args);
          const pixels = args[6];
          if (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)
            noisePixels(pixels);
          return result;
        },
    );
  }

  // Workers export a canvas without getImageData; the export reads a noisy 2D copy instead.
  const Offscreen = globalThis.OffscreenCanvas;
  wrap(
    Offscreen?.prototype,
    'convertToBlob',
    (orig) =>
      function (this: OffscreenCanvas, ...args: unknown[]) {
        let copy: OffscreenCanvas | null = null;
        try {
          const { width, height } = this;
          if (width && height && width * height <= maxPixels) {
            const c = new Offscreen(width, height);
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.drawImage(this, 0, 0);
              // getImageData is wrapped above, so this already carries the noise.
              ctx.putImageData(ctx.getImageData(0, 0, width, height), 0, 0);
              copy = c;
            }
          }
        } catch {
          // Not readable (detached, or a bitmap renderer): exported as it is.
        }
        return Reflect.apply(orig, copy ?? this, args);
      },
  );

  return { mix, wrap };
}

const { mix, wrap } = installCanvasNoise(SEED, MAX_PIXELS);
prefixInlineWorkers(`(${installCanvasNoise.toString()})(${SEED}, ${MAX_PIXELS});`);

const getImageData = CanvasRenderingContext2D.prototype.getImageData;
/** A noisy 2D copy of `canvas`, or null when there is nothing (or too much) to copy. */
function noisyCopy(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const { width, height } = canvas;
  if (!width || !height || width * height > MAX_PIXELS) return null;
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = height;
  const ctx = copy.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0);
  // `getImageData` is wrapped above, so this already carries the noise.
  ctx.putImageData(Reflect.apply(getImageData, ctx, [0, 0, width, height]) as ImageData, 0, 0);
  return copy;
}

const canvasProto = HTMLCanvasElement.prototype;
for (const name of ['toDataURL', 'toBlob'] as const) {
  wrap(
    canvasProto,
    name,
    (orig) =>
      function (this: HTMLCanvasElement, ...args: unknown[]) {
        const copy = this instanceof HTMLCanvasElement ? noisyCopy(this) : null;
        return Reflect.apply(orig, copy ?? this, args);
      },
  );
}

/** Relative; float32 resolves about 1.2e-7, so every sample changes, far below audibility. */
const AUDIO_NOISE = 2e-6;
const noisedChannels = new WeakMap<AudioBuffer, Set<number>>();

wrap(
  AudioBuffer.prototype,
  'getChannelData',
  (orig) =>
    function (this: AudioBuffer, channel: number) {
      const data = Reflect.apply(orig, this, [channel]) as Float32Array<ArrayBuffer>;
      let done = noisedChannels.get(this);
      if (!done) noisedChannels.set(this, (done = new Set()));
      // getChannelData returns the live buffer; noise it once, not on every read.
      if (!done.has(channel)) {
        done.add(channel);
        for (let i = 0; i < data.length; i++) {
          data[i] = (data[i] ?? 0) * (1 + ((mix(i) & 0xffff) / 0xffff - 0.5) * AUDIO_NOISE);
        }
      }
      return data;
    },
);

wrap(
  AudioBuffer.prototype,
  'copyFromChannel',
  (orig) =>
    function (this: AudioBuffer, ...args: unknown[]) {
      if (this instanceof AudioBuffer) this.getChannelData(args[1] as number);
      return Reflect.apply(orig, this, args);
    },
);

wrap(
  globalThis.AnalyserNode?.prototype,
  'getFloatFrequencyData',
  (orig) =>
    function (this: unknown, ...args: unknown[]) {
      const result = Reflect.apply(orig, this, args);
      const out = args[0];
      if (out instanceof Float32Array) {
        for (let i = 0; i < out.length; i++) {
          out[i] = (out[i] ?? 0) + ((mix(i) & 0xffff) / 0xffff - 0.5) * 1e-3;
        }
      }
      return result;
    },
);
