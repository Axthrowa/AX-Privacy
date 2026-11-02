import { similarSelector, uniqueSelector } from '../engines/adblock/picker-selector.ts';
import { send } from '../shared/messages.ts';

// Injected into the top frame only when the user asks, from the popup. Nothing here runs otherwise.
declare global {
  var __nexusPickerStop: (() => void) | undefined;
}

const CSS_TEXT = `
:host { all: initial; }
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
panel.setAttribute('aria-label', 'Öğe gizleme');
const hint = el('p', 'Gizlemek istediğiniz öğeye tıklayın. Esc ile çıkın.');
hint.setAttribute('aria-live', 'polite');
const code = el('code');
code.hidden = true;
const similarLabel = el('label');
const similarBox = el('input');
similarBox.type = 'checkbox';
similarLabel.append(similarBox, ' Benzerlerini de gizle');
similarLabel.hidden = true;
const parentButton = el('button', 'Üst öğe');
const saveButton = el('button', 'Bu sitede gizle');
saveButton.className = 'primary';
const cancelButton = el('button', 'İptal');
for (const b of [parentButton, saveButton]) b.disabled = true;
panel.append(hint, code, similarLabel, saveButton, parentButton, cancelButton);
root.append(box, panel);

let picked: Element | null = null;

const inPanel = (e: Event) => e.composedPath().includes(host);
const selectable = (t: Element | null) =>
  t && t !== document.documentElement && t !== document.body && t !== host ? t : null;

function outline(target: Element | null): void {
  if (!target) {
    box.style.display = 'none';
    return;
  }
  const r = target.getBoundingClientRect();
  box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  // Keep the panel off what is being picked.
  panel.classList.toggle('top', r.bottom > innerHeight - 160);
}

const selector = () =>
  picked ? (similarBox.checked ? similarSelector(picked) : uniqueSelector(picked)) : '';

function show(): void {
  if (!picked) return;
  const s = selector();
  const count = document.querySelectorAll(s).length;
  code.textContent = s;
  code.hidden = false;
  similarLabel.hidden = false;
  hint.className = '';
  hint.textContent = `${count} öğe gizlenecek. Sayfa bozulursa kural Kontrol panelinden silinebilir.`;
  saveButton.disabled = false;
  parentButton.disabled = selectable(picked.parentElement) === null;
  outline(picked);
}

function onMove(e: MouseEvent): void {
  if (picked || inPanel(e)) return;
  outline(selectable(document.elementFromPoint(e.clientX, e.clientY)));
}

/** The page must not see clicks made while choosing, or its links would fire. */
function swallow(e: Event): void {
  if (inPanel(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type !== 'click' || !(e instanceof MouseEvent)) return;
  const target = selectable(document.elementFromPoint(e.clientX, e.clientY));
  if (target) {
    picked = target;
    show();
    saveButton.focus();
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    cancel();
  }
}

const SWALLOWED = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'];

function stop(): void {
  removeEventListener('mousemove', onMove, true);
  removeEventListener('keydown', onKey, true);
  for (const t of SWALLOWED) removeEventListener(t, swallow, true);
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
saveButton.addEventListener('click', (e) => {
  // A rule is only ever saved by a real click, not one the page synthesized on this panel.
  if (!e.isTrusted || !picked) return;
  const s = selector();
  saveButton.disabled = true;
  send('picker/add', { selector: s })
    .then(() => {
      for (const match of document.querySelectorAll(s)) {
        (match as HTMLElement).style?.setProperty('display', 'none', 'important');
      }
      stop();
    })
    .catch((err: unknown) => {
      saveButton.disabled = false;
      hint.className = 'error';
      hint.textContent = `Kural kaydedilemedi: ${err instanceof Error ? err.message : String(err)}`;
    });
});

addEventListener('mousemove', onMove, true);
addEventListener('keydown', onKey, true);
for (const t of SWALLOWED) addEventListener(t, swallow, true);
document.documentElement.append(host);
self.__nexusPickerStop = stop;
