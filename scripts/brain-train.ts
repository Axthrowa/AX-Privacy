/**
 * Trains AX-Brain's shipped MLP (48 -> 32 -> 1) on rows from scripts/brain-crawl.ts and writes
 * src/engines/brain/mlp-weights.json, only when the quality gate passes on held-out sites:
 * precision >= 98% and false hides <= 0.5% of clean elements, at the runtime's hide bar.
 *
 *   node scripts/brain-train.ts <rows.jsonl> [--epochs 40]
 *
 * Split by site hash: 1/16 of sites pick the threshold, 2/16 are the untouched test set.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MODEL_HIDE_PROBABILITY } from '../src/engines/brain/scorer.ts';
import { mlpLogit, RICH_FEATURE_COUNT, type Mlp } from '../src/engines/brain/rich.ts';
import { sigmoid } from '../src/engines/brain/brain.ts';

export const GATE = { precision: 0.98, falseHide: 0.005 };
const HIDDEN = 32;

interface Row {
  s: string;
  y: 0 | 1;
  f: number[];
}

/** Deterministic PRNG so a rerun on the same rows gives the same weights. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function train(rows: readonly Row[], epochs: number, seed = 1): Mlp {
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const n = RICH_FEATURE_COUNT;
  const m: Mlp = {
    w1: Array.from({ length: HIDDEN }, () =>
      Array.from({ length: n }, () => gauss() * Math.sqrt(2 / n)),
    ),
    b1: new Array<number>(HIDDEN).fill(0),
    w2: Array.from({ length: HIDDEN }, () => gauss() * Math.sqrt(1 / HIDDEN)),
    b2: 0,
  };
  // Adam state, one flat vector over every parameter.
  const size = HIDDEN * n + HIDDEN * 2 + 1;
  const mom = new Float64Array(size);
  const vel = new Float64Array(size);
  const grad = new Float64Array(size);
  const lr = 0.003;
  const l2 = 1e-4;
  const batch = 256;
  let step = 0;
  const order = rows.map((_, i) => i);
  const act = new Float64Array(HIDDEN);
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
    }
    for (let start = 0; start < order.length; start += batch) {
      grad.fill(0);
      const end = Math.min(order.length, start + batch);
      for (let k = start; k < end; k++) {
        const row0 = rows[order[k] ?? 0];
        if (!row0) continue;
        const { f, y } = row0;
        let z = m.b2;
        for (let j = 0; j < HIDDEN; j++) {
          const row = m.w1[j] ?? [];
          let a = m.b1[j] ?? 0;
          for (let i = 0; i < n; i++) a += (row[i] ?? 0) * (f[i] ?? 0);
          act[j] = a > 0 ? a : 0;
          z += (m.w2[j] ?? 0) * (act[j] ?? 0);
        }
        const d = sigmoid(z) - y;
        grad[size - 1] = (grad[size - 1] ?? 0) + d;
        for (let j = 0; j < HIDDEN; j++) {
          const h = act[j] ?? 0;
          const at = HIDDEN * n + HIDDEN + j;
          grad[at] = (grad[at] ?? 0) + d * h;
          if (h <= 0) continue;
          const dh = d * (m.w2[j] ?? 0);
          grad[HIDDEN * n + j] = (grad[HIDDEN * n + j] ?? 0) + dh;
          for (let i = 0; i < n; i++) grad[j * n + i] = (grad[j * n + i] ?? 0) + dh * (f[i] ?? 0);
        }
      }
      step++;
      const scale = 1 / (end - start);
      const b1c = 1 - 0.9 ** step;
      const b2c = 1 - 0.999 ** step;
      const update = (idx: number, value: number, decay: boolean) => {
        const g = (grad[idx] ?? 0) * scale + (decay ? l2 * value : 0);
        const mo = 0.9 * (mom[idx] ?? 0) + 0.1 * g;
        const ve = 0.999 * (vel[idx] ?? 0) + 0.001 * g * g;
        mom[idx] = mo;
        vel[idx] = ve;
        return value - (lr * (mo / b1c)) / (Math.sqrt(ve / b2c) + 1e-8);
      };
      for (let j = 0; j < HIDDEN; j++) {
        const row = m.w1[j] ?? [];
        for (let i = 0; i < n; i++) row[i] = update(j * n + i, row[i] ?? 0, true);
        m.b1[j] = update(HIDDEN * n + j, m.b1[j] ?? 0, false);
        m.w2[j] = update(HIDDEN * n + HIDDEN + j, m.w2[j] ?? 0, true);
      }
      m.b2 = update(size - 1, m.b2, false);
    }
  }
  return m;
}

export interface Metrics {
  rows: number;
  ads: number;
  precision: number;
  recall: number;
  falseHide: number;
}

export function measure(rows: readonly Row[], m: Mlp, bar: number): Metrics {
  let tp = 0;
  let fp = 0;
  let pos = 0;
  for (const r of rows) {
    const hide = sigmoid(mlpLogit(r.f, m)) >= bar;
    if (r.y) pos++;
    if (hide && r.y) tp++;
    if (hide && !r.y) fp++;
  }
  const neg = rows.length - pos;
  return {
    rows: rows.length,
    ads: pos,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: pos ? tp / pos : 0,
    falseHide: neg ? fp / neg : 0,
  };
}

export const passes = (x: Metrics) =>
  x.precision >= GATE.precision && x.falseHide <= GATE.falseHide && x.recall > 0;

/** The lowest probability bar at which `rows` pass the gate, or null. */
export function pickBar(rows: readonly Row[], m: Mlp): number | null {
  for (let bar = 0.5; bar < 0.999; bar += 0.005) if (passes(measure(rows, m, bar))) return bar;
  return null;
}

const logit = (p: number) => Math.log(p / (1 - p));

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const at = args.indexOf('--epochs');
  const epochs = at >= 0 ? Number(args[at + 1]) : 40;
  if (!file) {
    console.error('usage: node scripts/brain-train.ts <rows.jsonl> [--epochs 40]');
    process.exit(2);
  }
  const rows = (await readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => r.f.length === RICH_FEATURE_COUNT && r.f.every(Number.isFinite));
  const part = (r: Row) => parseInt(r.s[0] ?? '0', 16);
  const test = rows.filter((r) => part(r) < 2);
  const tune = rows.filter((r) => part(r) === 2);
  const fit = rows.filter((r) => part(r) > 2);
  console.log(`rows: ${fit.length} train, ${tune.length} tune, ${test.length} test`);
  const m = train(fit, epochs);
  const bar = pickBar(tune, m);
  if (bar === null) {
    console.error('gate failed: no threshold reaches the precision / false-hide bar');
    console.error(JSON.stringify(measure(tune, m, 0.95)));
    process.exit(1);
  }
  // Calibrate so the runtime's fixed bar (0.85) is the bar picked here.
  m.b2 += logit(MODEL_HIDE_PROBABILITY) - logit(bar);
  const result = measure(test, m, MODEL_HIDE_PROBABILITY);
  console.log(`bar ${bar.toFixed(3)} → test ${JSON.stringify(result)}`);
  if (!passes(result)) {
    console.error('gate failed on the test sites');
    process.exit(1);
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const out = {
    w1: m.w1.map((row) => row.map(r4)),
    b1: m.b1.map(r4),
    w2: m.w2.map(r4),
    b2: r4(m.b2),
    gate: { ...GATE, test: result, trainRows: fit.length, trainedAt: new Date().toISOString() },
  };
  // Rounding must not move the result out of the gate.
  if (!passes(measure(test, out, MODEL_HIDE_PROBABILITY))) {
    console.error('gate failed after rounding');
    process.exit(1);
  }
  await writeFile(
    resolve(import.meta.dirname, '../src/engines/brain/mlp-weights.json'),
    `${JSON.stringify(out)}\n`,
  );
  console.log('wrote src/engines/brain/mlp-weights.json');
}
