import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIREFOX_ID, toFirefoxManifest } from '../../scripts/manifest.ts';
import { BUILTIN_LISTS } from '../filters/catalog.ts';

const publicDir = resolve(import.meta.dirname, '../../public');
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'));

describe('manifest', () => {
  it('requests only the permissions the current phase uses', () => {
    expect(manifest.permissions).toEqual([
      // Read this tab's DNR match count from the popup, with no permanent listener.
      'activeTab',
      // Daily refresh of user-added filter lists.
      'alarms',
      'declarativeNetRequest',
      'storage',
      'scripting',
      'tabs',
      'webNavigation',
      // Observe-only (no blocking) for the per-page host report.
      'webRequest',
    ]);
    expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(manifest.externally_connectable).toBeUndefined();
    expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");
    expect(manifest.version).toBe(pkg.version);
  });

  it('declares one static ruleset per built-in list, matching the catalog defaults', () => {
    expect(manifest.declarative_net_request.rule_resources).toEqual(
      BUILTIN_LISTS.map((l) => ({
        id: l.id,
        enabled: l.defaultEnabled,
        path: `rulesets/${l.id}.json`,
      })),
    );
    for (const l of BUILTIN_LISTS) {
      for (const f of [
        `rulesets/${l.id}.json`,
        `rulesets/${l.id}.popup.json`,
        `rulesets/${l.id}.doc.json`,
        `engines/${l.id}.bin`,
        ...(l.scriptlets ? [`scriptlets/${l.id}.js`] : []),
      ]) {
        expect(existsSync(resolve(publicDir, f)), f).toBe(true);
      }
    }
  });

  it('keeps every list on the refusing host out of the periodic update', () => {
    for (const l of BUILTIN_LISTS) {
      expect(l.buildOnly === true, l.id).toBe(l.url.includes('filters.adtidy.org'));
    }
  });

  it('exposes only surrogates to web pages, behind a per-session URL', () => {
    expect(manifest.web_accessible_resources).toEqual([
      { resources: ['surrogates/*'], matches: ['<all_urls>'], use_dynamic_url: true },
    ]);
  });

  it('converts to a Firefox manifest with a background script and gecko id', () => {
    const ff = toFirefoxManifest(manifest) as {
      background: unknown;
      minimum_chrome_version?: string;
      permissions: string[];
      browser_specific_settings: { gecko: { id: string } };
    };
    expect(ff.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(ff.minimum_chrome_version).toBeUndefined();
    expect(ff.browser_specific_settings.gecko.id).toBe(FIREFOX_ID);
    expect(ff.permissions).toEqual(manifest.permissions);
    expect(JSON.stringify(ff)).not.toContain('use_dynamic_url');
  });
});
