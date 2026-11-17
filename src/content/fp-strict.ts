// Strict level, main world: hides the GPU model, the CPU core count, device memory, battery, the
// screen space taken by the taskbar and which uncommon fonts are installed. Values are fixed, not
// random, so a site sees the same browser on every visit.

import { prefixInlineWorkers } from '../shared/worker-prelude.ts';

/**
 * GPU model, core count and memory, for one global scope. Self-contained, because it is also
 * serialized into inline workers (which have their own `navigator`): only globals inside.
 */
function installHardwareLimits(): void {
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

  // Workers have WorkerNavigator instead of Navigator.
  const nav = (
    globalThis.Navigator ??
    (globalThis as unknown as { WorkerNavigator?: typeof Navigator }).WorkerNavigator
  )?.prototype;
  if (!nav) return;
  const cores = Object.getOwnPropertyDescriptor(nav, 'hardwareConcurrency');
  if (cores?.get) {
    const get = cores.get;
    Object.defineProperty(nav, 'hardwareConcurrency', {
      ...cores,
      get(this: Navigator) {
        return Math.min(Reflect.apply(get, this, []) as number, CORES);
      },
    });
  }
  // Device memory: the most common bucket, the same everywhere.
  const memory = Object.getOwnPropertyDescriptor(nav, 'deviceMemory');
  if (memory?.get) Object.defineProperty(nav, 'deviceMemory', { ...memory, get: () => 8 });
}

installHardwareLimits();
prefixInlineWorkers(`(${installHardwareLimits.toString()})();`);

// Battery level and charging time change slowly and can link sites visited together; Firefox and
// Safari have no Battery API at all, so pages already cope without it.
if ('getBattery' in Navigator.prototype) {
  Reflect.deleteProperty(Navigator.prototype, 'getBattery');
}

// The space taskbars and docks take tells desktop layouts apart; report the full screen instead.
for (const [avail, full] of [
  ['availWidth', 'width'],
  ['availHeight', 'height'],
  ['availLeft', null],
  ['availTop', null],
] as const) {
  const desc = Object.getOwnPropertyDescriptor(Screen.prototype, avail);
  const fullGet = full ? Object.getOwnPropertyDescriptor(Screen.prototype, full)?.get : null;
  if (!desc?.get) continue;
  Object.defineProperty(Screen.prototype, avail, {
    ...desc,
    get(this: Screen) {
      return fullGet ? (Reflect.apply(fullGet, this, []) as number) : 0;
    },
  });
}

/**
 * Fonts sites probe for but rarely use in their own design (Office, Adobe, East Asian and old
 * Windows fonts). Sites detect a font by measuring text in it against a fallback; mapping each of
 * these to Arial makes an installed one and a missing one measure alike. Common web and system UI
 * fonts are not on the list, so page typography stays as designed.
 */
const PROBED_FONTS = [
  'Agency FB',
  'Arabic Typesetting',
  'Arial Unicode MS',
  'AvantGarde Bk BT',
  'BankGothic Md BT',
  'Batang',
  'Bitstream Vera Sans Mono',
  'Clarendon',
  'EUROSTILE',
  'Futura Bk BT',
  'Futura Md BT',
  'HELV',
  'Haettenschweiler',
  'Humanst521 BT',
  'Leelawadee',
  'Letter Gothic',
  'Levenim MT',
  'Lucida Bright',
  'MS Mincho',
  'MS Outlook',
  'MS Reference Specialty',
  'MS UI Gothic',
  'MT Extra',
  'Marlett',
  'Meiryo UI',
  'Microsoft Uighur',
  'Minion Pro',
  'Monotype Corsiva',
  'PMingLiU',
  'Pristina',
  'SCRIPTINA',
  'Serifa',
  'SimHei',
  'Small Fonts',
  'Staccato222 BT',
  'TRAJAN PRO',
  'Univers CE 55 Medium',
  'Vrinda',
  'ZWAdobeF',
];

// A face whose source fails would not hide the installed font, so the source must exist.
if (typeof FontFace === 'function' && document.fonts) {
  for (const family of PROBED_FONTS) {
    try {
      const face = new FontFace(
        family,
        'local("Arial"), local("Helvetica"), local("Liberation Sans")',
      );
      document.fonts.add(face);
      face.load().catch(() => undefined);
    } catch {
      // An unusable family name is skipped; the others still apply.
    }
  }
}

// The Local Font Access API lists every installed font once the user allows it.
Reflect.deleteProperty(Window.prototype, 'queryLocalFonts');
