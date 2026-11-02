import { describe, expect, it } from 'vitest';
import { cosmeticProblem, pickedRule, safeCosmeticLines, splitRules } from '../filters/custom.ts';

describe('splitRules', () => {
  it('sorts lines into network and cosmetic, rejecting the rest with a reason', () => {
    const out = splitRules(
      [
        '! comment',
        '||ads.example^',
        '/ads?[0-9]+/$script',
        '##.banner',
        'example.com##div:has(> .sponsored)',
        '@@||example.com^$generichide',
        'example.com##+js(set-constant, x, 1)',
        'example.com##body { background: url(//t.example) }',
        '||site.example^$document',
        '$script',
        '',
      ].join('\n'),
    );
    expect(out.network).toEqual([
      '||ads.example^',
      '/ads?[0-9]+/$script',
      '||site.example^$document',
    ]);
    expect(out.cosmetic).toEqual([
      '##.banner',
      'example.com##div:has(> .sponsored)',
      '@@||example.com^$generichide',
    ]);
    expect(out.rejected.map((r) => r.line)).toEqual([
      'example.com##+js(set-constant, x, 1)',
      'example.com##body { background: url(//t.example) }',
      '$script',
    ]);
    expect(out.rejected.every((r) => r.reason.length > 0)).toBe(true);
  });
});

describe('cosmeticProblem', () => {
  it('accepts hiding and procedural rules', () => {
    expect(cosmeticProblem('##.ad')).toBeNull();
    expect(cosmeticProblem('~a.com,b.com##.ad')).toBeNull();
    expect(cosmeticProblem('a.com#@#.ad')).toBeNull();
    expect(cosmeticProblem('a.com##.x:has-text(Sponsored)')).toBeNull();
  });
  it('rejects CSS injection, scriptlets and HTML filters', () => {
    expect(cosmeticProblem('##a{}body{color:red}')).toMatch(/\{ \}/);
    expect(cosmeticProblem('a.com##+js(abort-on-property-read, x)')).toMatch(/\+js/);
    expect(cosmeticProblem('a.com##^script:has-text(ad)')).toMatch(/HTML/);
  });
});

describe('safeCosmeticLines', () => {
  it('keeps only safe cosmetic lines of a subscribed list', () => {
    expect(
      safeCosmeticLines([
        '##.ad',
        '||x^',
        'a.com##+js(x)',
        '##div{color:red}',
        '#@#.ok',
        '@@||a.com^$elemhide',
      ]),
    ).toEqual(['##.ad', '#@#.ok', '@@||a.com^$elemhide']);
  });
});

describe('pickedRule', () => {
  const url = 'https://www.site.example/page?x=1';
  it('scopes the selector to the host', () => {
    expect(pickedRule(url, '.ad-box')).toBe('www.site.example##.ad-box');
  });
  it('can never become more than one safe rule', () => {
    for (const bad of [
      '.a\n||evil.example^',
      '.a\r\n##.b',
      '.a { display: block }',
      '+js(aopr, x)',
      '^script',
      '',
      'x'.repeat(1025),
    ]) {
      expect(pickedRule(url, bad)).toBeNull();
    }
    expect(pickedRule('chrome://settings/', '.a')).toBeNull();
    expect(pickedRule(undefined, '.a')).toBeNull();
  });
});
