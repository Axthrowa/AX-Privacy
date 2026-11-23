import { describe, expect, it } from 'vitest';
import { applyJsonEdit, parseJsonEdit } from '../engines/adblock/jsonpath.ts';

const edit = (query: string, data: unknown) => {
  const e = parseJsonEdit(query);
  if (!e) throw new Error(`unparsed: ${query}`);
  applyJsonEdit(data, e);
  return data;
};

describe('json-edit queries', () => {
  it('deletes a key anywhere below', () => {
    expect(edit('..directLink', { a: { directLink: 1, b: 2 }, directLink: 3 })).toEqual({
      a: { b: 2 },
    });
  });

  it('drops array items a filter selects, keeping the rest in order', () => {
    const data = { searchResults: [{ isAd: true }, { id: 1 }, { isAd: true }, { id: 2 }] };
    expect(edit('..searchResults.*[?.isAd==true]', data)).toEqual({
      searchResults: [{ id: 1 }, { id: 2 }],
    });
  });

  it('filters the root array without a leading path', () => {
    expect(edit('.*[?.adId]', [{ adId: 'x' }, { id: 1 }])).toEqual([{ id: 1 }]);
    expect(
      edit('[?.type=="ads"].visibility.status="hidden"', [
        { type: 'ads', visibility: { status: 'on' } },
      ]),
    ).toEqual([{ type: 'ads', visibility: { status: 'hidden' } }]);
  });

  it('matches string operators and nested filter paths', () => {
    const blocks = [{ x: { resource: 'nc-ad-top' } }, { x: { resource: 'news' } }];
    expect(edit('.props.blocks.*[?..resource^="nc-ad"]', { props: { blocks } })).toEqual({
      props: { blocks: [{ x: { resource: 'news' } }] },
    });
    const node = { node: { a: { __typename: 'SponsoredData' } }, keep: 1 };
    expect(edit('..node[?.*.__typename=="SponsoredData"]', node)).toEqual({ keep: 1 });
  });

  it('assigns and merges JSON values', () => {
    expect(edit('..showAds=false', { cfg: { showAds: true } })).toEqual({
      cfg: { showAds: false },
    });
    expect(edit('$+={"ads_suppressed":true}', { a: 1 })).toEqual({ a: 1, ads_suppressed: true });
    expect(edit('.ads={"preroll":false}', { ads: { preroll: true, x: 1 } })).toEqual({
      ads: { preroll: false },
    });
  });

  it('rejects what it does not understand instead of guessing', () => {
    for (const q of ['', '.a[', '[?.a=="x"', '.a+=1', '=1', '.a b']) {
      expect(parseJsonEdit(q), q).toBeNull();
    }
  });

  it('survives cyclic data', () => {
    const a: Record<string, unknown> = { ad: 1 };
    a.self = a;
    expect(() => edit('..ad', a)).not.toThrow();
    expect(a.ad).toBeUndefined();
  });
});
