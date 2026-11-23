import { describe, expect, it } from 'vitest';
import { syncRulesets, type RulesetApi } from '../engines/adblock/rulesets.ts';

/** A fake browser that fits `room` rules in total; each ruleset costs `size[id]` rules. */
function fakeApi(room: number, size: Record<string, number>, on: string[] = []) {
  const enabled = new Set(on);
  const api: RulesetApi = {
    getEnabledRulesets: async () => [...enabled],
    updateEnabledRulesets: async ({ enableRulesetIds = [], disableRulesetIds = [] }) => {
      const next = new Set(enabled);
      for (const id of disableRulesetIds) next.delete(id);
      for (const id of enableRulesetIds) next.add(id);
      const cost = [...next].reduce((n, id) => n + (size[id] ?? 0), 0);
      if (cost > room) throw new Error('quota');
      enabled.clear();
      for (const id of next) enabled.add(id);
    },
  };
  return { api, enabled };
}

describe('syncRulesets', () => {
  it('enables everything in one update when it fits', async () => {
    const { api, enabled } = fakeApi(100, { a: 10, b: 10 }, ['old']);
    expect(await syncRulesets(api, ['a', 'b'])).toEqual([]);
    expect([...enabled].sort()).toEqual(['a', 'b']);
  });

  it('keeps the higher-priority lists when the pool is short', async () => {
    const { api, enabled } = fakeApi(25, { core: 20, regional: 10, extra: 5 });
    expect(await syncRulesets(api, ['core', 'regional', 'extra'])).toEqual(['regional']);
    expect([...enabled].sort()).toEqual(['core', 'extra']);
  });

  it('does nothing when the browser already matches', async () => {
    const { api } = fakeApi(0, { a: 10 }, ['a']);
    expect(await syncRulesets(api, ['a'])).toEqual([]);
  });
});
