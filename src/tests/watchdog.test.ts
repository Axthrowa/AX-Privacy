import { describe, expect, it } from 'vitest';
import { brokenBy, guardsContent, MAX_SHIFT } from '../engines/brain/watchdog.ts';

const el = (o: { self?: boolean; inner?: boolean; text?: number }) =>
  ({
    matches: () => o.self ?? false,
    querySelector: () => (o.inner ? {} : null),
    textContent: 'x'.repeat(o.text ?? 0),
  }) as unknown as Element;

describe('AX-Brain watchdog', () => {
  it('never lets a hide take the page content', () => {
    expect(guardsContent(el({ self: true }), 0)).toBe(true);
    expect(guardsContent(el({ inner: true }), 0)).toBe(true);
    // A third of a long page's text is content, not an ad.
    expect(guardsContent(el({ text: 400 }), 1000)).toBe(true);
    expect(guardsContent(el({ text: 100 }), 1000)).toBe(false);
    // On a near-empty page a share says nothing.
    expect(guardsContent(el({ text: 300 }), 400)).toBe(false);
  });

  it('calls a batch broken on a big shift, lost content or a locked scroll', () => {
    const ok = { text: 5000, scrollable: true };
    expect(brokenBy(ok, ok, 0.1)).toBeNull();
    expect(brokenBy(ok, ok, MAX_SHIFT + 0.01)).toBe('layout-shift');
    expect(brokenBy(ok, { text: 2000, scrollable: true }, 0)).toBe('empty-content');
    expect(brokenBy(ok, { text: 4800, scrollable: false }, 0)).toBe('scroll-locked');
    // A short page that never scrolled is not "locked".
    expect(
      brokenBy({ text: 100, scrollable: false }, { text: 40, scrollable: false }, 0),
    ).toBeNull();
  });
});
