import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callsFor,
  canonScriptlet,
  compileScriptlets,
  packagedTable,
  parseArgs,
  tableDelta,
} from '../engines/adblock/scriptlets.ts';
import {
  argMatcher,
  constant,
  matcher,
  pruneJson,
  requestMatcher,
  SCRIPTLETS,
  m3uPruner,
  textReplacer,
} from '../engines/adblock/scriptlet-impl.ts';

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
      'a.example##+js(trusted-rpnt, script, /x/, (function(){})())',
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

describe('property traps', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a browser getter like document.head live until it fills in', () => {
    class Doc {
      head: object | null = null;
    }
    // Like Document.prototype.head: an inherited getter that is null before parsing reaches <head>.
    class LiveDoc {
      inner = new Doc();
      get head() {
        return this.inner.head;
      }
    }
    const doc = new LiveDoc();
    vi.stubGlobal('window', { doc });
    SCRIPTLETS.aopr?.('doc.head.appendChild');
    expect(doc.head).toBeNull();
    const head = { appendChild: () => 1, title: 't' };
    doc.inner.head = head;
    expect(doc.head).toBe(head);
    expect(() => (doc.head as typeof head).appendChild).toThrow(ReferenceError);
    expect((doc.head as typeof head).title).toBe('t');
  });
});

describe('set-cookie-reload', () => {
  afterEach(() => vi.unstubAllGlobals());

  function page(initial: string[] = [], accepts = true) {
    const jar = new Map(initial.map((c) => c.split('=') as [string, string]));
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    vi.stubGlobal('document', {
      get cookie() {
        return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      },
      set cookie(text: string) {
        if (!accepts) return;
        const [pair] = text.split(';');
        const [k, v] = (pair as string).split('=');
        jar.set(k as string, v as string);
      },
    });
    return { jar, reload };
  }

  it('reloads once after setting a cookie that was missing', () => {
    const { jar, reload } = page();
    SCRIPTLETS['set-cookie-reload']?.('consent', 'true');
    expect(jar.get('consent')).toBe('true');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when the cookie is already there or refused, so it cannot loop', () => {
    const set = page(['consent=true']);
    SCRIPTLETS['set-cookie-reload']?.('consent', 'true');
    expect(set.reload).not.toHaveBeenCalled();
    const refused = page([], false);
    SCRIPTLETS['set-cookie-reload']?.('consent', 'true');
    expect(refused.reload).not.toHaveBeenCalled();
    const code = page();
    SCRIPTLETS['set-cookie-reload']?.('consent', 'alert(1)');
    expect(code.reload).not.toHaveBeenCalled();
  });
});

describe('textReplacer', () => {
  it('replaces with regex flags or every literal copy', () => {
    const m3u = '#EXTINF:5\nhttps://x/preroll/a.ts\n#EXTINF:5\nhttps://x/main/b.ts\n';
    // As lists write it: `\n` is two characters in the rule text.
    const rule = String.raw`/#EXTINF:[^\n]+\n[^\n]+?\/preroll\/[^\n]+\n/gm`;
    expect(textReplacer(rule, '')?.(m3u)).toBe('#EXTINF:5\nhttps://x/main/b.ts\n');
    expect(
      textReplacer('"ads_disabled":false', '"ads_disabled":true')?.('{"ads_disabled":false}'),
    ).toBe('{"ads_disabled":true}');
    expect(textReplacer('/a/', 'b')?.('aa')).toBe('ba');
  });
  it('refuses an empty or broken pattern', () => {
    expect(textReplacer('', 'x')).toBeNull();
    expect(textReplacer('/(/', 'x')).toBeNull();
  });
  it('accepts the trusted variants lists use', () => {
    expect(canonScriptlet('trusted-rpfr')).toBe('trusted-replace-fetch-response');
  });
});

describe('m3uPruner', () => {
  const playlist = [
    '#EXTM3U',
    '#EXTINF:5,',
    'https://redirector.googlevideo.com/videoplayback?dclk_video_ads',
    '#EXTINF:5,',
    'https://cdn.example/main/1.ts',
  ].join('\n');

  it('drops a matching segment with its #EXTINF line', () => {
    const rule = String.raw`/^https?:\/\/redirector\.googlevideo\.com.*/`;
    expect(m3uPruner(rule)?.(playlist)).toBe(
      ['#EXTM3U', '#EXTINF:5,', 'https://cdn.example/main/1.ts'].join('\n'),
    );
    expect(m3uPruner('dclk_video_ads')?.(playlist)).not.toContain('dclk');
  });

  it('never removes tags, and refuses an empty pattern', () => {
    expect(m3uPruner('EXTINF')?.(playlist)).toBe(playlist);
    expect(m3uPruner('')).toBeNull();
  });
});

describe('trusted-replace-outbound-text', () => {
  it('rewrites what the function returns when the condition matches', () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.axOutbound = { make: (s: string) => s };
    SCRIPTLETS['trusted-replace-outbound-text']?.(
      'axOutbound.make',
      '"clientScreen":"WATCH"',
      '"clientScreen":"ADUNIT"',
      'condition',
      'contentPlaybackContext',
    );
    const make = (g.axOutbound as { make: (s: string) => string }).make;
    expect(make('{"clientScreen":"WATCH","contentPlaybackContext":{}}')).toBe(
      '{"clientScreen":"ADUNIT","contentPlaybackContext":{}}',
    );
    expect(make('{"clientScreen":"WATCH"}')).toBe('{"clientScreen":"WATCH"}');
    delete g.axOutbound;
  });
});

describe('uBO-level scriptlet coverage', () => {
  it('has a page implementation for every name the compiler accepts', async () => {
    const { CANON } = await import('../engines/adblock/scriptlets.ts');
    const missing = [...new Set(Object.values(CANON))].filter((n) => !(n in SCRIPTLETS));
    expect(missing).toEqual([]);
  });

  it('reads the newer uBO names, trusted ones still behind safe replacements', () => {
    for (const n of [
      'trusted-suppress-native-method',
      'trusted-click-element',
      'trusted-create-html',
      'trusted-edit-inbound-object',
      'prevent-clipboard-write',
      'google-ima.js',
      'popads.net.js',
    ]) {
      expect(canonScriptlet(n)).not.toBeNull();
    }
    expect(canonScriptlet('trusted-rpnt')).toBe('rpnt');
    // Code as a replacement is still refused.
    expect(
      compileScriptlets(['a.com##+js(trusted-rpnt, script, x, (function(){alert(1)})())']).skipped,
    ).toBe(1);
  });

  it('matches suppress-native-method signatures by JSON value, object shape or pattern', () => {
    expect(argMatcher('"data-sdk"')('data-sdk')).toBe(true);
    expect(argMatcher('"data-sdk"')('other')).toBe(false);
    expect(argMatcher('{"className":"adsbygoogle"}')({ className: 'adsbygoogle', id: 1 })).toBe(
      true,
    );
    expect(argMatcher('{"className":"adsbygoogle"}')('adsbygoogle')).toBe(false);
    expect(
      argMatcher(String.raw`/^\[object HTMLImageElement\]$/`)('[object HTMLImageElement]'),
    ).toBe(true);
    expect(argMatcher('')(undefined)).toBe(true);
  });
});

describe('quick fixes between releases', () => {
  it('keeps only the rows an updated list added, as a table pages can read', () => {
    const packaged = compileScriptlets(['a.com##+js(aopr, x)', 'b.com##+js(set, y, true)']).table;
    const updated = compileScriptlets([
      'a.com##+js(aopr, x)',
      'a.com##+js(nostif, ad)',
      'b.com##+js(set, y, true)',
      'c.com##+js(aopr, z)',
    ]).table;
    const delta = tableDelta(updated, packaged);
    expect(callsFor([delta], 'a.com')).toEqual([['nostif', 'ad']]);
    expect(callsFor([delta], 'b.com')).toEqual([]);
    expect(callsFor([delta], 'c.com')).toEqual([['aopr', 'z']]);
    expect(tableDelta(packaged, packaged)).toBe('');
  });

  it('adds the page reader only while a delta exists', async () => {
    const { contentScripts } = await import('../engines/core/control.ts');
    const { DEFAULT_SETTINGS } = await import('../storage/settings.ts');
    const ids = (d: boolean) => contentScripts(DEFAULT_SETTINGS, [], d).map((c) => c.id);
    expect(ids(false)).not.toContain('scriptlets-delta');
    expect(ids(true)).toContain('scriptlets-delta');
  });

  it('reads the table out of a packaged data file', () => {
    const table = compileScriptlets(['a.com##+js(aopr, "q")']).table;
    const file = `(self.__nexusSl||=[]).push(${JSON.stringify(table)});`;
    expect(packagedTable(file)).toBe(table);
  });
});
