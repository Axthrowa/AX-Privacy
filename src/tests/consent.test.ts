import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { handleConsent } from '../background/consent.ts';
import { CONSENT_CONFIG, initResponse, isSnippetId } from '../shared/consent.ts';

const RULES = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve('@duckduckgo/autoconsent/rules/compact-rules.json'),
    'utf8',
  ),
) as never;

describe('autoconsent', () => {
  it('answers init with the opt-out config and the rules for the frame', () => {
    const reply = initResponse(RULES, 'https://shop.example/', true);
    expect(reply.type).toBe('initResp');
    expect(reply.config).toBe(CONSENT_CONFIG);
    expect(reply.rules.autoconsent).toEqual([]);
    // Generic CMP rules (OneTrust, Cookiebot...) apply on any site.
    expect((reply.rules.compact as { r: unknown[] }).r.length).toBeGreaterThan(10);
  });

  it('always opts out, never in', () => {
    expect(CONSENT_CONFIG.autoAction).toBe('optOut');
  });

  it('runs only snippets bundled with the library, never page-supplied names', () => {
    expect(isSnippetId('EVAL_COOKIEBOT_1')).toBe(true);
    for (const bad of ['constructor', 'toString', '__proto__', 'nope', 5, null]) {
      expect(isSnippetId(bad)).toBe(false);
    }
  });

  it('records banner and opt-out results for the tab', async () => {
    const record = vi.fn(async () => undefined);
    await handleConsent({ type: 'popupFound', cmp: 'Onetrust' }, { tabId: 4 }, record);
    await handleConsent(
      { type: 'optOutResult', cmp: 'Onetrust', result: true },
      { tabId: 4 },
      record,
    );
    expect(record.mock.calls).toEqual([
      [4, { cmp: 'Onetrust', result: null }],
      [4, { cmp: 'Onetrust', result: true }],
    ]);
  });
});
