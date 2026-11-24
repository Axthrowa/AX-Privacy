import { describe, expect, it } from 'vitest';
import { describeRule, pairMatches, type LogEntry } from '../dashboard/log-match.ts';

describe('filter log', () => {
  it('names the list, id, action and pattern of a rule', () => {
    expect(
      describeRule('easylist', 7, {
        id: 7,
        action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
        condition: { urlFilter: '||ads.example^' },
      }),
    ).toBe('easylist #7 block: ||ads.example^');
    expect(describeRule('_dynamic', 1200, undefined)).toBe('AX #1200');
  });

  it('pairs each blocked request with the closest match and leaves the rest over', () => {
    const blocked = 'net::ERR_BLOCKED_BY_CLIENT';
    const entries: LogEntry[] = [
      { time: 1000, url: 'https://a/x', type: 'script', error: blocked },
      { time: 1500, url: 'https://b/y', type: 'image', error: null },
      { time: 5000, url: 'https://c/z', type: 'xhr', error: blocked },
    ];
    const r = pairMatches(entries, [
      { time: 4990, text: 'rule-c' },
      { time: 995, text: 'rule-a' },
      { time: 1490, text: 'header-b' },
    ]);
    expect(r.entries.map((e) => e.rule)).toEqual(['rule-a', undefined, 'rule-c']);
    expect(r.unpaired).toEqual(['header-b']);
  });
});
