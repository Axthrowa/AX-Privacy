import { describe, expect, it } from 'vitest';
import { changedShare, GRID_COLS, GRID_ROWS, maskedCells } from '../../e2e/visual-diff.ts';

const CELLS = GRID_COLS * GRID_ROWS;
const grid = (rgb: [number, number, number]) =>
  Uint8ClampedArray.from({ length: CELLS * 4 }, (_, i) => (i % 4 === 3 ? 255 : (rgb[i % 4] ?? 0)));

describe('visual diff', () => {
  it('counts changed cells, ignoring small colour shifts', () => {
    const white = grid([255, 255, 255]);
    expect(changedShare(white, grid([240, 250, 255]), new Set())).toBe(0);
    expect(changedShare(white, grid([20, 20, 20]), new Set())).toBe(1);
    const half = grid([255, 255, 255]);
    for (let cell = 0; cell < CELLS / 2; cell++) half.set([0, 0, 0], cell * 4);
    expect(changedShare(white, half, new Set())).toBe(0.5);
  });

  it('matches a page that only moved up, not one that changed', () => {
    // Without AX: an empty band (a collapsed ad slot) above stripes; with AX the stripes start at the top.
    const stripes = (start: number) => {
      const g = grid([245, 245, 245]);
      for (let row = start; row < GRID_ROWS; row++) {
        const shade = (row - start) % 6 < 3 ? 0 : 255;
        for (let col = 0; col < GRID_COLS; col++)
          g.set([shade, shade, shade], (row * GRID_COLS + col) * 4);
      }
      return g;
    };
    expect(changedShare(stripes(35), stripes(0), new Set())).toBe(0);
    // A blank page stays different at every move.
    expect(changedShare(stripes(35), grid([255, 255, 255]), new Set())).toBeGreaterThan(0.25);
  });

  it('leaves masked ad areas out', () => {
    const top = maskedCells([{ x: 0, y: 0, width: 1366, height: 400 }], 1366, 800);
    expect(top.size).toBe(CELLS / 2);
    const changedTop = grid([255, 255, 255]);
    for (const cell of top) changedTop.set([0, 0, 0], cell * 4);
    expect(changedShare(grid([255, 255, 255]), changedTop, top)).toBe(0);
    // Off-screen and empty boxes mask nothing.
    expect(maskedCells([{ x: 0, y: 900, width: 10, height: 10 }], 1366, 800).size).toBe(0);
    expect(maskedCells([{ x: 5, y: 5, width: 0, height: 10 }], 1366, 800).size).toBe(0);
    expect(
      changedShare(
        grid([0, 0, 0]),
        grid([255, 255, 255]),
        maskedCells([{ x: 0, y: 0, width: 1366, height: 800 }], 1366, 800),
      ),
    ).toBe(0);
  });
});
