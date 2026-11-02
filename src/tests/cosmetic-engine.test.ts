import { FiltersEngine } from '@ghostery/adblocker';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COSMETIC_ENGINE_CONFIG } from '../engines/adblock/engine-config.ts';

const page = (hostname: string, domain = hostname) => ({
  url: `https://${hostname}/`,
  hostname,
  domain,
});
const parse = (text: string) => FiltersEngine.parse(text, COSMETIC_ENGINE_CONFIG);

describe('cosmetic engine pipeline', () => {
  it('serves hostname rules, DOM-matched generic rules and exceptions', () => {
    const engine = parse(
      ['news.example##.promo', '##.ad-slot', 'news.example#@#.ad-slot', '##div[data-ad]'].join(
        '\n',
      ),
    );
    const start = engine.getCosmeticsFilters({
      ...page('news.example'),
      getBaseRules: true,
      getRulesFromDOM: false,
      getRulesFromHostname: true,
      getInjectionRules: false,
    });
    expect(start.styles).toContain('.promo');
    expect(start.styles).toContain('div[data-ad]');

    const dom = (hostname: string) =>
      engine.getCosmeticsFilters({
        ...page(hostname),
        classes: ['ad-slot'],
        getBaseRules: false,
        getRulesFromDOM: true,
        getRulesFromHostname: false,
        getInjectionRules: false,
      }).styles;
    expect(dom('other.example')).toContain('.ad-slot');
    expect(dom('news.example')).not.toContain('.ad-slot');
  });

  it('returns procedural selectors as extended rules', () => {
    const engine = parse('shop.example##.card:has-text(Sponsorlu)');
    const { extended } = engine.getCosmeticsFilters({
      ...page('shop.example'),
      getBaseRules: false,
      getRulesFromDOM: false,
      getRulesFromHostname: true,
      getExtendedRules: true,
      getInjectionRules: false,
    });
    expect(extended).toHaveLength(1);
    expect(extended[0]?.attribute).toBeTruthy();
  });

  it('honours $elemhide and $generichide exceptions', () => {
    const engine = parse(
      [
        '##.ad-slot',
        'g.example##.promo',
        '@@||safe.example^$elemhide',
        '@@||g.example^$generichide',
      ].join('\n'),
    );
    const css = (h: string) =>
      engine.getCosmeticsFilters({ ...page(h), classes: ['ad-slot'] }).styles;
    expect(css('safe.example')).not.toContain('.ad-slot');
    expect(css('g.example')).not.toContain('.ad-slot');
    expect(css('g.example')).toContain('.promo');
    expect(css('other.example')).toContain('.ad-slot');
  });

  it('merges serialized engines without losing rules', () => {
    const a = FiltersEngine.deserialize(parse('a.example##.x').serialize());
    const b = FiltersEngine.deserialize(parse('b.example##.y').serialize());
    const merged = FiltersEngine.merge([a, b]);
    const css = (h: string) =>
      merged.getCosmeticsFilters({ ...page(h), getBaseRules: false, getRulesFromDOM: false })
        .styles;
    expect(css('a.example')).toContain('.x');
    expect(css('b.example')).toContain('.y');
  });

  it('loads the shipped EasyList engine and matches a generic AdSense wrapper', () => {
    const bin = readFileSync(resolve(import.meta.dirname, '../../public/engines/easylist.bin'));
    const engine = FiltersEngine.deserialize(new Uint8Array(bin));
    const { styles } = engine.getCosmeticsFilters({
      ...page('news.example'),
      classes: ['adsbygoogle-box'],
      getBaseRules: false,
      getRulesFromHostname: false,
    });
    expect(styles).toContain('.adsbygoogle-box');
  });
});
