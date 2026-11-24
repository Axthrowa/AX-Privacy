import { similarSelector, uniqueSelector } from '../engines/adblock/picker-selector.ts';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import { extractFeatures } from '../engines/brain/brain.ts';

// Injected into the top frame only when the user asks, from the popup. Nothing here runs otherwise.
// Same-origin frames are reached through the top page's DOM; other origins stay one box.
declare global {
  var __nexusPickerStop: (() => void) | undefined;
}

const CSS_TEXT = `
:host { all: initial; }
[hidden] { display: none !important; }
#box { position: fixed; pointer-events: none; z-index: 2147483646; box-sizing: border-box;
  border: 2px solid #e8590c; background: rgba(232, 89, 12, .25); display: none; }
#panel { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483647;
  width: min(560px, calc(100vw - 32px)); box-sizing: border-box; padding: 12px; border-radius: 8px;
  background: #202124; color: #e8eaed; font: 14px/1.4 system-ui, sans-serif;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .5); }
#panel.top { bottom: auto; top: 16px; }
p { margin: 0 0 8px; }
code { display: block; margin: 0 0 8px; padding: 6px; max-height: 4.5em; overflow: auto;
  background: #000; border-radius: 4px; font: 12px/1.4 monospace; word-break: break-all; }
button { font: inherit; color: inherit; background: #3c4043; border: 0; border-radius: 4px;
  padding: 6px 10px; margin: 0 6px 0 0; cursor: pointer; }
button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: #e8590c; color: #fff; }
label { display: block; margin: 0 0 8px; }
.error { color: #f28b82; }
`;

self.__nexusPickerStop?.();

const host = document.createElement('nexus-picker');
const root = host.attachShadow({ mode: 'open' });
try {
  // Constructed sheets are exempt from the page's style CSP.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS_TEXT);
  root.adoptedStyleSheets = [sheet];
} catch {
  // Firefox can refuse a sheet built in a content script.
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  root.append(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

const box = el('div');
box.id = 'box';
const panel = el('div');
panel.id = 'panel';
panel.setAttribute('role', 'dialog');
panel.setAttribute('aria-label', L('Öğe gizleme', 'Hide an element'));
const hint = el(
  'p',
  L(
    'Öğeye tıklayın ya da ok tuşlarıyla seçin. Enter gizler, Delete geçici siler, Esc çıkar.',
    'Click an element or pick one with the arrow keys. Enter hides, Delete removes for now, Esc exits.',
  ),
);
hint.setAttribute('aria-live', 'polite');
const code = el('code');
code.hidden = true;
const similarLabel = el('label');
const similarBox = el('input');
similarBox.type = 'checkbox';
similarLabel.append(similarBox, ' Benzerlerini de gizle');
similarLabel.hidden = true;
const parentButton = el('button', L('Üst öğe', 'Parent'));
const saveButton = el('button', L('Bu sitede gizle', 'Hide on this site'));
saveButton.className = 'primary';
// The zapper: gone until the page reloads, with no rule saved and nothing sent anywhere.
const zapButton = el('button', L('Geçici sil', 'Remove for now'));
const cancelButton = el('button', L('Bitti', 'Done'));
for (const b of [parentButton, saveButton, zapButton]) b.disabled = true;
panel.append(hint, code, similarLabel, saveButton, zapButton, parentButton, cancelButton);
root.append(box, panel);

let picked: Element | null = null;

const inPanel = (e: Event) => e.composedPath().includes(host);
const isRoot = (t: Element) => t === t.ownerDocument.documentElement || t === t.ownerDocument.body;
const selectable = (t: Element | null) => (t && !isRoot(t) && t !== host ? t : null);

/** A same-origin frame's document; null for other origins (they stay one pickable box). */
function frameDoc(f: Element): Document | null {
  if (f.tagName !== 'IFRAME' && f.tagName !== 'FRAME') return null;
  try {
    return (f as HTMLIFrameElement).contentDocument;
  } catch {
    return null;
  }
}

/** The element at a point of `doc`'s viewport, looking into same-origin frames. */
function at(doc: Document, x: number, y: number): Element | null {
  let el = doc.elementFromPoint(x, y);
  for (let inner = el && frameDoc(el); el && inner; inner = frameDoc(el)) {
    const r = el.getBoundingClientRect();
    x -= r.left + el.clientLeft;
    y -= r.top + el.clientTop;
    const next = inner.elementFromPoint(x, y);
    if (!next) break;
    el = next;
  }
  return el;
}

/** The document an event happened in: the top page or a same-origin frame. */
const docOf = (e: Event) => (e.target as Node | null)?.ownerDocument ?? document;

/** Every same-origin frame window under `doc`, so the picker hears events made inside them. */
function frameWindows(doc: Document, out: Window[] = []): Window[] {
  for (const f of doc.querySelectorAll('iframe, frame')) {
    const inner = frameDoc(f);
    if (inner?.defaultView) {
      out.push(inner.defaultView);
      frameWindows(inner, out);
    }
  }
  return out;
}

/** `target`'s box in the top page's viewport, adding each frame's offset. */
function topRect(target: Element): { left: number; top: number; width: number; height: number } {
  const r = target.getBoundingClientRect();
  let { left, top } = r;
  let f = target.ownerDocument.defaultView?.frameElement ?? null;
  while (f) {
    const fr = f.getBoundingClientRect();
    left += fr.left + f.clientLeft;
    top += fr.top + f.clientTop;
    f = f.ownerDocument.defaultView?.frameElement ?? null;
  }
  return { left, top, width: r.width, height: r.height };
}

function outline(target: Element | null): void {
  if (!target) {
    box.style.display = 'none';
    return;
  }
  const r = topRect(target);
  box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  // Keep the panel off what is being picked.
  panel.classList.toggle('top', r.top + r.height > innerHeight - 160);
}

const selector = () =>
  picked ? (similarBox.checked ? similarSelector(picked) : uniqueSelector(picked)) : '';

function show(): void {
  if (!picked) return;
  const s = selector();
  const count = picked.ownerDocument.querySelectorAll(s).length;
  code.textContent = s;
  code.hidden = false;
  similarLabel.hidden = false;
  hint.className = '';
  hint.textContent = L(
    `${count} öğe gizlenecek. Sayfa bozulursa kural Kontrol panelinden silinebilir.`,
    `${count} elements will be hidden. If the page breaks, the rule can be removed in the Dashboard.`,
  );
  saveButton.disabled = false;
  zapButton.disabled = false;
  parentButton.disabled = selectable(picked.parentElement) === null;
  outline(picked);
}

/** What the mouse is over, so the arrow keys can start from it. */
let hovered: Element | null = null;

function onMove(e: MouseEvent): void {
  if (picked || inPanel(e)) return;
  hovered = selectable(at(docOf(e), e.clientX, e.clientY));
  outline(hovered);
}

/** The page must not see clicks made while choosing, or its links would fire. */
function swallow(e: Event): void {
  if (inPanel(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  // Events from a frame come from its realm, where `instanceof MouseEvent` is false.
  if (e.type !== 'click' || !('clientX' in e)) return;
  const m = e as MouseEvent;
  const target = selectable(at(docOf(e), m.clientX, m.clientY));
  if (target) {
    picked = target;
    show();
    saveButton.focus();
  }
}

/** Up: the container. Down: first thing inside. Left and right: the elements beside it. */
function moved(from: Element, key: string): Element | null {
  if (key === 'ArrowUp') return from.parentElement;
  if (key === 'ArrowDown') return from.firstElementChild;
  return key === 'ArrowLeft' ? from.previousElementSibling : from.nextElementSibling;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    cancel();
    return;
  }
  if (e.key === 'Enter' && picked && !inPanel(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.isTrusted) save();
    return;
  }
  // The panel has no text field, so Delete means the same there.
  if (e.key === 'Delete' && picked) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.isTrusted) zap();
    return;
  }
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const next = picked
    ? selectable(moved(picked, e.key))
    : // A short page leaves the middle of the window empty: start at its first element then.
      (hovered ??
      selectable(at(document, innerWidth / 2, innerHeight / 2)) ??
      selectable(document.body?.firstElementChild ?? null));
  if (!next) return;
  picked = next;
  next.scrollIntoView({ block: 'nearest' });
  show();
}

const SWALLOWED = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'];

const listened: Window[] = [window, ...frameWindows(document)];

function stop(): void {
  for (const w of listened) {
    try {
      w.removeEventListener('mousemove', onMove, true);
      w.removeEventListener('keydown', onKey, true);
      for (const t of SWALLOWED) w.removeEventListener(t, swallow, true);
    } catch {
      // The frame navigated away and is no longer reachable.
    }
  }
  host.remove();
  self.__nexusPickerStop = undefined;
}

function cancel(): void {
  stop();
  void send('picker/cancel', {}).catch(() => undefined);
}

similarBox.addEventListener('change', show);
parentButton.addEventListener('click', () => {
  const parent = selectable(picked?.parentElement ?? null);
  if (parent) {
    picked = parent;
    show();
  }
});
cancelButton.addEventListener('click', cancel);

/** Removes the picked element and keeps the picker open for the next one. */
function zap(): void {
  if (!picked) return;
  picked.remove();
  picked = null;
  outline(null);
  code.hidden = true;
  similarLabel.hidden = true;
  for (const b of [parentButton, saveButton, zapButton]) b.disabled = true;
  hint.className = '';
  hint.textContent = L(
    'Silindi; sayfa yenilenince geri gelir. Başka bir öğe seçebilirsiniz.',
    'Removed until the page reloads. You can pick another element.',
  );
}
zapButton.addEventListener('click', (e) => {
  if (e.isTrusted) zap();
});
function save(): void {
  if (!picked) return;
  const s = selector();
  saveButton.disabled = true;
  let features: number[] | undefined;
  try {
    features = extractFeatures(picked, { currentHost: location.hostname });
  } catch {
    // Learning is a bonus; the rule is still saved without it.
  }
  send('picker/add', { selector: s, features })
    .then(() => {
      for (const match of (picked?.ownerDocument ?? document).querySelectorAll(s)) {
        (match as HTMLElement).style?.setProperty('display', 'none', 'important');
      }
      stop();
    })
    .catch((err: unknown) => {
      saveButton.disabled = false;
      hint.className = 'error';
      hint.textContent = `Kural kaydedilemedi: ${err instanceof Error ? err.message : String(err)}`;
    });
}
saveButton.addEventListener('click', (e) => {
  // A rule is only ever saved by a real click, not one the page synthesized on this panel.
  if (e.isTrusted) save();
});

for (const w of listened) {
  w.addEventListener('mousemove', onMove, true);
  w.addEventListener('keydown', onKey, true);
  for (const t of SWALLOWED) w.addEventListener(t, swallow, true);
}
document.documentElement.append(host);
self.__nexusPickerStop = stop;
