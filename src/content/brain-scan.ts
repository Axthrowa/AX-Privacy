import {
  extractFeatures,
  FEATURE_COUNT,
  rootDomain,
  type BrainModel,
} from '../engines/brain/brain.ts';
import { extractRichFeatures, richProbability } from '../engines/brain/rich.ts';
import {
  CANDIDATE_SELECTOR,
  isSafePlatform,
  scoreElement,
  SKIP_TAGS,
} from '../engines/brain/scorer.ts';
import { send } from '../shared/messages.ts';
import { SIGNAL_EVENT } from '../engines/brain/id-value.ts';
import { L } from '../shared/i18n.ts';
import {
  brokenBy,
  guardsContent,
  type BreakReason,
  type PageHealth,
} from '../engines/brain/watchdog.ts';

// Universal ad/overlay scanner: scores candidates the filter lists missed and hides the ads.
// Work is incremental (mutated subtrees only) and split into idle slices of 50 nodes.

const SLICE = 50;
const DEBOUNCE_MS = 200;
/** A batch this large is cheaper to handle as one full scan than as many subtree queries. */
const FULL_SCAN_OVER = 500;
/** Nodes added this soon after a real click count as injected by it. */
const LATE_INJECT_MS = 1500;

const host = location.hostname.toLowerCase();
/** Element -> signature at its last scoring; changed elements (a filled slot) are scored again. */
const seen = new WeakMap<Element, string>();
const hidden = new WeakSet<Element>();
const lateInjected = new WeakSet<Element>();
let model: BrainModel | null = null;
/** Layer 3 (Gemini Nano) is on and ready: unsure elements may be asked about. */
let nano = false;
/** Questions per page; the on-device model takes about a second each. */
const MAX_ASKS = 3;
const NANO_BAND = [0.45, 0.75] as const;
let asked = 0;
/** Messages per frame; later hides still happen, they are just not reported. */
const MAX_REPORTS = 30;
let reported = 0;
let lastUserAction = -Infinity;

const signature = (el: Element) =>
  `${el.childElementCount}:${(el.textContent ?? '').length}:${typeof el.className === 'string' ? el.className : ''}:${el.getAttribute('style')?.length ?? 0}`;

/** Ad overlays lock page scroll; give it back once one is gone. */
function unlockScroll(): void {
  const body = document.body;
  if (body && (body.style.overflow === 'hidden' || body.style.position === 'fixed')) {
    body.style.removeProperty('overflow');
    body.style.removeProperty('position');
  }
  if (document.documentElement.style.overflow === 'hidden') {
    document.documentElement.style.removeProperty('overflow');
  }
}

const HIDE_PROPS = ['display', 'visibility', 'pointer-events'] as const;
/** The popup lists this many; the watchdog can roll back up to MAX_KEPT. */
const MAX_UNDO = 50;
const MAX_KEPT = 500;
const isTop = window === window.top;
/** Set once the hides here were rolled back; the scanner stops for this page. */
let stopped = false;
let observer: MutationObserver | undefined;
interface Hidden {
  id: number;
  el: HTMLElement;
  reasons: string[];
  /** The element's own inline values, put back on undo. */
  before: [string, string, string][];
}
const undoable: Hidden[] = [];
let nextId = 1;

function hide(el: HTMLElement, reasons: string[] = []): void {
  hidden.add(el);
  if (isTop) watch();
  if (isTop && undoable.length < MAX_KEPT) {
    undoable.push({
      id: nextId++,
      el,
      reasons,
      before: HIDE_PROPS.map((p) => [
        p,
        el.style.getPropertyValue(p),
        el.style.getPropertyPriority(p),
      ]),
    });
  }
  el.setAttribute('data-ax-hidden', '1');
  el.style.setProperty('display', 'none', 'important');
  el.style.setProperty('visibility', 'hidden', 'important');
  el.style.setProperty('pointer-events', 'none', 'important');
  unlockScroll();
  if (isTop) showToast();
}

function unhide(item: Hidden): void {
  for (const [p, v, prio] of item.before) {
    if (v) item.el.style.setProperty(p, v, prio);
    else item.el.style.removeProperty(p);
  }
  item.el.removeAttribute('data-ax-hidden');
}

function health(): PageHealth {
  const root = document.documentElement;
  const locked = [root, document.body].some(
    (n) => n !== null && getComputedStyle(n).overflowY === 'hidden',
  );
  return {
    text: document.body?.innerText.length ?? 0,
    scrollable: !locked && root.scrollHeight > innerHeight + 50,
  };
}

/** Layout shift since the current watch window opened, ignoring shifts the user caused. */
let shift = 0;
let watching: { before: PageHealth } | null = null;
/** How long after a hide the page is checked. */
const WATCH_MS = 1000;

/** Opens a check window before the first hide of a batch; the page is judged once it settles. */
function watch(): void {
  if (watching || stopped) return;
  watching = { before: health() };
  shift = 0;
  setTimeout(() => {
    const before = watching?.before;
    watching = null;
    if (!before || stopped) return;
    const reason = brokenBy(before, health(), shift);
    if (reason) rollback(reason);
  }, WATCH_MS);
}

if (isTop && 'PerformanceObserver' in globalThis) {
  try {
    new PerformanceObserver((list) => {
      if (!watching) return;
      for (const e of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!e.hadRecentInput) shift += e.value;
      }
    }).observe({ type: 'layout-shift' });
  } catch {
    // No layout-shift entries in this browser; the other checks still run.
  }
}

/**
 * Puts every AX-Brain hide on this page back and stops the scanner. The background turns AX-Brain
 * off on the site for 7 days (lists keep working) and unlearns what was hidden here.
 */
function rollback(reason: BreakReason | 'user'): void {
  if (stopped) return;
  stopped = true;
  observer?.disconnect();
  for (const item of undoable.splice(0)) unhide(item);
  toast?.remove();
  void send('brain/broke', { reason }).catch(() => undefined);
}

const TOAST_MS = 6000;
let toast: HTMLElement | undefined;
let toastLabel: HTMLElement | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** "AX-Brain hid N elements [Undo]" for 6 seconds after the latest hide. */
function showToast(): void {
  if (stopped || !document.body) return;
  if (!toast) {
    toast = document.createElement('ax-brain-toast');
    hidden.add(toast);
    const root = toast.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
      div { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
        background: #111827; color: #f8fafc; border: 1px solid rgba(56,189,248,.35);
        border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
        font: 13px/1.3 -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
      button { background: linear-gradient(135deg,#0ea5e9,#0284c7); color: #fff; border: 0;
        border-radius: 6px; padding: 5px 10px; font: inherit; font-weight: 600; cursor: pointer; }`;
    const box = document.createElement('div');
    box.setAttribute('role', 'status');
    toastLabel = document.createElement('span');
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.textContent = L('Geri Al', 'Undo');
    undo.addEventListener('click', (e) => {
      if (e.isTrusted) rollback('user');
    });
    box.append(toastLabel, undo);
    root.append(style, box);
  }
  if (toastLabel) {
    toastLabel.textContent = L(
      `AX-Brain bu sayfada ${undoable.length} öğe gizledi.`,
      `AX-Brain hid ${undoable.length} elements on this page.`,
    );
  }
  if (!toast.isConnected) document.documentElement.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast?.remove(), TOAST_MS);
}

/** Visible page text, measured at most once per scan slice. */
let pageText: number | null = null;

/**
 * Until the background has answered, elements are only checked for an ad sign: the model and this
 * site's switches are asked for at the first one, so an ordinary page never wakes the worker.
 */
let active = false;
let asking = false;
function probe(el: Element): void {
  if (asking || SKIP_TAGS.has(el.tagName) || !(el instanceof HTMLElement)) return;
  try {
    if (scoreElement(el, { currentHost: host, model: null }).score <= 0) return;
  } catch {
    return;
  }
  asking = true;
  // The background answers null when protection or AX-Brain is off for this site.
  send('brain/model', {})
    .then((res) => {
      if (!res) {
        stopped = true;
        observer?.disconnect();
        return;
      }
      model = res.model;
      nano = res.nano;
      active = true;
      idle(fullScan);
    })
    .catch(() => undefined);
}

function evaluate(el: Element): void {
  if (stopped) return;
  if (!active) {
    probe(el);
    return;
  }
  if (SKIP_TAGS.has(el.tagName) || hidden.has(el) || !(el instanceof HTMLElement)) return;
  const sig = signature(el);
  if (seen.get(el) === sig) return;
  seen.set(el, sig);
  try {
    const ctx = { currentHost: host, model, isLateInjected: lateInjected.has(el) };
    const res = scoreElement(el, ctx);
    if (!res.shouldHide) {
      askNano(el, ctx, res);
      return;
    }
    pageText ??= document.body?.innerText.length ?? 0;
    // Never the page's own content, however ad-like it scores.
    if (guardsContent(el, pageText)) return;
    hide(el, res.reasons);
    pageText = null;
    // Shown in the popup, and unlearned if the user says the page broke.
    if (++reported <= MAX_REPORTS) {
      void send('brain/hidden', {
        reasons: res.reasons,
        features: extractFeatures(el, ctx),
      }).catch(() => undefined);
    }
  } catch {
    // A node detached mid-scan; nothing to hide.
  }
}

/** Unsure by the page model: hidden only if Gemini Nano on the device says it is an ad. */
function askNano(
  el: HTMLElement,
  ctx: Parameters<typeof extractFeatures>[1],
  { score, reasons }: { score: number; reasons: string[] },
) {
  // Score 0: excluded (player, form, article...) or no ad sign at all. Never asked about.
  if (!nano || !model || asked >= MAX_ASKS || score <= 0) return;
  const rich = extractRichFeatures(el, ctx);
  const features = rich.slice(0, FEATURE_COUNT);
  const p = richProbability(rich, model);
  if (p < NANO_BAND[0] || p > NANO_BAND[1]) return;
  asked++;
  const r = el.getBoundingClientRect();
  const hosts = [
    ...new Set(
      [...el.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap((a) => {
        try {
          return [rootDomain(new URL(a.href).hostname)];
        } catch {
          return [];
        }
      }),
    ),
  ]
    .filter((h) => /^[a-z0-9.-]{1,253}$/.test(h))
    .slice(0, 5);
  send('brain/ask', {
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    hosts,
    width: r.width,
    height: r.height,
  })
    .then((isAd) => {
      if (isAd !== true || stopped || !el.isConnected || hidden.has(el)) return;
      pageText = document.body?.innerText.length ?? 0;
      if (guardsContent(el, pageText)) return;
      const why = [...reasons, 'ax-brain-nano'];
      hide(el, why);
      if (++reported <= MAX_REPORTS) {
        void send('brain/hidden', { reasons: why, features }).catch(() => undefined);
      }
    })
    .catch(() => undefined);
}

const idle = (fn: () => void) =>
  'requestIdleCallback' in globalThis
    ? requestIdleCallback(fn, { timeout: 100 })
    : setTimeout(fn, 50);

function run(queue: Element[]): void {
  let i = 0;
  const slice = () => {
    pageText = null;
    for (const el of queue.slice(i, i + SLICE)) evaluate(el);
    i += SLICE;
    if (i < queue.length) idle(slice);
  };
  slice();
}

function collect(root: ParentNode, into: Element[]): void {
  for (const el of root.querySelectorAll(CANDIDATE_SELECTOR)) into.push(el);
}

function fullScan(): void {
  const queue: Element[] = [];
  collect(document, queue);
  run(queue);
}

let pendingSelf = new Set<Element>();
let pendingDeep = new Set<Element>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  timer = undefined;
  const self = pendingSelf;
  const deep = pendingDeep;
  pendingSelf = new Set();
  pendingDeep = new Set();
  if (self.size + deep.size > FULL_SCAN_OVER) {
    idle(fullScan);
    return;
  }
  const queue: Element[] = [];
  for (const el of self) if (el.matches(CANDIDATE_SELECTOR)) queue.push(el);
  for (const el of deep) {
    if (el.matches(CANDIDATE_SELECTOR)) queue.push(el);
    collect(el, queue);
  }
  idle(() => run(queue));
}

function start(): void {
  addEventListener(
    'pointerdown',
    (e) => {
      if (e.isTrusted) lastUserAction = performance.now();
    },
    { capture: true, passive: true },
  );
  observer = new MutationObserver((mutations) => {
    const late = performance.now() - lastUserAction < LATE_INJECT_MS;
    for (const m of mutations) {
      if (!(m.target instanceof Element)) continue;
      pendingSelf.add(m.target);
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        pendingDeep.add(n);
        if (late) lateInjected.add(n);
      }
    }
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'src', 'href'],
  });
  const followUps = () => {
    // Late ad slots and lazy banners
    setTimeout(() => idle(fullScan), 800);
    setTimeout(() => idle(fullScan), 2500);
  };
  if (document.readyState === 'complete') followUps();
  else addEventListener('load', followUps, { once: true });
  if (document.readyState !== 'loading') idle(fullScan);
  else document.addEventListener('DOMContentLoaded', () => idle(fullScan), { once: true });
}

/** A short label for the popup: tag, first class and size. No page text leaves the page. */
function describe(el: HTMLElement): string {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
  const r = el.getBoundingClientRect();
  const size = r.width || r.height ? ` ${Math.round(r.width)}×${Math.round(r.height)}` : '';
  return `${el.tagName.toLowerCase()}${cls ? `.${cls.slice(0, 40)}` : ''}${size}`;
}

function restore(id: number): boolean {
  const i = undoable.findIndex((h) => h.id === id);
  const item = undoable[i];
  if (!item) return false;
  undoable.splice(i, 1);
  // Stays in `hidden`, so the scanner never hides it again on this page.
  unhide(item);
  return true;
}

if (isTop) {
  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (sender.id !== chrome.runtime.id || typeof msg !== 'object' || msg === null) return;
    const m = msg as { type?: unknown; id?: unknown };
    if (m.type === 'brain/list') {
      reply(
        undoable
          .filter((h) => h.el.isConnected)
          .slice(0, MAX_UNDO)
          .map((h) => ({ id: h.id, reasons: h.reasons, label: describe(h.el) })),
      );
    } else if (m.type === 'brain/restore' && typeof m.id === 'number') {
      reply(restore(m.id));
    }
  });
}

// Tracking notes from brain-signals.ts. The page can fake these events, so the background counts a
// note only for a domain it already saw tracking through the network.
let relayed = 0;
document.addEventListener(SIGNAL_EVENT, (e) => {
  if (relayed >= 20 || !(e instanceof CustomEvent) || typeof e.detail !== 'string') return;
  let note: { signal?: unknown; source?: unknown };
  try {
    note = JSON.parse(e.detail) as typeof note;
  } catch {
    return;
  }
  if (
    (note.signal !== 'storage' && note.signal !== 'fingerprint') ||
    typeof note.source !== 'string'
  ) {
    return;
  }
  relayed++;
  void send('brain/signal', { signal: note.signal, source: note.source }).catch(() => undefined);
});

if (!isSafePlatform(host)) start();
