import { describe, expect, it } from 'vitest';
import { CHROMIUM_MV3_ENV, evalCondition, includesOf, preprocess } from '../filters/preprocess.ts';

describe('evalCondition', () => {
  it('evaluates tokens with !, &&, || and parentheses', () => {
    expect(evalCondition('env_chromium', CHROMIUM_MV3_ENV)).toBe(true);
    expect(evalCondition('env_firefox', CHROMIUM_MV3_ENV)).toBe(false);
    expect(evalCondition('!env_firefox && env_mv3', CHROMIUM_MV3_ENV)).toBe(true);
    expect(evalCondition('env_safari || (ext_ubol && !env_mobile)', CHROMIUM_MV3_ENV)).toBe(true);
    expect(evalCondition('', CHROMIUM_MV3_ENV)).toBe(false);
  });
});

describe('preprocess', () => {
  it('keeps active branches only, including nesting and else', () => {
    const text = [
      'a',
      '!#if env_firefox',
      'ff',
      '!#if env_mv3',
      'ff-mv3',
      '!#endif',
      '!#else',
      'not-ff',
      '!#endif',
      '  b  ',
      '',
    ].join('\n');
    expect(preprocess(text)).toEqual(['a', 'not-ff', 'b']);
  });

  it('inlines includes up to a fixed depth', () => {
    const includes = new Map([
      ['one.txt', 'x\n!#include two.txt'],
      ['two.txt', 'y\n!#include one.txt'],
    ]);
    const out = preprocess('!#include one.txt\nz', CHROMIUM_MV3_ENV, includes);
    expect(out[0]).toBe('x');
    expect(out.at(-1)).toBe('z');
    expect(out.length).toBeLessThan(12);
    expect(preprocess('!#include missing.txt')).toEqual([]);
  });

  it('lists include names', () => {
    expect(includesOf('!#include a.txt\n! x\n  !#include  b/c.txt')).toEqual(['a.txt', 'b/c.txt']);
  });
});
