import { describe, expect, it } from 'vitest';
import { compileList } from '../engines/adblock/network.ts';
import { callsFor, compileScriptlets } from '../engines/adblock/scriptlets.ts';

// Small seeded PRNG (mulberry32): the same lines every run, so a failure can be replayed.
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIXES = ['', '', '||', '|', '@@', '@@||', '/', '-'];
const BODIES = [
  'ads',
  'track.js',
  'x.example',
  'cdn.x.example/ads/',
  '*',
  '^',
  '/banner[0-9]+\\.gif/',
  '.gif',
  '',
  '?utm=',
  'ü.example',
  '|',
  '$',
  ',',
  '#',
];
const OPTIONS = [
  'script',
  'image',
  'third-party',
  '~third-party',
  'domain=a.example',
  'domain=~a.example',
  'domain=/re\\.example/',
  'domain=a.example|/b\\./',
  'domain=',
  'popup',
  'important',
  'badfilter',
  'redirect=noop.js',
  'removeparam=utm_source',
  'csp=script-src none',
  '1p',
  '3p',
  'xhr',
  'document',
  'all',
  'match-case',
  '~script',
  'denyallow=x.example',
  'from=a.example',
  'to=b.example',
  'ping',
  'header=x',
  'replace=/a/b/',
];

function line(next: () => number): string {
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)] as T;
  let text = pick(PREFIXES);
  for (let n = 1 + Math.floor(next() * 3); n > 0; n--) text += pick(BODIES);
  if (next() < 0.6) {
    const opts = Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(OPTIONS));
    text += `$${opts.join(',')}`;
  }
  // Now and then, a stray byte where lists never put one.
  if (next() < 0.05) text += String.fromCharCode(Math.floor(next() * 0x2fff));
  return text;
}

const lines = (() => {
  const next = random(0xa11ce);
  return Array.from({ length: 5000 }, () => line(next));
})();

describe('compiler fuzz', () => {
  for (const allowRegex of [false, true]) {
    it(`never throws, and never emits a rule that matches everything (regex ${allowRegex})`, () => {
      const { rules, popupRules } = compileList(lines, { allowRegex, strictHosts: true });
      for (const rule of [...rules, ...popupRules]) {
        const c = rule.condition;
        const where = JSON.stringify(rule);
        // A block with no URL, host or initiator in its condition would stop the whole web.
        if (rule.action.type === 'block' || rule.action.type === 'redirect') {
          expect(
            Boolean(c.urlFilter || c.regexFilter || c.requestDomains || c.initiatorDomains),
            where,
          ).toBe(true);
        }
        if (c.urlFilter !== undefined) expect(c.urlFilter.length, where).toBeGreaterThan(0);
        if (c.regexFilter !== undefined) {
          expect(() => new RegExp(c.regexFilter as string), where).not.toThrow();
        }
        for (const list of [c.requestDomains, c.initiatorDomains, c.excludedInitiatorDomains]) {
          if (list) expect(list.length, where).toBeGreaterThan(0);
        }
      }
    });
  }

  it('never turns a host-scoped scriptlet into one for every site', () => {
    const next = random(0xb0b);
    const hosts = ['a.example', '~a.example', '/re\\.example/', 'a.*', 'x.example>>', ''];
    const scriptletLines = Array.from({ length: 2000 }, () => {
      const scope = Array.from(
        { length: 1 + Math.floor(next() * 3) },
        () => hosts[Math.floor(next() * hosts.length)],
      ).join(',');
      return `${scope}##+js(aopr, x${Math.floor(next() * 10)})`;
    });
    expect(() => compileScriptlets(scriptletLines)).not.toThrow();
    // Lines whose every named host is negated are generic on purpose; leave them out.
    const scoped = scriptletLines.filter((l) =>
      l
        .slice(0, l.indexOf('##'))
        .split(',')
        .some((h) => h && !h.startsWith('~')),
    );
    expect(scoped.length).toBeGreaterThan(1000);
    const tables = [compileScriptlets(scoped).table];
    // Only lines that name no positive host may reach an unrelated site.
    expect(callsFor(tables, 'unrelated.test')).toEqual([]);
  });
});
