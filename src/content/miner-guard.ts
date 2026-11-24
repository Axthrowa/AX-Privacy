// Runs in the page's main world, before page scripts. Watches for in-browser crypto mining the
// lists missed: workers, WebAssembly and pool sockets (see engines/security/miner.ts). On clear
// signs the page's workers are ended and new ones refused; on the shape alone the user is only
// told. Notes go to miner-relay.ts in the isolated world.

import { isPoolSocket, MINER_WORDS, minerVerdict, WINDOW_MS } from '../engines/security/miner.ts';

const MINER_EVENT = 'ax-miner';

const workers: { w: Worker | SharedWorker; at: number }[] = [];
let wasm = false;
let minerName = false;
let poolSocket = false;
let verdict: 'stop' | 'warn' | null = null;

function check(): void {
  if (verdict === 'stop') return;
  const now = Date.now();
  const recent = workers.filter((x) => now - x.at <= WINDOW_MS).length;
  const v = minerVerdict(
    { workers: recent, wasm, minerName, poolSocket },
    navigator.hardwareConcurrency || 4,
  );
  if (!v || v === verdict) return;
  verdict = v;
  if (v === 'stop') {
    for (const { w } of workers.splice(0)) {
      if ('terminate' in w) w.terminate();
      else w.port.close();
    }
  }
  document.dispatchEvent(new CustomEvent(MINER_EVENT, { detail: v }));
}

for (const name of ['Worker', 'SharedWorker'] as const) {
  const Native = globalThis[name] as (typeof globalThis)[typeof name] | undefined;
  if (typeof Native !== 'function') continue;
  const Guarded = new Proxy(Native, {
    construct(target, args: [string | URL, ...unknown[]], newTarget) {
      if (verdict === 'stop') {
        throw new DOMException('Blocked by AX Privacy: crypto mining', 'SecurityError');
      }
      if (MINER_WORDS.test(String(args[0]))) minerName = true;
      const w = Reflect.construct(target, args, newTarget) as Worker | SharedWorker;
      workers.push({ w, at: Date.now() });
      if (workers.length > 64) workers.shift();
      check();
      return w;
    },
  });
  Object.defineProperty(globalThis, name, { value: Guarded, writable: true, configurable: true });
}

const NativeSocket = globalThis.WebSocket;
if (typeof NativeSocket === 'function') {
  const Guarded = new Proxy(NativeSocket, {
    construct(target, args: [string | URL, ...unknown[]], newTarget) {
      if (isPoolSocket(String(args[0]))) {
        poolSocket = true;
        check();
        if (verdict === 'stop') {
          throw new DOMException('Blocked by AX Privacy: mining pool', 'SecurityError');
        }
      }
      return Reflect.construct(target, args, newTarget) as WebSocket;
    },
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    value: Guarded,
    writable: true,
    configurable: true,
  });
}

if (typeof WebAssembly === 'object') {
  const inspect = (mod: unknown) => {
    wasm = true;
    try {
      if (mod instanceof WebAssembly.Module) {
        const names = [...WebAssembly.Module.exports(mod), ...WebAssembly.Module.imports(mod)].map(
          (e) => e.name,
        );
        if (names.some((n) => MINER_WORDS.test(n))) minerName = true;
      }
    } catch {
      // Not readable; the compile itself still counts.
    }
    check();
  };
  const wrap = <K extends 'compile' | 'instantiate' | 'compileStreaming' | 'instantiateStreaming'>(
    key: K,
  ) => {
    const native = WebAssembly[key] as unknown as (...a: unknown[]) => Promise<unknown>;
    if (typeof native !== 'function') return;
    Object.defineProperty(WebAssembly, key, {
      value: function (this: unknown, ...a: unknown[]) {
        return native.apply(this, a).then((r) => {
          inspect(r instanceof WebAssembly.Module ? r : (r as { module?: unknown }).module);
          return r;
        });
      },
      writable: true,
      configurable: true,
    });
  };
  wrap('compile');
  wrap('instantiate');
  wrap('compileStreaming');
  wrap('instantiateStreaming');
}
