/** The part of `chrome.declarativeNetRequest` that turns static rulesets on and off. */
export interface RulesetApi {
  getEnabledRulesets(): Promise<string[]>;
  updateEnabledRulesets(o: {
    enableRulesetIds?: string[];
    disableRulesetIds?: string[];
  }): Promise<void>;
}

/**
 * Turns on exactly the `wanted` rulesets, in priority order. Static rules beyond the 30,000 every
 * extension is guaranteed come from a pool all extensions share, and Chrome rejects the whole
 * update when the pool is short. So on failure the sets are enabled one by one and those that do
 * not fit are left off. Returns the wanted ids that are off.
 */
export async function syncRulesets(api: RulesetApi, wanted: readonly string[]): Promise<string[]> {
  const want = new Set(wanted);
  const current = new Set(await api.getEnabledRulesets());
  const enable = wanted.filter((id) => !current.has(id));
  const disable = [...current].filter((id) => !want.has(id));
  if (!enable.length && !disable.length) return [];
  try {
    await api.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });
    return [];
  } catch {
    if (disable.length) await api.updateEnabledRulesets({ disableRulesetIds: disable });
    const off: string[] = [];
    for (const id of enable) {
      try {
        await api.updateEnabledRulesets({ enableRulesetIds: [id] });
      } catch {
        off.push(id);
      }
    }
    return off;
  }
}
