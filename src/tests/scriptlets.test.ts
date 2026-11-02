import { describe, expect, it } from 'vitest';
import {
  callsFor,
  canonScriptlet,
  compileScriptlets,
  parseArgs,
} from '../engines/adblock/scriptlets.ts';
import { constant, matcher, pruneJson, requestMatcher } from '../engines/adblock/scriptlet-impl.ts';

const tableOf = (...lines: string[]) => compileScriptlets(lines).table;

describe('scriptlet compiler', () => {
  it('maps the aliases lists use onto one implementation', () => {
    expect(canonScriptlet('abort-on-property-read.js')).toBe('aopr');
    expect(canonScriptlet('no-setTimeout-if')).toBe('nostif');
    expect(canonScriptlet('toString')).toBeNull();
    expect(canonScriptlet('constructor')).toBeNull();
  });

  it('splits arguments like uBO, including quotes and escaped commas', () => {
    expect(parseArgs('nostif, adblock, 1000')).toEqual(['nostif', 'adblock', '1000']);
    expect(parseArgs(`set, 'a,b', c`)).toEqual(['set', 'a,b', 'c']);
    expect(parseArgs('rpnt, script, a\\,b, c')).toEqual(['rpnt', 'script', 'a,b', 'c']);
    expect(parseArgs('set, x,')).toEqual(['set', 'x', '']);
  });

  it('finds rules for the host, its parents and wildcard TLDs', () => {
    const t = tableOf(
      'site.example##+js(aopr, a)',
      'google.*##+js(set, b, true)',
      'other.example##+js(aopr, c)',
      '##+js(set, everywhere, true)',
    );
    expect(callsFor([t], 'www.site.example')).toEqual([
      ['set', 'everywhere', 'true'],
      ['aopr', 'a'],
    ]);
    expect(callsFor([t], 'www.google.com.tr')).toContainEqual(['set', 'b', 'true']);
    expect(callsFor([t], 'nosite.example')).toEqual([['set', 'everywhere', 'true']]);
  });

  it('does not treat a longer host as a match of a shorter name', () => {
    expect(callsFor([tableOf('site.example##+js(aopr, a)')], 'mysite.example')).toEqual([]);
  });

  it('shares one call between hosts', () => {
    const t = tableOf('a.example,b.example##+js(aopr, a)');
    expect(t.match(/aopr/g)).toHaveLength(1);
    expect(callsFor([t], 'b.example')).toEqual([['aopr', 'a']]);
  });

  it('applies exceptions across lists and negated hosts', () => {
    const rule = tableOf(
      'site.example,~shop.site.example##+js(aopr, a)',
      'x.example##+js(aopr, b)',
    );
    expect(callsFor([rule], 'site.example')).toEqual([['aopr', 'a']]);
    expect(callsFor([rule], 'shop.site.example')).toEqual([]);
    const unbreak = tableOf('x.example#@#+js(aopr, b)');
    expect(callsFor([rule, unbreak], 'x.example')).toEqual([]);
    const allOff = tableOf('site.example#@#+js()');
    expect(callsFor([rule, allOff], 'site.example')).toEqual([]);
  });

  it('never turns a regex-scoped rule into a rule for every site', () => {
    const out = compileScriptlets(['/^a.+\\.example$/##+js(nowoif)']);
    expect(out.skipped).toBe(1);
    expect(callsFor([out.table], 'other.example')).toEqual([]);
    const mixed = tableOf('/re/,site.example##+js(aopr, a)');
    expect(callsFor([mixed], 'other.example')).toEqual([]);
    expect(callsFor([mixed], 'site.example')).toEqual([['aopr', 'a']]);
  });

  it('never lets a rule write code into a page script', () => {
    const plain = compileScriptlets(['a.example##+js(rpnt, script, isAd=true, isAd=false)']);
    expect(plain.rules).toBe(1);
    for (const line of [
      'a.example##+js(rpnt, script, /x/, (()=>{alert(1)})();$1)',
      'a.example##+js(rpnt, script, /x/, y, condition, /z/)',
      'a.example##+js(trusted-rpnt, script, /x/, y)',
    ]) {
      const out = compileScriptlets([line]);
      expect(out.rules).toBe(0);
      expect(out.skipped).toBe(1);
    }
  });

  it('counts what it cannot run instead of guessing', () => {
    const out = compileScriptlets(['a.example##+js(unknown-thing, x)', 'a.example##+js(aopr, y)']);
    expect(out.rules).toBe(1);
    expect(out.skipped).toBe(1);
  });
});

describe('scriptlet helpers', () => {
  it('matches literals, regexes and negation', () => {
    expect(matcher('ads')('/ads/x')).toBe(true);
    expect(matcher('/^a.c$/')('abc')).toBe(true);
    expect(matcher('!ads')('/ads/x')).toBe(false);
    expect(matcher('')('anything')).toBe(true);
    expect(matcher('/(/')('x')).toBe(false);
  });

  it('matches request properties', () => {
    const hit = requestMatcher('url:/ads/ method:POST');
    expect(hit({ url: 'https://a/ads/', method: 'POST' })).toBe(true);
    expect(hit({ url: 'https://a/ads/', method: 'GET' })).toBe(false);
    expect(requestMatcher('ads')({ url: 'x/ads' })).toBe(true);
  });

  it('accepts only known constants, never code', () => {
    expect(constant('true')).toEqual({ ok: true, value: true });
    expect(constant('42').value).toBe(42);
    expect(constant('alert(1)').ok).toBe(false);
    expect(constant('toString').ok).toBe(false);
  });

  it('prunes JSON paths, honoring required keys', () => {
    const v = { ads: [{ x: 1, keep: 2 }], y: 1 };
    pruneJson(v, ['ads.[].x']);
    expect(v).toEqual({ ads: [{ keep: 2 }], y: 1 });
    const w = { a: 1 };
    pruneJson(w, ['a'], ['missing']);
    expect(w).toEqual({ a: 1 });
  });
});
