import { L } from '../shared/i18n.ts';
import type { BrainModel } from '../engines/brain/brain.ts';
import { pickedRule } from '../filters/custom.ts';
import { moduleOn } from '../engines/core/control.ts';
import { planFor } from '../engines/video/sponsorblock.ts';
import { mergedProfile } from '../storage/settings.ts';
import { BUILTIN_IDS } from '../filters/catalog.ts';
import {
  CONTENT_TYPES,
  type ConsentMessage,
  type DomFeatures,
  type Message,
  type SenderKind,
} from '../shared/messages.ts';
import type {
  CustomRulesResult,
  ExtendedRule,
  ListsView,
  PopupState,
  Segment,
  Settings,
  SettingsExport,
  StatsView,
  TabReport,
  YoutubeWarnings,
} from '../shared/types.ts';
import { siteKey } from '../shared/url.ts';
import { isValidListUrl } from '../storage/settings.ts';

export const MAX_USER_LISTS = 20;
export const BRIEF_PAUSE_MS = 30 * 60_000;

export interface SenderContext {
  kind: SenderKind;
  /** URL of the sending frame. */
  url: string;
  /** Top-level URL of the sender's tab, if any. */
  tabUrl?: string;
  tabId?: number;
  frameId?: number;
  documentId?: string;
  /** Private window: nothing about the page may reach storage. */
  incognito?: boolean;
}

export interface RouterDeps {
  load(): Promise<Settings>;
  save(s: Settings): Promise<void>;
  /** Pushes on/off and pause state into the browser (control rules, content scripts, badges). */
  apply(s: Settings): Promise<void>;
  /** Pushes filter lists and custom rules into the browser (rulesets, dynamic rules, caches). */
  applyFilters(s: Settings): Promise<void>;
  listsView(s: Settings): Promise<ListsView>;
  refreshUserList(url: string): Promise<void>;
  forgetUserList(url: string): Promise<void>;
  customRulesReport(s: Settings): Promise<CustomRulesResult>;
  updateLists(): Promise<void>;
  /** Wakes the worker when the earliest temporary pause should end. */
  schedulePauseEnd(at: number): Promise<void>;
  startPicker(tabId: number): Promise<void>;
  /** True once per `startPicker` for that tab. */
  takePicker(tabId: number): Promise<boolean>;
  /** One AX-Brain training step from an element the user picked as an ad. */
  trainBrain(features: number[]): Promise<void>;
  brainModel(): Promise<BrainModel>;
  /** Sites where the user switched AX-Brain off for a while; null when it may run. */
  brainPausedUntil(site: string): Promise<number | null>;
  brainHidden(
    tabId: number,
    url: string,
    reasons: string[],
    features: number[] | null,
  ): Promise<void>;
  brainPause(tabId: number): Promise<void>;
  brainReset(): Promise<void>;
  cosmeticStart(s: Settings, ctx: SenderContext): Promise<ExtendedRule[]>;
  cosmeticDom(s: Settings, ctx: SenderContext, features: DomFeatures): Promise<ExtendedRule[]>;
  noteUserOpen(tabId: number, url: string): void;
  tabReport(tabId: number): Promise<TabReport>;
  consent(msg: ConsentMessage, ctx: { tabId: number }): Promise<unknown>;
  proceed(url: string): Promise<void>;
  /** List that would block this page, or null. Proceed refuses anything else. */
  pageList(url: string): Promise<string | null>;
  insecurePassword(tabId: number): Promise<void>;
  passwordElsewhere(tabId: number, host: string): Promise<void>;
  supportScam(tabId: number): Promise<void>;
  /** Whether click-to-load embeds were already let through in this tab. */
  embedsLoaded(tabId: number): Promise<boolean>;
  loadEmbeds(tabId: number): Promise<void>;
  sponsorSegments(videoId: string): Promise<Segment[]>;
  youtubeWarned(): Promise<void>;
  youtubeWarnings(): Promise<YoutubeWarnings>;
  statsView(days: number): Promise<StatsView>;
  clearStats(): Promise<StatsView>;
  exportSettings(s: Settings): SettingsExport | Promise<SettingsExport>;
  importSettings(raw: unknown, current: Settings): Settings | null;
  restoreStats(raw: unknown): Promise<void>;
}

type Effect = 'none' | 'control' | 'filters' | 'all';

export function createRouter(deps: RouterDeps) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const update = (mutate: (s: Settings) => Settings, effect: Effect) =>
    serial(async () => {
      const next = mutate(await deps.load());
      await deps.save(next);
      if (effect === 'control' || effect === 'all') await deps.apply(next);
      if (effect === 'filters' || effect === 'all') await deps.applyFilters(next);
      return next;
    });
  const view = async (s?: Settings) => deps.listsView(s ?? (await deps.load()));

  return async function route(msg: Message, ctx: SenderContext): Promise<unknown> {
    if (ctx.kind === 'content' && !CONTENT_TYPES.has(msg.type)) {
      throw new Error(`${msg.type} is not allowed from content scripts`);
    }
    switch (msg.type) {
      case 'settings/get':
        return deps.load();
      case 'popup/state': {
        const s = await deps.load();
        const site = siteKey(msg.url);
        return {
          enabled: s.enabled,
          site,
          paused: site !== null && s.pausedSites.includes(site),
          isBrave: s.isBrave,
        } satisfies PopupState;
      }
      case 'global/set':
        return update((s) => ({ ...s, enabled: msg.enabled }), 'control');
      case 'site/setPaused':
        return update(
          (s) => ({
            ...s,
            // An explicit choice replaces any temporary pause.
            pauseUntil: Object.fromEntries(
              Object.entries(s.pauseUntil).filter(([site]) => site !== msg.site),
            ),
            pausedSites: msg.paused
              ? [...new Set([...s.pausedSites, msg.site])].sort()
              : s.pausedSites.filter((x) => x !== msg.site),
          }),
          'control',
        );
      case 'site/pauseBriefly': {
        const until = Date.now() + BRIEF_PAUSE_MS;
        const next = await update(
          (s) => ({
            ...s,
            pauseUntil: { ...s.pauseUntil, [msg.site]: until },
            pausedSites: [...new Set([...s.pausedSites, msg.site])].sort(),
          }),
          'control',
        );
        await deps.schedulePauseEnd(Math.min(...Object.values(next.pauseUntil)));
        return next;
      }
      case 'site/expirePauses': {
        const now = Date.now();
        const next = await update((s) => {
          const over = new Set(
            Object.entries(s.pauseUntil)
              .filter(([, until]) => until <= now)
              .map(([site]) => site),
          );
          if (over.size === 0) return s;
          return {
            ...s,
            pauseUntil: Object.fromEntries(
              Object.entries(s.pauseUntil).filter(([site]) => !over.has(site)),
            ),
            pausedSites: s.pausedSites.filter((site) => !over.has(site)),
          };
        }, 'control');
        const left = Object.values(next.pauseUntil);
        if (left.length > 0) await deps.schedulePauseEnd(Math.min(...left));
        return next;
      }
      case 'site/setProfile':
        return update((s) => {
          const merged = mergedProfile(s.siteProfiles[msg.site], msg.profile);
          if (merged) return { ...s, siteProfiles: { ...s.siteProfiles, [msg.site]: merged } };
          return {
            ...s,
            siteProfiles: Object.fromEntries(
              Object.entries(s.siteProfiles).filter(([site]) => site !== msg.site),
            ),
          };
        }, 'control');
      case 'env/brave':
        return update((s) => ({ ...s, isBrave: msg.isBrave }), 'control');
      case 'rules/setCustom':
        return deps.customRulesReport(
          await update((s) => ({ ...s, customRules: msg.text }), 'filters'),
        );
      case 'rules/removeLine':
        return update(
          (s) => ({
            ...s,
            customRules: s.customRules
              .split(/\r?\n/)
              .filter((line) => line !== msg.line)
              .join('\n'),
          }),
          'filters',
        );
      case 'lists/setAutoUpdate':
        return view(await update((s) => ({ ...s, autoUpdateLists: msg.enabled }), 'none'));
      case 'lists/updateNow':
        await deps.updateLists();
        return view();
      case 'picker/start':
        await deps.startPicker(msg.tabId);
        return null;
      case 'picker/cancel':
        if (ctx.tabId !== undefined) await deps.takePicker(ctx.tabId);
        return null;
      case 'picker/add': {
        // The check order matters: a bad selector must leave the session open for another try.
        const rule = pickedRule(ctx.tabUrl, msg.selector);
        if (!rule) {
          throw new Error(
            L('Bu öğe için kural oluşturulamadı', 'Could not build a rule for this element'),
          );
        }
        if (ctx.frameId !== 0 || ctx.tabId === undefined || !(await deps.takePicker(ctx.tabId))) {
          throw new Error(L('Öğe seçici başlatılmamış', 'The element picker is not running'));
        }
        await update((s) => {
          const lines = s.customRules.split(/\r?\n/);
          if (lines.includes(rule)) return s;
          return { ...s, customRules: [...lines.filter(Boolean), rule].join('\n') };
        }, 'filters');
        // Private windows leave no trace, not even in the model.
        if (msg.features && !ctx.incognito) await deps.trainBrain(msg.features);
        return { rule };
      }
      case 'rules/report':
        return deps.customRulesReport(await deps.load());
      case 'lists/get':
        return view();
      case 'lists/setEnabled': {
        if (!BUILTIN_IDS.has(msg.id)) throw new Error(`Unknown list ${msg.id}`);
        const next = await update(
          (s) => ({
            ...s,
            enabledLists: msg.enabled
              ? [...new Set([...s.enabledLists, msg.id])]
              : s.enabledLists.filter((id) => id !== msg.id),
          }),
          'filters',
        );
        return view(next);
      }
      case 'userList/add': {
        if (!isValidListUrl(msg.url)) {
          throw new Error(
            L('Yalnızca https:// adresleri eklenebilir', 'Only https:// addresses can be added'),
          );
        }
        const s = await deps.load();
        if (s.userLists.some((l) => l.url === msg.url)) return view(s);
        if (s.userLists.length >= MAX_USER_LISTS) {
          throw new Error(
            L(
              `En fazla ${MAX_USER_LISTS} liste eklenebilir`,
              `At most ${MAX_USER_LISTS} lists can be added`,
            ),
          );
        }
        await deps.refreshUserList(msg.url);
        const next = await update(
          (cur) => ({ ...cur, userLists: [...cur.userLists, { url: msg.url, enabled: true }] }),
          'filters',
        );
        return view(next);
      }
      case 'userList/remove': {
        const next = await update(
          (s) => ({ ...s, userLists: s.userLists.filter((l) => l.url !== msg.url) }),
          'filters',
        );
        await deps.forgetUserList(msg.url);
        return view(next);
      }
      case 'userList/setEnabled': {
        const next = await update(
          (s) => ({
            ...s,
            userLists: s.userLists.map((l) =>
              l.url === msg.url ? { ...l, enabled: msg.enabled } : l,
            ),
          }),
          'filters',
        );
        return view(next);
      }
      case 'userList/refresh': {
        const s = await deps.load();
        for (const l of s.userLists) await deps.refreshUserList(l.url);
        return view(await update((cur) => cur, 'filters'));
      }
      case 'popup/userOpen':
        if (ctx.tabId !== undefined) deps.noteUserOpen(ctx.tabId, msg.url);
        return null;
      case 'cosmetic/start':
      case 'cosmetic/dom': {
        const s = await deps.load();
        if (!moduleOn(s, siteKey(ctx.tabUrl ?? ctx.url), 'network')) return { extended: [] };
        const extended =
          msg.type === 'cosmetic/start'
            ? await deps.cosmeticStart(s, ctx)
            : await deps.cosmeticDom(s, ctx, msg);
        return { extended };
      }
      case 'privacy/set':
        return update((s) => ({ ...s, privacy: { ...s.privacy, ...msg.privacy } }), 'control');
      case 'video/set':
        return update((s) => ({ ...s, video: { ...s.video, ...msg.video } }), 'control');
      case 'theme/set':
        return update((s) => ({ ...s, theme: msg.theme }), 'none');
      case 'stats/get':
        return deps.statsView(msg.days);
      case 'stats/clear':
        return deps.clearStats();
      case 'settings/export':
        return deps.exportSettings(await deps.load());
      case 'settings/import': {
        const current = await deps.load();
        const next = deps.importSettings(msg.data, current);
        if (!next) throw new Error(L('Geçersiz yedek dosyası', 'Invalid backup file'));
        const bag = msg.data as { stats?: unknown };
        if (bag.stats) await deps.restoreStats(bag.stats);
        await update(() => next, 'all');
        // A backup holds list addresses, not their text.
        if (next.userLists.length === 0) return next;
        for (const l of next.userLists) await deps.refreshUserList(l.url);
        return update((cur) => cur, 'filters');
      }
      case 'video/segments': {
        const s = await deps.load();
        const on = s.video.sponsorSkip && moduleOn(s, siteKey(ctx.tabUrl ?? ctx.url), 'video');
        if (!on) return { segments: [], channels: [] };
        const segments = planFor(await deps.sponsorSegments(msg.videoId), s.video.sponsorModes);
        return { segments, channels: s.video.sponsorChannels };
      }
      case 'video/warned':
        await deps.youtubeWarned();
        return null;
      case 'video/warnings':
        return deps.youtubeWarnings();
      case 'tab/report':
        return deps.tabReport(msg.tabId);
      case 'consent/msg': {
        if (ctx.tabId === undefined) return null;
        const s = await deps.load();
        if (
          !s.privacy.cookieAutoReject ||
          !moduleOn(s, siteKey(ctx.tabUrl ?? ctx.url), 'privacy')
        ) {
          return null;
        }
        return deps.consent(msg.msg, { tabId: ctx.tabId });
      }
      case 'security/proceed':
        if (!(await deps.pageList(msg.url))) {
          throw new Error(
            L('Bu adres bir güvenlik listesinde değil', 'This address is not on a security list'),
          );
        }
        await deps.proceed(msg.url);
        return null;
      case 'security/insecurePassword':
        if (ctx.tabId !== undefined && ctx.frameId === 0 && ctx.url.startsWith('http:')) {
          await deps.insecurePassword(ctx.tabId);
        }
        return null;
      case 'security/supportScam':
        if (ctx.tabId !== undefined && ctx.frameId === 0) await deps.supportScam(ctx.tabId);
        return null;
      case 'security/passwordElsewhere':
        if (ctx.tabId !== undefined && ctx.frameId === 0) {
          await deps.passwordElsewhere(ctx.tabId, msg.host);
        }
        return null;
      case 'brain/model': {
        const s = await deps.load();
        const site = siteKey(ctx.tabUrl ?? ctx.url);
        if (!moduleOn(s, site, 'network')) return null;
        if (site && (await deps.brainPausedUntil(site)) !== null) return null;
        return { model: await deps.brainModel() };
      }
      case 'brain/hidden':
        if (ctx.tabId === undefined) return null;
        // Private windows: counted for the popup, but nothing is kept to learn from.
        await deps.brainHidden(
          ctx.tabId,
          ctx.tabUrl ?? ctx.url,
          msg.reasons,
          ctx.incognito ? null : msg.features,
        );
        return null;
      case 'brain/pause':
        await deps.brainPause(msg.tabId);
        return null;
      case 'brain/reset':
        await deps.brainReset();
        return null;
      case 'shields/set':
        return update((s) => ({ ...s, shields: { ...s.shields, ...msg.shields } }), 'control');
      case 'embed/status':
      case 'embed/load': {
        const s = await deps.load();
        const on =
          ctx.tabId !== undefined &&
          s.privacy.clickToLoad &&
          moduleOn(s, siteKey(ctx.tabUrl ?? ctx.url), 'privacy');
        if (msg.type === 'embed/status') {
          return { blocked: on && !(await deps.embedsLoaded(ctx.tabId as number)) };
        }
        if (on) await deps.loadEmbeds(ctx.tabId as number);
        return null;
      }
    }
  };
}
