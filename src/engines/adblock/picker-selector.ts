/**
 * Selectors for the element picker. Generated names (`css-1a2b3c`, `x8f3d21`) change on the next
 * deploy, and a rule built on them silently stops working, so they are left out.
 */

export function stableName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 40 &&
    !/\d{4,}|[a-f0-9]{8,}/i.test(name) &&
    !/^(?:css|sc|jsx|emotion|svelte)-/.test(name)
  );
}

/** The element on its own terms: `#id`, or its tag and stable classes. */
export function ownSelector(
  tag: string,
  id: string,
  classes: readonly string[],
  escape: (s: string) => string,
): string {
  if (stableName(id)) return `#${escape(id)}`;
  return (
    tag.toLowerCase() +
    classes
      .filter(stableName)
      .map((c) => `.${escape(c)}`)
      .join('')
  );
}

function own(el: Element): string {
  return ownSelector(el.tagName, el.id, [...el.classList], CSS.escape);
}

/** Every element like this one. */
export function similarSelector(el: Element): string {
  return own(el);
}

/** This element only: walks up from it until the path is unique in the document. */
export function uniqueSelector(el: Element): string {
  const parts: string[] = [];
  for (let cur: Element | null = el; cur && cur !== document.documentElement;) {
    const parent: Element | null = cur.parentElement;
    let part = own(cur);
    if (parent && !part.startsWith('#')) {
      const peers = [...parent.children].filter((c) => c.tagName === cur?.tagName);
      if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    const selector = parts.join(' > ');
    if (document.querySelectorAll(selector).length === 1) return selector;
    cur = parent;
  }
  return parts.join(' > ');
}
