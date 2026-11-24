import { describe, expect, it } from 'vitest';
import { checkLine, lineTokens, matchesAddress, ruleScope } from '../filters/rule-editor.ts';

describe('rule editor', () => {
  it('flags bad lines while typing, with the save-time reason', () => {
    expect(checkLine('! note').kind).toBe('comment');
    expect(checkLine('||ads.example^').kind).toBe('network');
    expect(checkLine('example.com##.ad').kind).toBe('cosmetic');
    const bad = checkLine('example.com##.ad { color: red }');
    expect(bad.kind).toBe('error');
    expect(checkLine('*$script').kind).toBe('error');
  });

  it('colours the parts of a line', () => {
    expect(lineTokens('@@||cdn.example^$script')).toEqual([
      { text: '@@', cls: 'exception' },
      { text: '||cdn.example^', cls: 'pattern' },
      { text: '$script', cls: 'option' },
    ]);
    expect(lineTokens('a.com,~b.a.com##.ad').map((t) => t.cls)).toEqual([
      'domain',
      'separator',
      'selector',
    ]);
    expect(lineTokens('/ad[0-9]+$/$image').map((t) => t.text)).toEqual(['/ad[0-9]+$/', '$image']);
    expect(lineTokens('! hi')[0]?.cls).toBe('comment');
  });

  it('says where a rule applies and previews an address', () => {
    expect(ruleScope('||ads.example^$script,domain=news.com')).toContain('news.com');
    expect(ruleScope('##.ad')).toMatch(/tüm siteler|all sites/);
    expect(matchesAddress('||ads.example^', 'https://cdn.ads.example/x.js')).toBe(true);
    expect(matchesAddress('||ads.example^', 'https://example.com/')).toBe(false);
    expect(matchesAddress('/ad[0-9]+/', 'https://x.com/ad12.gif')).toBe(true);
    expect(matchesAddress('news.com,~m.news.com##.ad', 'https://www.news.com/a')).toBe(true);
    expect(matchesAddress('news.com,~m.news.com##.ad', 'https://m.news.com/a')).toBe(false);
    expect(matchesAddress('##.ad', 'not a url')).toBe(false);
  });
});
