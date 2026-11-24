// Bundled by scripts/brain-crawl.ts and run inside each crawled page. It labels what the page's
// cosmetic filters would hide (the crawler marks those with `--ax-label: 1`) and returns the
// 48-feature vectors of a sample of labelled and unlabelled candidates. No page text leaves it.
import { extractRichFeatures } from '../src/engines/brain/rich.ts';
import { CANDIDATE_SELECTOR, exclusionReason, SKIP_TAGS } from '../src/engines/brain/scorer.ts';

const labelled = (el: Element) =>
  getComputedStyle(el).getPropertyValue('--ax-label').trim() === '1';

function sample<T>(items: T[], n: number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items.slice(0, n);
}

/** DOM tokens the cosmetic engine needs to pick its generic rules. */
function domTokens(): { classes: string[]; ids: string[]; hrefs: string[] } {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const hrefs = new Set<string>();
  for (const el of document.querySelectorAll('[id], [class], a[href]')) {
    if (el.id) ids.add(el.id);
    for (const c of el.classList) classes.add(c);
    const href = el.getAttribute('href');
    if (el.tagName === 'A' && href) hrefs.add(href);
    if (classes.size > 20000) break;
  }
  return { classes: [...classes], ids: [...ids], hrefs: [...hrefs].slice(0, 5000) };
}

function collect(host: string, maxPositive: number): { y: 0 | 1; f: number[] }[] {
  const tops: Element[] = [];
  const unlabelled: Element[] = [];
  const nearAds = new Set<Element>();
  for (const el of [...document.querySelectorAll(CANDIDATE_SELECTOR)].slice(0, 6000)) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (labelled(el)) {
      if (el.parentElement && labelled(el.parentElement)) continue;
      tops.push(el);
      // Containers of an ad are neither ads nor clean examples.
      for (let p = el.parentElement; p; p = p.parentElement) nearAds.add(p);
    } else {
      unlabelled.push(el);
    }
  }
  const usable = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width >= 10 &&
      r.height >= 10 &&
      s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      exclusionReason(el, host) === null
    );
  };
  const ctx = {
    currentHost: host,
    viewport: { width: innerWidth, height: innerHeight },
    isLateInjected: false,
  };
  const pos = sample(tops.filter(usable), maxPositive);
  const neg = sample(
    unlabelled.filter((el) => !nearAds.has(el) && usable(el)),
    Math.max(10, pos.length * 2),
  );
  const round = (f: number[]) => f.map((v) => Math.round(v * 1000) / 1000);
  return [
    ...pos.map((el) => ({ y: 1 as const, f: round(extractRichFeatures(el, ctx)) })),
    ...neg.map((el) => ({ y: 0 as const, f: round(extractRichFeatures(el, ctx)) })),
  ];
}

(globalThis as unknown as Record<string, unknown>).__axBrain = { domTokens, collect };
