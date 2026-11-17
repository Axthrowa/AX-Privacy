/**
 * Screenshot comparison for site-check. Each screenshot is shrunk to a coarse grid of average
 * colours, so moving ads, carousels and anti-aliasing matter little; what shows up is a page that
 * went blank, lost its styles or got covered by a wall. Ad areas of the page without AX are left
 * out, since emptying them is the point, and a page that only moved up (a collapsed ad slot above
 * the content) is compared at its shifted position.
 */

export const GRID_COLS = 48;
/** Fine rows (8 px on an 800 px screen), so a page moved up by any amount still lines up. */
export const GRID_ROWS = 100;
/** Furthest upward move tried, in rows; at least 60% of the screen is always compared. */
const MAX_SHIFT = 40;
/** Largest per-channel difference of a cell's average colour still counted as the same. */
const TOLERANCE = 32;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Grid cells (row-major index) that any of `rects` touches, on a `width` x `height` screenshot. */
export function maskedCells(rects: readonly Rect[], width: number, height: number): Set<number> {
  const out = new Set<number>();
  const cw = width / GRID_COLS;
  const ch = height / GRID_ROWS;
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    const c0 = Math.max(0, Math.floor(r.x / cw));
    const c1 = Math.min(GRID_COLS - 1, Math.floor((r.x + r.width - 1) / cw));
    const r0 = Math.max(0, Math.floor(r.y / ch));
    const r1 = Math.min(GRID_ROWS - 1, Math.floor((r.y + r.height - 1) / ch));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) out.add(row * GRID_COLS + col);
    }
  }
  return out;
}

/**
 * Share (0-1) of unmasked cells whose average colour changed, from two RGBA grids of
 * GRID_COLS x GRID_ROWS pixels, at the upward move of `b` that fits best. `masked` holds cells of
 * `a`. 0 when every cell is masked.
 */
export function changedShare(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  masked: ReadonlySet<number>,
): number {
  let best = 1;
  let comparedAny = false;
  for (let shift = 0; shift <= MAX_SHIFT; shift++) {
    let compared = 0;
    let changed = 0;
    for (let row = 0; row + shift < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cell = (row + shift) * GRID_COLS + col;
        if (masked.has(cell)) continue;
        compared++;
        const p = cell * 4;
        const q = (row * GRID_COLS + col) * 4;
        for (let k = 0; k < 3; k++) {
          if (Math.abs((a[p + k] ?? 0) - (b[q + k] ?? 0)) > TOLERANCE) {
            changed++;
            break;
          }
        }
      }
    }
    if (!compared) continue;
    comparedAny = true;
    best = Math.min(best, changed / compared);
  }
  return comparedAny ? best : 0;
}
