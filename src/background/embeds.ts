import { EMBED_ALLOW_PRIORITY, EMBED_HOSTS } from '../engines/core/control.ts';

/** Session rules that let click-to-load embeds through in one tab. */
async function embedRules(): Promise<chrome.declarativeNetRequest.Rule[]> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.filter((r) => r.priority === EMBED_ALLOW_PRIORITY);
}

export async function embedsLoaded(tabId: number): Promise<boolean> {
  return (await embedRules()).some((r) => r.condition.tabIds?.includes(tabId));
}

/**
 * After a click on the notice: embeds load in this tab until it closes. Rules of closed tabs go
 * here, not on tab close: a tab-close listener would wake the worker for every tab.
 */
export async function loadEmbeds(tabId: number): Promise<void> {
  if (await embedsLoaded(tabId)) return;
  const open = new Set((await chrome.tabs.query({})).map((t) => t.id));
  const stale = (await embedRules()).filter((r) => !r.condition.tabIds?.some((t) => open.has(t)));
  const all = await chrome.declarativeNetRequest.getSessionRules();
  const id = all.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: stale.map((r) => r.id),
    addRules: [
      {
        id,
        priority: EMBED_ALLOW_PRIORITY,
        action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
        condition: {
          tabIds: [tabId],
          requestDomains: [...EMBED_HOSTS],
          resourceTypes: ['script', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[],
        },
      },
    ],
  });
}
