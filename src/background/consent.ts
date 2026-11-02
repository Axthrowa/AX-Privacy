import { evalSnippets, filterCompactRules } from '@duckduckgo/autoconsent';
import { CONSENT_RULES_PATH } from '../engines/core/control.ts';
import type { ConsentMessage } from '../shared/messages.ts';
import type { ConsentReport } from '../shared/types.ts';

type IndexedRules = Parameters<typeof filterCompactRules>[0];
let rulesPromise: Promise<IndexedRules> | null = null;
const rules = () =>
  (rulesPromise ??= fetch(chrome.runtime.getURL(CONSENT_RULES_PATH)).then(
    (r) => r.json() as Promise<IndexedRules>,
  ));

/** Never opts in: the user turned this on to reject, and anything else needs their decision. */
export const CONSENT_CONFIG = {
  enabled: true,
  autoAction: 'optOut',
  disabledCmps: [],
  enablePrehide: true,
  enableCosmeticRules: true,
  enableGeneratedRules: true,
  enableHeuristicDetection: false,
  detectRetries: 20,
  isMainWorld: false,
  prehideTimeout: 2000,
  visualTest: false,
  logs: {
    lifecycle: false,
    rulesteps: false,
    detectionsteps: false,
    evals: false,
    errors: false,
    messages: false,
    waits: false,
  },
} as const;

export interface ConsentDeps {
  /** Runs one of autoconsent's bundled snippets in the page's main world. */
  runSnippet(tabId: number, frameId: number, snippet: () => unknown): Promise<unknown>;
  record(tabId: number, report: ConsentReport): Promise<void>;
  rules(): Promise<IndexedRules>;
}

export function isSnippetId(id: string): id is keyof typeof evalSnippets {
  return Object.hasOwn(evalSnippets, id);
}

export async function handleConsent(
  msg: ConsentMessage,
  ctx: { tabId: number; frameId: number; url: string },
  deps: ConsentDeps,
): Promise<unknown> {
  switch (msg.type) {
    case 'init':
      return {
        type: 'initResp',
        config: CONSENT_CONFIG,
        rules: {
          autoconsent: [],
          compact: filterCompactRules(await deps.rules(), {
            url: ctx.url,
            mainFrame: ctx.frameId === 0,
          }),
        },
      };
    case 'eval': {
      // The page-supplied code string is ignored; only bundled snippets run.
      if (!isSnippetId(msg.snippetId)) return { type: 'evalResp', id: msg.id, result: false };
      const result = await deps
        .runSnippet(ctx.tabId, ctx.frameId, evalSnippets[msg.snippetId])
        .catch(() => false);
      return { type: 'evalResp', id: msg.id, result: !!result };
    }
    case 'popupFound':
      await deps.record(ctx.tabId, { cmp: msg.cmp, result: null });
      return null;
    case 'optOutResult':
      await deps.record(ctx.tabId, { cmp: msg.cmp, result: msg.result });
      return null;
    case 'autoconsentDone':
      return null;
  }
}

export const chromeConsentDeps = (record: ConsentDeps['record']): ConsentDeps => ({
  async runSnippet(tabId, frameId, snippet) {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func: snippet,
    });
    return res?.result;
  },
  record,
  rules,
});
