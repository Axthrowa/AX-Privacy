import { describe, expect, it } from 'vitest';
import {
  shrinkCounts,
  toRe2,
  compileFilter,
  compileList,
  PRIORITY,
  toAsciiDomain,
  withIds,
} from '../engines/adblock/network.ts';

const opts = { allowRegex: false };
const rule = (line: string, o = opts) => {
  const out = compileFilter(line, o);
  if (out.kind !== 'rule' && out.kind !== 'popup')
    throw new Error(`${line}: ${JSON.stringify(out)}`);
  return out.rule;
};
const reason = (line: string, o = opts) => {
  const out = compileFilter(line, o);
  return out.kind === 'unsupported' ? out.reason : out.kind;
};

describe('wildcard domains', () => {
  it('expands site.* to the usual endings, on both sides of a rule', () => {
    const r = rule('||ads.example/x$script,domain=movies.*|~keep.*');
    expect(r.condition.initiatorDomains).toContain('movies.com');
    expect(r.condition.initiatorDomains).toContain('movies.xyz');
    expect(r.condition.initiatorDomains).toContain('movies.com.tr');
    expect(r.condition.excludedInitiatorDomains).toContain('keep.net');
  });

  it('still refuses wildcards it cannot expand', () => {
    expect(reason('||ads.example^$domain=*.movies.com')).toBe('domain');
    expect(reason('||ads.example^$domain=mov*.com')).toBe('domain');
  });
});

describe('toRe2', () => {
  it('drops lookaheads, keeps the rest, and refuses what RE2 cannot express', () => {
    expect(toRe2('^https:\\/\\/[a-z]+\\/')).toEqual({
      regex: '^https:\\/\\/[a-z]+\\/',
      loosened: false,
    });
    expect(toRe2('a(?=[a-z]*(x|y))[0-9]+')).toEqual({ regex: 'a[0-9]+', loosened: true });
    expect(toRe2('a(?!b)')).toBeNull();
    expect(toRe2('(?<=a)b')).toBeNull();
    expect(toRe2('(a)\\1')).toBeNull();
    expect(toRe2('ü')).toBeNull();
  });

  it('compiles a loosened regex for page resources but never for whole pages', () => {
    const opts = { allowRegex: true };
    const script = compileFilter('/a(?=b)c/$script,3p', opts);
    expect(script.kind === 'rule' && script.rule.condition.regexFilter).toBe('ac');
    expect(compileFilter('/a(?=b)c/$doc', opts)).toEqual({ kind: 'unsupported', reason: 'regex' });
    expect(compileFilter('/abc/$doc', opts).kind).toBe('rule');
    expect(compileFilter('/a(?=b)c/$popup,3p', opts).kind).toBe('popup');
  });
});

describe('shrinkCounts', () => {
  it('lowers only large counted repeats', () => {
    expect(shrinkCounts('[a-z]{7,14}x{170,}y{10,27}z{32}')).toBe('[a-z]{7,14}x{16,}y{10,}z{16,}');
    expect(shrinkCounts('a{2}b{3,}')).toBe('a{2}b{3,}');
    expect(shrinkCounts('[a-z]{7,14}x{4}', 2)).toBe('[a-z]{7,}x{4}');
    expect(shrinkCounts('[a-z]{7,14}x{32}y{3}', 3)).toBe('[a-z]{4,}x{4,}y{3}');
  });
});

describe('compileFilter', () => {
  it('compiles plain, anchored and option-bearing block filters', () => {
    expect(rule('||ads.example.com^')).toEqual({
      priority: PRIORITY.block,
      action: { type: 'block' },
      condition: { urlFilter: '||ads.example.com^' },
    });
    expect(rule('/banner/*$script,image,third-party,domain=a.com|~b.a.com')).toEqual({
      priority: PRIORITY.block,
      action: { type: 'block' },
      condition: {
        urlFilter: '/banner/',
        resourceTypes: ['script', 'image'],
        domainType: 'thirdParty',
        initiatorDomains: ['a.com'],
        excludedInitiatorDomains: ['b.a.com'],
      },
    });
    expect(rule('||x.com^$~script,method=post|~get,match-case').condition).toEqual({
      urlFilter: '||x.com^',
      excludedResourceTypes: ['script'],
      requestMethods: ['post'],
      excludedRequestMethods: ['get'],
      isUrlFilterCaseSensitive: true,
    });
  });

  it('maps exceptions, $important and $document to DNR precedence', () => {
    const allow = rule('@@||cdn.example^$script');
    const important = rule('||ads.example^$important');
    expect(allow.action.type).toBe('allow');
    expect(important.priority).toBeGreaterThan(allow.priority);
    expect(allow.priority).toBeGreaterThan(rule('||ads.example^').priority);
    expect(rule('@@||site.example^$document')).toMatchObject({
      action: { type: 'allowAllRequests' },
      condition: { resourceTypes: ['main_frame', 'sub_frame'] },
    });
  });

  it('redirects to a surrogate, and blocks when it has none, like uBO', () => {
    const surrogate = rule('||ads.example/x.js$script,redirect=noopjs');
    expect(surrogate.action).toEqual({
      type: 'redirect',
      redirect: { extensionPath: '/surrogates/noop.js' },
    });
    expect(surrogate.priority).toBeGreaterThan(rule('||ads.example/x.js$script').priority);
    expect(surrogate.priority).toBeLessThan(rule('@@||ads.example/x.js$script').priority);
    expect(rule('||x.example^$redirect=google-ima.js:100').action).toEqual({
      type: 'redirect',
      redirect: { extensionPath: '/surrogates/google-ima.js' },
    });
    expect(rule('||x.example^$redirect=toString').action.type).toBe('block');
    expect(rule('||ads.example/y.js$script,redirect=no-such-file')).toEqual({
      priority: PRIORITY.block,
      action: { type: 'block' },
      condition: { urlFilter: '||ads.example/y.js', resourceTypes: ['script'] },
    });
    expect(reason('@@||x.example^$redirect=noopjs')).toBe('redirect');
    expect(reason('||x.example^$redirect-rule=noopjs')).toBe('redirect-rule');
  });

  it('routes $popup filters to the popup guard', () => {
    expect(compileFilter('||popads.example^$popup', opts).kind).toBe('popup');
    expect(reason('||popads.example^$popup,script')).toBe('popup');
  });

  it('classifies comments and cosmetic filters', () => {
    expect(compileFilter('! comment', opts).kind).toBe('comment');
    expect(compileFilter('[Adblock Plus 2.0]', opts).kind).toBe('comment');
    expect(compileFilter('example.com##.ad', opts).kind).toBe('cosmetic');
    expect(compileFilter('example.com#@#.ad', opts).kind).toBe('cosmetic');
    expect(compileFilter('example.com#?#div:has(.ad)', opts).kind).toBe('cosmetic');
    expect(compileFilter('@@||example.com^$generichide', opts).kind).toBe('cosmetic');
  });

  it('reports what DNR cannot express instead of approximating it', () => {
    expect(reason('||x^$~all')).toBe('all');
    expect(reason('||x^$popup,document')).toBe('popup');
    expect(reason('/ads?[0-9]+/')).toBe('regex');
    expect(reason('/ads?[0-9]+/', { allowRegex: true })).toBe('rule');
    expect(reason('||x.example^$domain=*.example')).toBe('domain');
    expect(reason('||x.example^$removeparam=/^utm_/')).toBe('removeparam');
    expect(reason('||x.example^$removeparam')).toBe('removeparam');
    expect(reason('@@*$removeparam=utm')).toBe('removeparam-exception');
    expect(reason('||x.example^$csp=script-src')).toBe('csp');
    expect(reason('$script,third-party')).toBe('too-broad');
    expect(reason('||ödeme.example^')).toBe('non-ascii');
    expect(reason('a b')).toBe('syntax');
    expect(reason('||x^$script,~script')).toBe('types');
  });

  it('punycodes domains and rejects non-hostnames', () => {
    expect(toAsciiDomain('ÖRNEK.com')).toBe('xn--rnek-4qa.com');
    expect(toAsciiDomain('a.com/x')).toBeNull();
    expect(toAsciiDomain('user@a.com')).toBeNull();
  });
});

describe('compileList', () => {
  it('merges ||domain^ rules with equal options into requestDomains', () => {
    const { rules, stats } = compileList(
      ['||a.example^', '||b.example^', '||c.example^$third-party', '/ads/banner.'],
      opts,
    );
    expect(rules).toEqual([
      {
        priority: 1,
        action: { type: 'block' },
        condition: { requestDomains: ['a.example', 'b.example'] },
      },
      {
        priority: 1,
        action: { type: 'block' },
        condition: { domainType: 'thirdParty', requestDomains: ['c.example'] },
      },
      { priority: 1, action: { type: 'block' }, condition: { urlFilter: '/ads/banner.' } },
    ]);
    expect(stats).toMatchObject({ networkFilters: 4, converted: 4, dnrRules: 3 });
  });

  it('honours $badfilter and dedupes', () => {
    const { rules, stats } = compileList(
      ['/track.js', '/track.js', '||x.example^$script', '||x.example^$script,badfilter'],
      opts,
    );
    expect(rules).toEqual([
      { priority: 1, action: { type: 'block' }, condition: { urlFilter: '/track.js' } },
    ]);
    expect(stats.badfiltered).toBe(1);
  });

  it('counts cosmetic, popup and unsupported lines separately', () => {
    const { popupRules, stats } = compileList(
      ['##.ad', '||pop.example^$popup', '||x^$csp=a', '! c'],
      opts,
    );
    expect(popupRules).toHaveLength(1);
    expect(stats).toMatchObject({
      cosmetic: 1,
      popupRules: 1,
      dnrRules: 0,
      unsupported: { csp: 1 },
    });
  });

  it('blocks whole pages for $document and $all, and lists them with their exceptions', () => {
    const page = { resourceTypes: ['main_frame', 'sub_frame'] };
    expect(rule('||bad.example^$document')).toEqual({
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||bad.example^', ...page },
    });
    expect(rule('||bad.example^$all').condition.resourceTypes).toHaveLength(12);
    const { documentRules } = compileList(
      ['||a.example^$doc', '||b.example^$all', '@@||ok.a.example^$document', '||ads.example^'],
      opts,
    );
    expect(documentRules.map((r) => [r.action.type, r.condition.requestDomains])).toEqual([
      ['block', ['a.example']],
      ['block', ['b.example']],
      ['allowAllRequests', ['ok.a.example']],
    ]);
  });

  it('turns literal $removeparam into query transforms scoped by their exceptions', () => {
    const strip = (name: string) => ({
      type: 'redirect',
      redirect: { transform: { queryTransform: { removeParams: [name] } } },
    });
    const { rules, stats } = compileList(
      [
        '$removeparam=fbclid',
        '||shop.example^$removeparam=ref',
        '$removeparam=cid,domain=news.example',
        '||cdn.example/v/*$xhr,removeparam=ad.prof',
        '@@||keep.example^$removeparam=fbclid',
        '@@$removeparam,domain=all.example',
        '@@||x.example/path?ref=$removeparam=ref',
      ],
      opts,
    );
    expect(stats).toMatchObject({ networkFilters: 7, converted: 7, dnrRules: 4 });
    expect(rules).toEqual([
      {
        priority: PRIORITY.block,
        action: strip('fbclid'),
        condition: {
          urlFilter: 'fbclid=',
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'],
          excludedRequestDomains: ['all.example', 'keep.example'],
        },
      },
      {
        priority: PRIORITY.block,
        action: strip('ref'),
        condition: {
          urlFilter: '||shop.example^',
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'],
          excludedRequestDomains: ['all.example', 'x.example'],
        },
      },
      {
        // `domain=` on documents means the page itself.
        priority: PRIORITY.block,
        action: strip('cid'),
        condition: {
          urlFilter: 'cid=',
          requestDomains: ['news.example'],
          resourceTypes: ['main_frame', 'sub_frame'],
          excludedRequestDomains: ['all.example'],
        },
      },
      {
        priority: PRIORITY.block,
        action: strip('ad.prof'),
        condition: {
          urlFilter: '||cdn.example/v/',
          resourceTypes: ['xmlhttprequest'],
          excludedRequestDomains: ['all.example'],
        },
      },
    ]);
  });

  it('assigns sequential ids', () => {
    const { rules } = compileList(['/a.', '/b.'], opts);
    expect(withIds(rules, 1000).map((r) => r.id)).toEqual([1000, 1001]);
  });
});
