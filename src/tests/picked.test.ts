import { describe, expect, it } from 'vitest';
import { hidingRulesFor, problemReport } from '../shared/picked.ts';

describe('rules for a site', () => {
  const rules = [
    'www.site.example##.a',
    'site.example###b',
    'other.example##.c',
    'mysite.example##.d',
    '##.generic',
    '||site.example^',
  ].join('\n');

  it('finds this site and its subdomains only', () => {
    expect(hidingRulesFor('site.example', rules)).toEqual([
      'www.site.example##.a',
      'site.example###b',
    ]);
    expect(hidingRulesFor('none.example', rules)).toEqual([]);
  });
});

describe('problem report', () => {
  it('names the site, never a page address', () => {
    const text = problemReport({
      version: '1',
      browser: 'Brave',
      site: 'site.example',
      enabled: true,
      paused: false,
      lists: ['easylist'],
      customRules: 2,
      userLists: 0,
      matched: null,
    });
    expect(text).toContain('Site: site.example');
    expect(text).toContain('Koruma: açık');
    expect(text).not.toContain('http');
  });
});
