import { realTarget } from '../engines/core/link-clean.ts';
import { LINK_RULES } from '../filters/debounce-data.ts';

// Rewrites a link at the moment it is used, so the page's own link handling still sees the click.
function clean(e: Event): void {
  const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!(link instanceof HTMLAnchorElement)) return;
  const target = realTarget(link.href, LINK_RULES);
  if (target) link.href = target;
}

for (const type of ['mousedown', 'auxclick', 'click', 'contextmenu']) {
  addEventListener(type, clean, true);
}
