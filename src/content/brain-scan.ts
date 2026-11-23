import type { BrainModel } from '../engines/brain/brain.ts';
import {
  CANDIDATE_SELECTOR,
  isSafePlatform,
  scoreElement,
  SKIP_TAGS,
} from '../engines/brain/scorer.ts';
import { send } from '../shared/messages.ts';

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

function hide(el: HTMLElement): void {
  hidden.add(el);
  el.setAttribute('data-ax-hidden', '1');
  el.style.setProperty('display', 'none', 'important');
  el.style.setProperty('visibility', 'hidden', 'important');
  el.style.setProperty('pointer-events', 'none', 'important');
  unlockScroll();
}

function evaluate(el: Element): void {
  if (SKIP_TAGS.has(el.tagName) || hidden.has(el) || !(el instanceof HTMLElement)) return;
  const sig = signature(el);
  if (seen.get(el) === sig) return;
  seen.set(el, sig);
  try {
    const res = scoreElement(el, {
      currentHost: host,
      model,
      isLateInjected: lateInjected.has(el),
    });
    if (res.shouldHide) hide(el);
  } catch {
    // A node detached mid-scan; nothing to hide.
  }
}

const idle = (fn: () => void) =>
  'requestIdleCallback' in globalThis
    ? requestIdleCallback(fn, { timeout: 100 })
    : setTimeout(fn, 50);

function run(queue: Element[]): void {
  let i = 0;
  const slice = () => {
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
  new MutationObserver((mutations) => {
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
  }).observe(document.documentElement, {
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

if (!isSafePlatform(host)) {
  // The background answers null when protection is off for this site.
  send('brain/model', {})
    .then((res) => {
      if (!res) return;
      model = res.model;
      start();
    })
    .catch(() => undefined);
}
