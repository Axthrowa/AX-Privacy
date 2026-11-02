import {
  POPUP_ARM_MS,
  callersOf,
  isForeignPopup,
  isScriptLink,
  shouldBlockOpen,
} from '../engines/popup/click.ts';
import { decoy } from '../engines/popup/decoy.ts';

// uBO Lite's prevent-window-open (scriptlets.js) blocks window.open and answers with a decoy
// iframe, because popunder scripts copy open from a fresh iframe's contentWindow. Replacing only
// the page's window.open leaves that copy native. Evidence: ev_34a69f1ecdaaa5a7bc08ef03583cb72f38391c87339d59cbe78685c2aff8e1a7.
const guarded = new WeakSet<Window>();
let armedUntil = 0;
let clickedHref: string | null = null;
let overlay = false;
let onControl = false;

/** The one decision every way of opening a tab goes through. */
function isAdWindow(dest: string): boolean {
  return (
    Date.now() < armedUntil &&
    shouldBlockOpen(location.href, dest, clickedHref, overlay, {
      onControl,
      callers: callersOf(new Error().stack),
    })
  );
}

const opensNewTab = (target: string | null) =>
  !!target &&
  !['_self', '_parent', '_top'].includes(target.toLowerCase()) &&
  !document.getElementsByName(target).length;

/** Ad scripts also open tabs by submitting a hidden form or clicking a link they never attach. */
function guardElements(win: Window & typeof globalThis): void {
  const form = win.HTMLFormElement.prototype;
  for (const method of ['submit', 'requestSubmit'] as const) {
    const native = form[method] as (this: HTMLFormElement, ...args: unknown[]) => void;
    (form as unknown as Record<string, unknown>)[method] = function (
      this: HTMLFormElement,
      ...args: unknown[]
    ) {
      if (!(opensNewTab(this.getAttribute('target')) && isAdWindow(this.action))) {
        native.apply(this, args);
      }
    };
  }
  const anchor = win.HTMLAnchorElement.prototype;
  const nativeClick = anchor.click;
  anchor.click = function (this: HTMLAnchorElement) {
    if (!(opensNewTab(this.getAttribute('target')) && isAdWindow(this.href))) {
      nativeClick.call(this);
    }
  };
  const nativeDispatch = anchor.dispatchEvent;
  anchor.dispatchEvent = function (this: HTMLAnchorElement, event: Event) {
    const adClick =
      event.type === 'click' && opensNewTab(this.getAttribute('target')) && isAdWindow(this.href);
    return adClick ? false : nativeDispatch.call(this, event);
  };
}

function covers(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width >= innerWidth * 0.7 && r.height >= innerHeight * 0.7;
}

function guard(win: Window): void {
  if (guarded.has(win)) return;
  let native: typeof win.open;
  try {
    native = win.open.bind(win);
  } catch {
    return;
  }
  const hooked = function (url?: string | URL, target?: string, features?: string) {
    const dest = url instanceof URL ? url.href : String(url ?? '');
    if (isAdWindow(dest)) return decoy();
    return native(url, target, features);
  };
  hooked.toString = () => native.toString();
  try {
    Object.defineProperty(win, 'open', { configurable: true, writable: true, value: hooked });
    guardElements(win as Window & typeof globalThis);
    guarded.add(win);
  } catch {
    // The page locked open. The contentWindow hook still covers frames created later.
  }
}

const view = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
if (view?.get) {
  const get = view.get;
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    enumerable: view.enumerable,
    get() {
      const win = get.call(this) as Window | null;
      if (win) guard(win);
      return win;
    },
  });
}
guard(window);

const CONTROLS =
  'button,input,select,label,summary,[role=button],[role=link],[role=menuitem],[onclick]';

function isControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(CONTROLS) || getComputedStyle(target).cursor === 'pointer';
}

function arm(e: MouseEvent): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  armedUntil = Date.now() + POPUP_ARM_MS;
  if (!e.isTrusted) {
    clickedHref = null;
    overlay = false;
    onControl = false;
    const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (link instanceof HTMLAnchorElement && isForeignPopup(location.href, link.href)) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }
  const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
  const href = link instanceof HTMLAnchorElement ? link.href : null;
  const scriptLink = href !== null && isScriptLink(location.href, href);
  clickedHref = scriptLink ? null : href;
  onControl = scriptLink || isControl(e.target);
  overlay =
    link instanceof HTMLAnchorElement && isForeignPopup(location.href, link.href) && covers(link);
  if (!overlay || !(link instanceof HTMLAnchorElement)) return;
  e.preventDefault();
  e.stopPropagation();
  link.style.setProperty('pointer-events', 'none', 'important');
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (under && under !== link) under.dispatchEvent(new MouseEvent(e.type, e));
}

for (const type of ['pointerdown', 'mousedown', 'click'] as const) {
  addEventListener(type, arm, true);
}
