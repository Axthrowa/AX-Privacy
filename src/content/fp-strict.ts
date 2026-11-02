// Strict level, main world: hides the GPU model and the CPU core count. Values are fixed, not
// random, so a site sees the same browser on every visit.

const UNMASKED_VENDOR_WEBGL = 0x9245;
const UNMASKED_RENDERER_WEBGL = 0x9246;
const VENDOR = 0x1f00;
const RENDERER = 0x1f01;
const CORES = 4;

for (const proto of [
  globalThis.WebGLRenderingContext?.prototype,
  globalThis.WebGL2RenderingContext?.prototype,
]) {
  const orig = proto?.getParameter;
  if (!proto || typeof orig !== 'function') continue;
  Object.defineProperty(proto, 'getParameter', {
    value: function (this: WebGLRenderingContext, pname: number) {
      // Report the generic strings browsers already expose instead of the real GPU.
      if (pname === UNMASKED_VENDOR_WEBGL) return Reflect.apply(orig, this, [VENDOR]);
      if (pname === UNMASKED_RENDERER_WEBGL) return Reflect.apply(orig, this, [RENDERER]);
      return Reflect.apply(orig, this, [pname]);
    },
  });
}

const cores = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency');
if (cores?.get) {
  const get = cores.get;
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
    ...cores,
    get(this: Navigator) {
      return Math.min(Reflect.apply(get, this, []) as number, CORES);
    },
  });
}
