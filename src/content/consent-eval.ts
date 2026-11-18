import { evalSnippets } from '@duckduckgo/autoconsent';
import { CONSENT_EVAL_EVENT, CONSENT_RESULT_EVENT, isSnippetId } from '../shared/consent.ts';

// MAIN world, before page scripts: answers the consent script's checks of page globals
// (window.Cookiebot and the like) here, so no check wakes the worker. Only bundled snippets run;
// a page can send fake answers, which only misleads banner handling on that page.
const dispatch = document.dispatchEvent.bind(document);
const Custom = CustomEvent;
const { parse, stringify } = JSON;

document.addEventListener(CONSENT_EVAL_EVENT, (e) => {
  let id = '';
  let result = false;
  try {
    const req = parse(String((e as CustomEvent<unknown>).detail)) as {
      id?: unknown;
      snippet?: unknown;
    };
    id = String(req.id);
    if (isSnippetId(req.snippet)) result = !!evalSnippets[req.snippet]();
  } catch {
    result = false;
  }
  dispatch(new Custom(CONSENT_RESULT_EVENT, { detail: stringify({ id, result }) }));
});
