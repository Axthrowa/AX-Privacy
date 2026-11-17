import AutoConsent, { type BackgroundMessage } from '@duckduckgo/autoconsent';
import { CONSENT_EVAL_EVENT, CONSENT_RESULT_EVENT, initResponse } from '../shared/consent.ts';
import { send } from '../shared/messages.ts';

declare global {
  var __axConsentRules: string | undefined;
}

// Rules come from the data file registered just before this script, and page checks go to the
// main-world helper: a page without a banner sends the worker nothing and does not wake it.
const rules = self.__axConsentRules;
delete self.__axConsentRules;
const EVAL_TIMEOUT_MS = 2_000;
const pending = new Map<string, (result: boolean) => void>();

document.addEventListener(CONSENT_RESULT_EVENT, (e) => {
  try {
    const { id, result } = JSON.parse(String((e as CustomEvent<unknown>).detail)) as {
      id?: unknown;
      result?: unknown;
    };
    pending.get(String(id))?.(result === true);
    pending.delete(String(id));
  } catch {
    // Not ours.
  }
});

function evalInPage(id: string, snippet: string): Promise<boolean> {
  return new Promise((done) => {
    pending.set(id, done);
    setTimeout(() => {
      pending.delete(id);
      done(false);
    }, EVAL_TIMEOUT_MS);
    document.dispatchEvent(
      new CustomEvent(CONSENT_EVAL_EVENT, { detail: JSON.stringify({ id, snippet }) }),
    );
  });
}

async function reply(msg: { type: string; id?: string; snippetId?: string }) {
  switch (msg.type) {
    case 'init':
      if (!rules) return null;
      return initResponse(JSON.parse(rules) as never, location.href, window === window.top);
    case 'eval':
      return {
        type: 'evalResp',
        id: msg.id,
        result: await evalInPage(String(msg.id), String(msg.snippetId)),
      };
    case 'popupFound':
    case 'optOutResult':
      // Only a page with a banner gets here; the worker records it for the tab report and stats.
      await send('consent/msg', { msg: msg as never }).catch(() => null);
      return null;
    default:
      return null;
  }
}

const consent: AutoConsent = new AutoConsent(async (msg) => {
  const r = await reply(msg);
  if (r) await consent.receiveMessageCallback(r as BackgroundMessage);
});
