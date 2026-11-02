import { FiltersEngine } from '@ghostery/adblocker';
import { describe, expect, it } from 'vitest';
import { COSMETIC_ENGINE_CONFIG } from '../engines/adblock/engine-config.ts';
import {
  COMMON_HASHES,
  decodeTokens,
  encodeTokens,
  knownFeatures,
} from '../engines/adblock/generic-tokens.ts';

const LIST = ['##.ad-banner', '###promo-box', '##a[href^="https://track.doubleclick.net/"]'].join(
  '\n',
);
const engine = FiltersEngine.parse(LIST, COSMETIC_ENGINE_CONFIG);
const table = decodeTokens(
  encodeTokens(
    engine
      .getFilters()
      .cosmeticFilters.flatMap((f) => (f.getTokens() as Uint32Array[]).flatMap((t) => [...t]))
      .filter((h) => !COMMON_HASHES.has(h)),
  ),
);
const css = (classes: string[], ids: string[], hrefs: string[]) =>
  engine.getCosmeticsFilters({
    url: 'https://a.example/',
    hostname: 'a.example',
    domain: 'a.example',
    classes,
    ids,
    hrefs,
    getBaseRules: false,
    getInjectionRules: false,
    getExtendedRules: false,
    getRulesFromHostname: false,
    getRulesFromDOM: true,
  }).styles;

describe('generic rule token table', () => {
  it('keeps exactly the features the engine would hide something for', () => {
    const kept = knownFeatures(
      {
        classes: ['ad-banner', 'article'],
        ids: ['promo-box', 'main'],
        hrefs: ['https://track.doubleclick.net/x', 'https://news.example.com/story'],
      },
      [table],
    );
    expect(kept).toEqual({
      classes: ['ad-banner'],
      ids: ['promo-box'],
      hrefs: ['https://track.doubleclick.net/x'],
    });
    expect(css(kept.classes, kept.ids, kept.hrefs)).toBe(
      css(
        ['ad-banner', 'article'],
        ['promo-box', 'main'],
        ['https://track.doubleclick.net/x', 'https://news.example.com/story'],
      ),
    );
  });

  it('asks nothing for an ordinary page', () => {
    expect(
      knownFeatures(
        { classes: ['nav'], ids: ['main'], hrefs: ['https://www.example.com/index.html'] },
        [table],
      ),
    ).toEqual({ classes: [], ids: [], hrefs: [] });
  });
});
