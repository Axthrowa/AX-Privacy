import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Chrome's limits for static rulesets (chrome.declarativeNetRequest constants).
const GUARANTEED_MINIMUM_STATIC_RULES = 30_000;
const MAX_NUMBER_OF_REGEX_RULES = 1_000;
const MAX_NUMBER_OF_ENABLED_STATIC_RULESETS = 50;

const ACTIONS = new Set([
  'block',
  'allow',
  'allowAllRequests',
  'upgradeScheme',
  'redirect',
  'modifyHeaders',
]);
const RESOURCE_TYPES = new Set([
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
]);
const CONDITION_KEYS = new Set([
  'urlFilter',
  'regexFilter',
  'isUrlFilterCaseSensitive',
  'initiatorDomains',
  'excludedInitiatorDomains',
  'requestDomains',
  'excludedRequestDomains',
  'resourceTypes',
  'excludedResourceTypes',
  'requestMethods',
  'excludedRequestMethods',
  'domainType',
  'tabIds',
  'excludedTabIds',
  'responseHeaders',
  'excludedResponseHeaders',
]);

interface Rule {
  id: number;
  priority?: number;
  action: { type: string; redirect?: unknown; requestHeaders?: unknown; responseHeaders?: unknown };
  condition: Record<string, unknown>;
}

const publicDir = resolve(import.meta.dirname, '../../public');
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.json'), 'utf8'));
const resources: { id: string; enabled: boolean; path: string }[] =
  manifest.declarative_net_request.rule_resources;
const load = (path: string): Rule[] => JSON.parse(readFileSync(resolve(publicDir, path), 'utf8'));

describe('static DNR rulesets', () => {
  it('keep the default set within the guaranteed quota', () => {
    const enabled = resources.filter((r) => r.enabled);
    expect(enabled.length).toBeLessThanOrEqual(MAX_NUMBER_OF_ENABLED_STATIC_RULESETS);
    const rules = enabled.flatMap((r) => load(r.path));
    expect(rules.length).toBeLessThanOrEqual(GUARANTEED_MINIMUM_STATIC_RULES);
    expect(rules.filter((r) => r.condition.regexFilter !== undefined).length).toBeLessThanOrEqual(
      MAX_NUMBER_OF_REGEX_RULES,
    );
  });

  for (const { id, path } of resources) {
    it(`${id}: unique ids and a valid rule shape`, () => {
      const rules = load(path);
      const ids = new Set<number>();
      for (const r of rules) {
        const where = `${id} #${r.id}`;
        expect(Number.isInteger(r.id) && r.id >= 1, where).toBe(true);
        expect(ids.has(r.id), `${where} duplicate`).toBe(false);
        ids.add(r.id);
        if (r.priority !== undefined)
          expect(Number.isInteger(r.priority) && r.priority >= 1, where).toBe(true);
        expect(ACTIONS.has(r.action.type), where).toBe(true);
        if (r.action.type === 'redirect') expect(r.action.redirect, where).toBeDefined();
        for (const key of Object.keys(r.condition))
          expect(CONDITION_KEYS.has(key), `${where} ${key}`).toBe(true);
        expect(
          r.condition.urlFilter !== undefined && r.condition.regexFilter !== undefined,
          where,
        ).toBe(false);
        for (const key of ['resourceTypes', 'excludedResourceTypes'] as const) {
          const types = r.condition[key];
          if (types === undefined) continue;
          expect(Array.isArray(types) && types.length > 0, where).toBe(true);
          for (const t of types as string[])
            expect(RESOURCE_TYPES.has(t), `${where} ${t}`).toBe(true);
        }
        for (const key of [
          'initiatorDomains',
          'requestDomains',
          'excludedInitiatorDomains',
          'excludedRequestDomains',
        ]) {
          const list = r.condition[key];
          if (list === undefined) continue;
          expect(Array.isArray(list) && list.length > 0, where).toBe(true);
          // Chrome rejects non-lowercase or non-ASCII domains in these lists.
          for (const d of list as string[])
            expect(/^[a-z0-9.*_-]+$/.test(d), `${where} ${d}`).toBe(true);
        }
        if (typeof r.condition.regexFilter === 'string') {
          expect(() => new RegExp(r.condition.regexFilter as string), where).not.toThrow();
        }
      }
    });
  }
});
