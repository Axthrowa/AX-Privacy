import { evalSnippets } from '@duckduckgo/autoconsent';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { CONSENT_CONFIG, handleConsent, isSnippetId } from '../background/consent.ts';

const RULES = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve('@duckduckgo/autoconsent/rules/compact-rules.json'),
    'utf8',
  ),
) as never;

function deps() {
  return {
    runSnippet: vi.fn(async () => true),
    record: vi.fn(async () => undefined),
    rules: vi.fn(async () => RULES),
  };
}
const SNIPPET = Object.keys(evalSnippets)[0] ?? '';
const ctx = { tabId: 4, frameId: 2, url: 'https://shop.example/' };

describe('autoconsent bridge', () => {
  it('answers init with the opt-out config and the rules for the sender frame', async () => {
    const reply = (await handleConsent(
      { type: 'init', url: 'https://ignored.example/' },
      { ...ctx, frameId: 0 },
      deps(),
    )) as {
      type: string;
      config: unknown;
      rules: { autoconsent: unknown[]; compact: { r: unknown[] } };
    };
    expect(reply.type).toBe('initResp');
    expect(reply.config).toBe(CONSENT_CONFIG);
    expect(reply.rules.autoconsent).toEqual([]);
    // Generic CMP rules (OneTrust, Cookiebot...) apply on any site.
    expect(reply.rules.compact.r.length).toBeGreaterThan(10);
  });

  it('always opts out, never in', () => {
    expect(CONSENT_CONFIG.autoAction).toBe('optOut');
  });

  it('runs only snippets bundled with the library, never page-supplied code', async () => {
    const d = deps();
    expect(isSnippetId(SNIPPET)).toBe(true);
    expect(isSnippetId('constructor')).toBe(false);
    expect(isSnippetId('toString')).toBe(false);

    await expect(
      handleConsent({ type: 'eval', id: 'e1', snippetId: 'nope' }, ctx, d),
    ).resolves.toEqual({ type: 'evalResp', id: 'e1', result: false });
    expect(d.runSnippet).not.toHaveBeenCalled();

    await expect(
      handleConsent({ type: 'eval', id: 'e2', snippetId: SNIPPET }, ctx, d),
    ).resolves.toEqual({ type: 'evalResp', id: 'e2', result: true });
    expect(d.runSnippet).toHaveBeenCalledWith(
      4,
      2,
      evalSnippets[SNIPPET as keyof typeof evalSnippets],
    );
  });

  it('reports a failed snippet as false instead of throwing', async () => {
    const d = deps();
    d.runSnippet.mockRejectedValueOnce(new Error('frame gone'));
    await expect(
      handleConsent({ type: 'eval', id: 'e', snippetId: SNIPPET }, ctx, d),
    ).resolves.toEqual({
      type: 'evalResp',
      id: 'e',
      result: false,
    });
  });

  it('records banner and opt-out results for the tab', async () => {
    const d = deps();
    await handleConsent({ type: 'popupFound', cmp: 'Onetrust' }, ctx, d);
    await handleConsent({ type: 'optOutResult', cmp: 'Onetrust', result: true }, ctx, d);
    expect(d.record.mock.calls).toEqual([
      [4, { cmp: 'Onetrust', result: null }],
      [4, { cmp: 'Onetrust', result: true }],
    ]);
  });
});
