import { evalSnippets, filterCompactRules } from '@duckduckgo/autoconsent';

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

/** Page events between the consent script and its main-world helper. Strings only cross worlds. */
export const CONSENT_EVAL_EVENT = 'ax-consent-eval';
export const CONSENT_RESULT_EVENT = 'ax-consent-result';

type IndexedRules = Parameters<typeof filterCompactRules>[0];

/** autoconsent's `initResp`: the opt-out config and the rules that apply to this frame. */
export function initResponse(rules: IndexedRules, url: string, mainFrame: boolean) {
  return {
    type: 'initResp' as const,
    config: CONSENT_CONFIG,
    rules: { autoconsent: [], compact: filterCompactRules(rules, { url, mainFrame }) },
  };
}

export function isSnippetId(id: unknown): id is keyof typeof evalSnippets {
  return typeof id === 'string' && Object.hasOwn(evalSnippets, id);
}
