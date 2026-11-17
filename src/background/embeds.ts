import { EMBED_ALLOW_PRIORITY, EMBED_HOSTS } from '../engines/core/control.ts';

/** Session rules that let click-to-load embeds through in one tab. */
async function embedRules(): Promise<chrome.declarativeNetRequest.Rule[]> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.filter((r) => r.priority === EMBED_ALLOW_PRIORITY);
}

export async function embedsLoaded(tabId: number): Promise<boolean> {
  return (await embedRules()).some((r) => r.condition.tabIds?.includes(tabId));
}

/** After a click on a placeholder: embeds load in this tab until it closes. */
export async function loadEmbeds(tabId: number): Promise<void> {
  if (await embedsLoaded(tabId)) return;
  const all = await chrome.declarativeNetRequest.getSessionRules();
  const id = all.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
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

export function installEmbedCleanup(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void embedRules()
      .then((rules) => {
        const removeRuleIds = rules
          .filter((r) => r.condition.tabIds?.includes(tabId))
          .map((r) => r.id);
        if (removeRuleIds.length > 0) {
          return chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
        }
      })
      .catch(() => undefined);
  });
}
