import {
  CONTENT_SCRIPT_FILES,
  CONTROL_RULE_IDS,
  contentScripts,
  controlRules,
  isProtected,
} from '../engines/core/control.ts';
import { parseMessage, senderKind, type Reply } from '../shared/messages.ts';
import type { Settings } from '../shared/types.ts';
import { siteKey } from '../shared/url.ts';
import { exportSettings, importSettings, loadSettings, saveSettings } from '../storage/settings.ts';
import { parseStatsDump, StatsRecorder } from './stats.ts';
import { clearCosmeticCache, cosmeticDom, cosmeticStart } from './cosmetic.ts';
import { updateBuiltinLists } from './list-updates.ts';
import { assessRisk } from '../engines/security/heuristics.ts';
import {
  applyFilters,
  blockingList,
  customRulesReport,
  forgetFilterCaches,
  forgetUserList,
  listsView,
  refreshUserList,
} from './filters.ts';
import { chromeConsentDeps, handleConsent } from './consent.ts';
import { installPopupGuard, noteUserOpen } from './popup-guard.ts';
import { createRouter } from './router.ts';
import { installSecurityGuard, proceed, wasProceeded } from './security.ts';
import { sponsorSegments } from './sponsor.ts';
import { setTabReports, sessionStore, TabReports } from './tab-report.ts';

const stats = new StatsRecorder();
const reports = new TabReports(sessionStore, (host) => stats.request(host));
const consentDeps = chromeConsentDeps(async (tabId, r) => {
  await reports.consent(tabId, r);
  if (r.result === true) stats.consent();
});

const APPLY_KEY = 'applyFingerprint';

function scriptsKey(scripts: chrome.scripting.RegisteredContentScript[]): string {
  return JSON.stringify(
    scripts.map((s) => ({
      id: s.id,
      js: s.js,
      css: s.css,
      matches: s.matches,
      excludeMatches: s.excludeMatches,
      world: s.world,
    })),
  );
}

const onTabUpdated = (_tabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
  if (change.url !== undefined || change.status === 'loading') {
    void loadSettings().then((s) => setBadge(s, tab));
  }
};

/** Events that fire on every navigation are subscribed only when something will use them. */
function syncListeners(s: Settings): void {
  setTabReports(reports, s.enabled && s.privacy.detailedReports);
  const badgeNeeded = !s.enabled || s.pausedSites.length > 0;
  if (badgeNeeded && !chrome.tabs.onUpdated.hasListener(onTabUpdated)) {
    chrome.tabs.onUpdated.addListener(onTabUpdated);
  } else if (!badgeNeeded) {
    chrome.tabs.onUpdated.removeListener(onTabUpdated);
  }
}

async function apply(s: Settings): Promise<void> {
  const prev = ((await chrome.storage.session.get(APPLY_KEY))[APPLY_KEY] ?? {}) as {
    control?: string;
    scripts?: string;
  };
  const rules = controlRules(s);
  const control = JSON.stringify(rules);
  if (control !== prev.control) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: CONTROL_RULE_IDS,
      addRules: rules,
    });
  }
  const scripts = contentScripts(s);
  const key = scriptsKey(scripts);
  if (key !== prev.scripts) {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    if (registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: registered.map((r) => r.id) });
    }
    if (scripts.length > 0) await chrome.scripting.registerContentScripts(scripts);
  }
  await chrome.storage.session.set({ [APPLY_KEY]: { control, scripts: key } });
  syncListeners(s);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => setBadge(s, t)));
}

async function setBadge(s: Settings, tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const site = siteKey(tab.url);
  const off = site !== null && !isProtected(s, site);
  // The tab may close between query and update.
  // null gives the tab back to the browser's own blocked-request count.
  await chrome.action
    .setBadgeText({ tabId: tab.id, text: off ? 'OFF' : (null as unknown as string) })
    .catch(() => undefined);
}

// Startup and settings changes both rewrite the browser's rules: one at a time, so a stale
// startup pass cannot wipe rules a settings change just added.
let browserQueue: Promise<unknown> = Promise.resolve();
function inQueue(fn: () => Promise<void>): Promise<void> {
  const run = browserQueue.then(fn, fn);
  browserQueue = run.catch(() => undefined);
  return run;
}

const PICKER_KEY = 'pickerSession';
/** The user may take a while to choose; an abandoned session should not stay usable for long. */
const PICKER_MS = 10 * 60_000;

/** Pages use the new rules from their next load; open pages keep what they already have. */
const updateLists = async (): Promise<void> => {
  await updateBuiltinLists(() =>
    inQueue(async () => {
      forgetFilterCaches();
      await applyFilters(await loadSettings());
      await clearCosmeticCache();
    }),
  );
};

const PAUSE_ALARM = 'site/pauseEnd';

const route = createRouter({
  updateLists,
  schedulePauseEnd: (at) => chrome.alarms.create(PAUSE_ALARM, { when: at }),
  startPicker: async (tabId) => {
    await chrome.storage.session.set({ [PICKER_KEY]: { tabId, until: Date.now() + PICKER_MS } });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILES.picker],
    });
  },
  takePicker: async (tabId) => {
    const session = (await chrome.storage.session.get(PICKER_KEY))[PICKER_KEY] as
      { tabId: number; until: number } | undefined;
    if (session?.tabId !== tabId) return false;
    await chrome.storage.session.remove(PICKER_KEY);
    return session.until > Date.now();
  },
  load: loadSettings,
  save: saveSettings,
  apply: (s) => inQueue(() => apply(s)),
  applyFilters: (s) =>
    inQueue(async () => {
      await applyFilters(s);
      await clearCosmeticCache();
      await apply(s);
    }),
  listsView,
  refreshUserList,
  forgetUserList,
  customRulesReport,
  cosmeticStart,
  cosmeticDom,
  noteUserOpen,
  tabReport: async (tabId) => {
    // Without detailed reports nothing tracks navigations, so the tab itself says where it is.
    const current = (await chrome.tabs.get(tabId)).url;
    const { insecurePassword, ...report } = await reports.report(tabId, current);
    const url = report.url ?? current ?? null;
    const page = { ...report, url, site: report.site ?? siteKey(url ?? undefined) };
    const bypassed = await wasProceeded(page.url);
    return { ...page, risk: assessRisk(page.url, { insecurePassword, bypassed }) };
  },
  consent: (msg, ctx) => handleConsent(msg, ctx, consentDeps),
  proceed,
  pageList: async (url) => blockingList(await loadSettings(), url),
  insecurePassword: async (tabId) =>
    reports.insecurePassword(tabId, (await chrome.tabs.get(tabId)).url),
  sponsorSegments,
  statsView: (days) => stats.view(days),
  clearStats: async () => {
    await stats.reset();
    return stats.view(7);
  },
  exportSettings: async (s) => ({ ...exportSettings(s), stats: await stats.dump() }),
  importSettings,
  restoreStats: async (raw) => {
    const dump = parseStatsDump(raw);
    if (dump) await stats.restore(dump);
  },
});

installPopupGuard(loadSettings, (url) => stats.popup(url));
void loadSettings().then(syncListeners);
installSecurityGuard(loadSettings, blockingList, (url, list) => stats.page(url, list));

/** Subscribed lists are re-downloaded daily; built-in lists update with the extension. */
const LIST_REFRESH_ALARM = 'userLists/refresh';
const DAY_MINUTES = 24 * 60;
const BUILTIN_UPDATE_ALARM = 'builtinLists/update';
const BUILTIN_UPDATE_MINUTES = 12 * 60;

// Chromium may drop alarms on browser restart, so both install and startup make sure it exists.
async function ensureListAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(BUILTIN_UPDATE_ALARM))) {
    // Soon after install: a package is already behind the lists on the day it is built.
    await chrome.alarms.create(BUILTIN_UPDATE_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: BUILTIN_UPDATE_MINUTES,
    });
  }
  if (await chrome.alarms.get(LIST_REFRESH_ALARM)) return;
  await chrome.alarms.create(LIST_REFRESH_ALARM, {
    delayInMinutes: DAY_MINUTES,
    periodInMinutes: DAY_MINUTES,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PAUSE_ALARM) {
    void route({ type: 'site/expirePauses' }, { kind: 'ui', url: '' });
    return;
  }
  if (alarm.name === BUILTIN_UPDATE_ALARM) {
    void loadSettings().then((s) => (s.autoUpdateLists ? updateLists() : undefined));
    return;
  }
  if (alarm.name !== LIST_REFRESH_ALARM) return;
  void loadSettings().then(async (s) => {
    if (s.userLists.length > 0) await route({ type: 'userList/refresh' }, { kind: 'ui', url: '' });
  });
});

const VERSION_KEY = 'appliedVersion';

/** Migrates settings and rewrites everything the browser holds for us: rules and scripts. */
function setUpThisVersion(): void {
  void ensureListAlarm();
  void chrome.action.setBadgeBackgroundColor({ color: '#5f6368' });
  // Counted by the browser, so showing it costs no listener and no wake-up.
  void chrome.declarativeNetRequest.setExtensionActionOptions?.({
    displayActionCountAsBadgeText: true,
  });
  void inQueue(async () => {
    const stored = await loadSettings();
    // Known here at once, not only after the popup first opens.
    const s = 'brave' in navigator ? { ...stored, isBrave: true } : stored;
    await saveSettings(s);
    await apply(s);
    await applyFilters(s);
    await clearCosmeticCache();
    await chrome.storage.local.set({ [VERSION_KEY]: chrome.runtime.getManifest().version });
  });
}

chrome.runtime.onInstalled.addListener(setUpThisVersion);

// Files of an unpacked extension can change between browser runs, and then onInstalled never fires:
// the new code would run on the old version's rules and scripts.
void chrome.storage.local.get(VERSION_KEY).then((stored) => {
  if (stored[VERSION_KEY] !== chrome.runtime.getManifest().version) setUpThisVersion();
});

// Session storage (filter reports) is cleared on browser restart; dynamic rules persist.
chrome.runtime.onStartup.addListener(() => {
  void ensureListAlarm();
  void route({ type: 'site/expirePauses' }, { kind: 'ui', url: '' });
  void inQueue(async () => applyFilters(await loadSettings()));
});

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const kind = senderKind(sender, chrome.runtime.id, chrome.runtime.getURL(''));
  const msg = parseMessage(raw);
  if (!kind || !msg) {
    sendResponse({ ok: false, error: 'Invalid message' } satisfies Reply<never>);
    return false;
  }
  route(msg, {
    kind,
    url: sender.url ?? '',
    tabUrl: sender.tab?.url,
    tabId: sender.tab?.id,
    frameId: sender.frameId,
    documentId: sender.documentId,
  }).then(
    (data) => sendResponse({ ok: true, data } satisfies Reply<unknown>),
    (e: unknown) =>
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      } satisfies Reply<never>),
  );
  return true;
});
