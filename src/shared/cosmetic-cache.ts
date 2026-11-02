import { fastHash, type Features } from '../engines/adblock/generic-tokens.ts';

/**
 * Hiding results by host, in `storage.local` because content scripts can read it. A site seen before
 * is styled from here without waking the service worker, which otherwise stays alive for as long as
 * pages keep opening.
 */
export const CACHE_PREFIX = 'cosmetic/';

export const startKey = (hostname: string) => `${CACHE_PREFIX}${hostname}`;

/** The same features in any order give the same key, in the page and in the worker. */
export function domKey(hostname: string, f: Features): string {
  const all = [...f.classes, ...f.ids, ...f.hrefs].sort().join('\n');
  return `${CACHE_PREFIX}${hostname}/${fastHash(all)}`;
}

export interface CachedStyle<Rule> {
  css: string;
  extended: Rule[];
}
