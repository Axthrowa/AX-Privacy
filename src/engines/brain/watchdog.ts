// Breakage watchdog for AX-Brain hides: what a page must keep, and when a batch of hides broke it.
// Pure functions; the content script measures the page and acts on the answer.

/** Elements that are the page's content, never an ad around it. */
export const CONTENT_SELECTOR = 'main, article, [role="main"], h1, input[type="password"]';

/** Below this much page text, a share of it says little about what an element is. */
const MIN_PAGE_TEXT = 500;
/** An element holding this share of the page's text is content. */
const CONTENT_SHARE = 0.3;

export function guardsContent(
  el: Pick<Element, 'matches' | 'querySelector' | 'textContent'>,
  pageText: number,
): boolean {
  if (el.matches(CONTENT_SELECTOR) || el.querySelector(CONTENT_SELECTOR)) return true;
  return pageText > MIN_PAGE_TEXT && (el.textContent?.length ?? 0) > pageText * CONTENT_SHARE;
}

export interface PageHealth {
  /** Length of the visible text (`innerText`). */
  text: number;
  /** The page is longer than the window and may scroll. */
  scrollable: boolean;
}

export type BreakReason = 'layout-shift' | 'empty-content' | 'scroll-locked';

/** Cumulative layout shift a hide may cause; removing a banner moves content a little. */
export const MAX_SHIFT = 0.5;

/** Why the page looks broken after the hides, or null when it looks fine. */
export function brokenBy(before: PageHealth, after: PageHealth, shift: number): BreakReason | null {
  if (shift > MAX_SHIFT) return 'layout-shift';
  if (before.text > MIN_PAGE_TEXT && after.text < before.text / 2) return 'empty-content';
  if (before.scrollable && !after.scrollable) return 'scroll-locked';
  return null;
}
