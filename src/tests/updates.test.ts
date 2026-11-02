import { describe, expect, it } from 'vitest';
import { compileList, withIds } from '../engines/adblock/network.ts';
import { diffRules, fitRegexRules, listText } from '../filters/updates.ts';

const compile = (lines: string[]) => compileList(lines, { allowRegex: true }).rules;

describe('list updates', () => {
  it('finds nothing to do when the list did not change', () => {
    const rules = compile(['||a.example^$script', '/ads[0-9]/$script', '@@||b.example^']);
    expect(diffRules(withIds(rules, 1), rules)).toEqual({ add: [], disableIds: [] });
  });

  it('adds new rules and switches off the ones the list dropped', () => {
    const bundled = withIds(compile(['||old.example/x$script', '||same.example/x$script']), 1);
    const fresh = compile(['||same.example/x$script', '||new.example/x$script']);
    const { add, disableIds } = diffRules(bundled, fresh);
    expect(add.map((r) => r.condition.urlFilter)).toEqual(['||new.example/x']);
    expect(disableIds).toEqual([bundled.find((r) => r.condition.urlFilter?.includes('old'))?.id]);
  });

  it('treats a changed merged domain rule as one replaced rule', () => {
    const bundled = withIds(compile(['||a.example^', '||b.example^']), 1);
    const { add, disableIds } = diffRules(bundled, compile(['||a.example^', '||c.example^']));
    expect(add).toHaveLength(1);
    expect(add[0]?.condition.requestDomains).toEqual(['a.example', 'c.example']);
    expect(disableIds).toHaveLength(1);
  });

  it('fits an oversized regex the way the build does, so it compares equal', async () => {
    const small = (regex: string) => Promise.resolve(!/\{\d+,\d{2,}\}/.test(regex));
    const fresh = compile(['/x[a-z]{5,99}y/$script']);
    const fitted = await fitRegexRules(fresh, small);
    expect(fitted[0]?.condition.regexFilter).toBe('x[a-z]{5,}y');
    expect(diffRules(withIds(fitted, 1), await fitRegexRules(fresh, small)).add).toEqual([]);
  });

  it('drops a regex that cannot fit, and never widens a whole-page rule', async () => {
    const never = () => Promise.resolve(false);
    expect(await fitRegexRules(compile(['/x[a-z]{5,99}y/$script']), never)).toEqual([]);
    const ifShrunk = (regex: string) => Promise.resolve(regex.includes('{5,}'));
    expect(await fitRegexRules(compile(['/x[a-z]{5,99}y/$doc']), ifShrunk)).toEqual([]);
  });

  it('turns host lists into filter syntax', () => {
    const list = { format: 'hosts' } as Parameters<typeof listText>[0];
    expect(listText(list, '# c\na.example\n')).toBe('! c\n||a.example^\n');
    const all = { format: 'domains' } as Parameters<typeof listText>[0];
    expect(listText(all, 'a.example')).toBe('||a.example^$all');
  });
});
