import { describe, expect, it, vi } from 'vitest';
import {
  buildDynamicRules,
  FIRST_DYNAMIC_ID,
  MAX_FILTER_RULES,
  MAX_REGEX_RULES,
  MAX_UNSAFE_RULES,
} from '../filters/dynamic.ts';

const ok = async () => true;

describe('buildDynamicRules', () => {
  it('numbers rules from the first dynamic id across sources', async () => {
    const build = await buildDynamicRules(
      [
        { name: 'custom', lines: ['/a.', '||pop.example^$popup'] },
        { name: 'https://l.example/x', lines: ['/b.', '/c.'] },
      ],
      ok,
    );
    expect(build.rules.map((r) => r.id)).toEqual([
      FIRST_DYNAMIC_ID,
      FIRST_DYNAMIC_ID + 1,
      FIRST_DYNAMIC_ID + 2,
    ]);
    expect(build.popupRules).toHaveLength(1);
    expect(build.reports.get('custom')?.stats.dnrRules).toBe(1);
    expect(build.reports.get('https://l.example/x')?.truncated).toBe(0);
  });

  it('drops regexes the browser rejects and counts them as unsupported', async () => {
    const check = vi.fn(async (re: string) => !re.includes('(?<'));
    const build = await buildDynamicRules(
      [{ name: 'custom', lines: ['/ads[0-9]+/', '/(?<=x)ad/', '/Ad/$match-case'] }],
      check,
    );
    expect(build.rules.map((r) => r.condition.regexFilter)).toEqual(['ads[0-9]+', 'Ad']);
    expect(check).toHaveBeenCalledWith('Ad', true);
    expect(build.reports.get('custom')?.stats).toMatchObject({
      converted: 2,
      dnrRules: 2,
      unsupported: { regex: 1 },
    });
  });

  it('truncates at the rule and regex quotas, earlier sources first', async () => {
    const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
    const build = await buildDynamicRules(
      [
        { name: 'custom', lines: many(MAX_REGEX_RULES + 5, (i) => `/re${i}x/`) },
        { name: 'bulk', lines: many(MAX_FILTER_RULES, (i) => `/p${i}.`) },
      ],
      ok,
    );
    expect(build.rules).toHaveLength(MAX_FILTER_RULES);
    expect(build.reports.get('custom')?.truncated).toBe(5);
    expect(build.reports.get('bulk')?.truncated).toBe(MAX_REGEX_RULES);
    expect(new Set(build.rules.map((r) => r.id)).size).toBe(MAX_FILTER_RULES);
  });

  it('caps parameter-stripping redirects at the unsafe-rule quota', async () => {
    const lines = Array.from({ length: MAX_UNSAFE_RULES + 3 }, (_, i) => `$removeparam=p${i}`);
    const build = await buildDynamicRules([{ name: 'list', lines: [...lines, '/ad.'] }], ok);
    expect(build.rules.filter((r) => r.action.type === 'redirect')).toHaveLength(MAX_UNSAFE_RULES);
    expect(build.rules.some((r) => r.condition.urlFilter === '/ad.')).toBe(true);
    expect(build.reports.get('list')?.truncated).toBe(3);
  });

  it('adds list-update rules after custom ones, inside the same quota', async () => {
    const update = {
      priority: 1,
      action: { type: 'block' as const },
      condition: { urlFilter: '||u.example^' },
    };
    const build = await buildDynamicRules(
      [{ name: 'custom', lines: ['||c.example^$script'] }],
      async () => true,
      [update],
    );
    expect(build.rules.map((r) => r.id)).toEqual([FIRST_DYNAMIC_ID, FIRST_DYNAMIC_ID + 1]);
    expect(build.rules[1]?.condition.urlFilter).toBe('||u.example^');
  });
});
