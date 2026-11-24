import { describe, expect, it } from 'vitest';
import {
  MATRIX_BASE_PRIORITY,
  MATRIX_FIRST_ID,
  matrixRules,
  matrixVerdict,
  parseMatrix,
  parseMatrixLine,
  setCell,
} from '../engines/core/matrix.ts';
import { CONTROL_RULE_IDS, controlRules } from '../engines/core/control.ts';
import { DEFAULT_SETTINGS, normalizeSettings } from '../storage/settings.ts';
import { parseMessage } from '../shared/messages.ts';

describe('advanced mode matrix', () => {
  it('reads only well-formed lines; the last line for a cell wins', () => {
    expect(parseMatrixLine('* * script block')).toEqual({
      site: '*',
      target: '*',
      type: 'script',
      action: 'block',
    });
    expect(parseMatrixLine('* * script deny')).toBeNull();
    expect(parseMatrixLine('bad host * * block')).toBeNull();
    expect(parseMatrix(['a.com b.net * block', 'A.com b.net * allow'])).toEqual([
      { site: 'a.com', target: 'b.net', type: '*', action: 'allow' },
    ]);
  });

  it('lets the most specific rule win', () => {
    const rules = parseMatrix([
      '* * script block',
      'news.com * * allow',
      'news.com ads.net * block',
    ]);
    expect(matrixVerdict(rules, 'shop.com', 'cdn.net', 'script')).toBe('block');
    expect(matrixVerdict(rules, 'shop.com', 'cdn.net', 'image')).toBeNull();
    expect(matrixVerdict(rules, 'news.com', 'cdn.net', 'script')).toBe('allow');
    expect(matrixVerdict(rules, 'news.com', 'x.ads.net', 'script')).toBe('block');
  });

  it('compiles cells to prioritised third-party rules and cuts noop cells out', () => {
    const dnr = matrixRules(
      parseMatrix(['* * script block', 'news.com * script noop', '* cdn.net script noop']),
    );
    expect(dnr).toHaveLength(1);
    const [r] = dnr;
    expect(r?.id).toBe(MATRIX_FIRST_ID);
    expect(r?.priority).toBe(MATRIX_BASE_PRIORITY + 2);
    expect(r?.condition).toMatchObject({
      domainType: 'thirdParty',
      resourceTypes: ['script'],
      excludedInitiatorDomains: ['news.com'],
      excludedRequestDomains: ['cdn.net'],
    });
    const [allow, block] = matrixRules(parseMatrix(['a.com * * allow', '* t.net * block']));
    expect(allow?.action.type).toBe('allow');
    expect((allow?.priority ?? 0) > (block?.priority ?? 0)).toBe(true);
  });

  it('applies only when advanced mode is on, within the control IDs', () => {
    const s = { ...DEFAULT_SETTINGS, matrix: { on: false, rules: ['* * frame block'] } };
    expect(controlRules(s).some((r) => r.id === MATRIX_FIRST_ID)).toBe(false);
    const on = controlRules({ ...s, matrix: { on: true, rules: s.matrix.rules } });
    expect(on.some((r) => r.id === MATRIX_FIRST_ID)).toBe(true);
    expect(CONTROL_RULE_IDS).toContain(MATRIX_FIRST_ID + 499);
  });

  it('toggles one cell from the popup and validates messages and stored settings', () => {
    expect(
      setCell(['a.com b.net * block'], { site: 'a.com', target: 'b.net', type: '*' }, null),
    ).toEqual([]);
    expect(setCell([], { site: 'a.com', target: 'b.net', type: '*' }, 'allow')).toEqual([
      'a.com b.net * allow',
    ]);
    expect(parseMessage({ type: 'matrix/set', on: true, rules: ['x', '* * image block'] })).toEqual(
      {
        type: 'matrix/set',
        on: true,
        rules: ['* * image block'],
      },
    );
    expect(parseMessage({ type: 'matrix/set', on: 'yes' })).toBeNull();
    expect(
      normalizeSettings({ matrix: { on: true, rules: ['junk', '* * css block'] } }).matrix,
    ).toEqual({
      on: true,
      rules: ['* * css block'],
    });
  });
});
