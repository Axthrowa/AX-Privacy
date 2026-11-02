/**
 * A hidden sandboxed frame's window, returned instead of a real popup: popunder scripts keep using
 * the window they get back. Evidence (uBO Lite prevent-window-open):
 * ev_34a69f1ecdaaa5a7bc08ef03583cb72f38391c87339d59cbe78685c2aff8e1a7.
 */
export function decoy(): Window | null {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', '');
  frame.style.display = 'none';
  (document.documentElement ?? document).append(frame);
  const win = frame.contentWindow;
  if (!win) return null;
  try {
    Object.defineProperty(win, 'closed', { configurable: true, value: false });
  } catch {
    // The decoy window can refuse the property; the frame still cannot open a tab.
  }
  return win;
}
