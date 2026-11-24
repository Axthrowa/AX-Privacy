// In-browser crypto miners the lists have not caught: many busy workers, WebAssembly and a
// connection to a mining pool. Pure functions; content/miner-guard.ts watches the page.

/** Names miner builds keep in their file names, WebAssembly exports and pool paths. */
export const MINER_WORDS =
  /cryptonight|coinhive|coin-?imp|crypto-?loot|webmine|web-?miner|randomx|xmrig|monero|minero|cryptonoter|deepminer|jsecoin/i;

/** Pool ports the common stratum proxies use. */
const POOL_PORTS = new Set(['3333', '4444', '5555', '7777', '8888', '14444', '45700']);

/** A WebSocket that looks like a mining pool or its proxy. */
export function isPoolSocket(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return false;
  if (MINER_WORDS.test(u.href) || /stratum|xmr|mining-?pool/i.test(u.href)) return true;
  return POOL_PORTS.has(u.port) && /pool|proxy|mine/i.test(`${u.hostname}${u.pathname}`);
}

export interface MinerSigns {
  /** Workers started in the last WINDOW_MS. */
  workers: number;
  /** The page compiled WebAssembly. */
  wasm: boolean;
  /** A worker file, WebAssembly export or socket carried a miner name. */
  minerName: boolean;
  /** A socket went to a pool-shaped address. */
  poolSocket: boolean;
}

export const WINDOW_MS = 30_000;

/**
 * 'stop': clear signs, the workers are ended. 'warn': only the shape of one (a worker per core and
 * WebAssembly), which video editors and games also have, so the user is told and nothing stops.
 */
export function minerVerdict(s: MinerSigns, cores: number): 'stop' | 'warn' | null {
  if (s.minerName || (s.poolSocket && (s.workers >= 1 || s.wasm))) return 'stop';
  if (s.wasm && s.workers >= Math.max(3, cores - 1)) return 'warn';
  return null;
}
