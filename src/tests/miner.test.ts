import { describe, expect, it } from 'vitest';
import { isPoolSocket, minerVerdict } from '../engines/security/miner.ts';
import { assessRisk } from '../engines/security/heuristics.ts';

const none = { workers: 0, wasm: false, minerName: false, poolSocket: false };

describe('crypto miner heuristic', () => {
  it('stops on a miner name or a pool socket with work behind it', () => {
    expect(minerVerdict({ ...none, minerName: true }, 8)).toBe('stop');
    expect(minerVerdict({ ...none, poolSocket: true, workers: 1 }, 8)).toBe('stop');
    expect(minerVerdict({ ...none, poolSocket: true, wasm: true }, 8)).toBe('stop');
    // A pool-shaped socket alone, with nothing computing, is not enough.
    expect(minerVerdict({ ...none, poolSocket: true }, 8)).toBeNull();
  });

  it('only warns on the shape: a worker per core with WebAssembly', () => {
    expect(minerVerdict({ ...none, wasm: true, workers: 7 }, 8)).toBe('warn');
    expect(minerVerdict({ ...none, wasm: true, workers: 2 }, 8)).toBeNull();
    expect(minerVerdict({ ...none, workers: 12 }, 8)).toBeNull();
    // Few cores: still at least 3 workers.
    expect(minerVerdict({ ...none, wasm: true, workers: 2 }, 2)).toBeNull();
    expect(minerVerdict({ ...none, wasm: true, workers: 3 }, 2)).toBe('warn');
  });

  it('knows pool sockets from ordinary ones', () => {
    expect(isPoolSocket('wss://pool.example.net:3333/')).toBe(true);
    expect(isPoolSocket('wss://ws.example.com/stratum')).toBe(true);
    expect(isPoolSocket('wss://a.example/proxy?xmr=1')).toBe(true);
    expect(isPoolSocket('wss://chat.example.com/socket')).toBe(false);
    expect(isPoolSocket('wss://live.example.com:3333/feed')).toBe(false);
    expect(isPoolSocket('https://pool.example.net:3333/')).toBe(false);
  });

  it('reports a stopped miner as high and a suspected one as low', () => {
    const base = { insecurePassword: false, bypassed: false };
    expect(assessRisk('https://a.example/', { ...base, miner: 'stopped' }).level).toBe('high');
    const seen = assessRisk('https://a.example/', { ...base, miner: 'seen' });
    expect(seen.level).toBe('low');
    expect(seen.findings[0]?.id).toBe('miner-suspected');
  });
});
