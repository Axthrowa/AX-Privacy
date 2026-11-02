// Runs in the page's main world, before page scripts. It changes canvas, WebGL and audio
// readback by a tiny amount that is stable per (top site, frame host): the same site always sees
// the same values, other sites see different ones, so a readback hash cannot link visits across
// sites. Main-world scripts cannot receive a secret synchronously, so the noise is a public
// function of the site; a script written against AX could undo it.

const MAX_PIXELS = 4_000_000;

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
const SEED = fnv1a(`${topOrigin}|${location.hostname}`);

function mix(i: number): number {
  let x = (SEED ^ Math.imul(i, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Flips the low bit of one colour channel in about one of 16 non-transparent pixels. */
function noisePixels(data: Uint8Array | Uint8ClampedArray): void {
  if (data.length / 4 > MAX_PIXELS) return;
  for (let p = 0; p + 3 < data.length; p += 4) {
    const h = mix(p >>> 2);
    if ((h & 15) !== 0 || data[p + 3] === 0) continue;
    const c = p + ((h >>> 4) % 3);
    data[c] = (data[c] ?? 0) ^ 1;
  }
}

type Fn = (...args: never[]) => unknown;
function wrap<T extends object, K extends keyof T>(
  proto: T | undefined,
  name: K,
  make: (orig: T[K] & Fn) => T[K],
): void {
  const orig = proto?.[name];
  if (proto && typeof orig === 'function') {
    Object.defineProperty(proto, name, { value: make(orig as T[K] & Fn) });
  }
}

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
