import { useEffect, useState } from 'react';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import { currentProfile } from '../shared/privacy-profiles.ts';
import { DEFAULT_SITE_PROFILE } from '../storage/settings.ts';
import type { RiskLevel } from '../engines/security/heuristics.ts';
import { hidingRulesFor, problemReport } from '../shared/picked.ts';
import type { PopupState, Settings, TabReport } from '../shared/types.ts';
import { detectBrave } from './brave.ts';
import { Fix } from './Fix.tsx';
import { mount } from './mount.tsx';
import { Toggle } from './Toggle.tsx';

const RISK_LABEL: Record<Exclude<RiskLevel, 'none'>, string> = {
  high: L('Yüksek risk', 'High risk'),
  medium: L('Dikkat', 'Caution'),
  low: L('Düşük risk işareti', 'Low-risk sign'),
};

function Security({ risk }: { risk: TabReport['risk'] }) {
  if (risk.level === 'none') {
    return (
      <p className="note">
        {L(
          'Güvenlik: bilinen bir risk bulunamadı. Bu, sitenin güvenli olduğu anlamına gelmez.',
          'Security: no known risk found. That does not mean the site is safe.',
        )}
      </p>
    );
  }
  return (
    <div className={`risk ${risk.level}`} role="status">
      <strong>{RISK_LABEL[risk.level]}</strong>
      <ul>
        {risk.findings.map((f) => (
          <li key={f.id}>{f.text}</li>
        ))}
      </ul>
      <p>
        {L(
          'Bu uyarılar adres ve sayfa üzerinden yapılan yerel kontrollere dayanır; kesin değildir.',
          'These warnings come from local checks of the address and the page; they are not certain.',
        )}
      </p>
    </div>
  );
}

const BRAIN_REASON: Record<string, string> = {
  'fixed-or-sticky': L('sabit konum', 'fixed position'),
  'high-z-index': L('üstte duran katman', 'top layer'),
  'max-z-index': L('en üst katman', 'topmost layer'),
  'cross-site-or-ad-target': L('başka siteye/reklama bağlantı', 'link to another site or ad'),
  'iab-dimension': L('standart reklam boyutu', 'standard ad size'),
  'external-image': L('hareketli görsel', 'animated image'),
  'pageskin-geometry': L('kenar reklamı', 'side skin ad'),
  'fake-progress-or-bait': L('sahte yükleme/doğrulama metni', 'fake loading/verify text'),
  'corner-push-card': L('köşe bildirim kartı', 'corner push card'),
  'invisible-click-curtain': L('görünmez tıklama perdesi', 'invisible click curtain'),
  'ad-identifier': L('reklam sınıf adı', 'ad class name'),
  'ax-brain-model': L('öğrenilmiş model', 'learned model'),
};

function Brain({
  brain,
  onPause,
}: {
  brain: NonNullable<TabReport['brain']>;
  onPause: () => void;
}) {
  if (brain.pausedUntil !== null) {
    return (
      <p className="note">
        {L(
          `AX-Brain bu sitede ${new Date(brain.pausedUntil).toLocaleDateString()} tarihine kadar kapalı.`,
          `AX-Brain is off on this site until ${new Date(brain.pausedUntil).toLocaleDateString()}.`,
        )}
      </p>
    );
  }
  const reasons = Object.entries(brain.reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${BRAIN_REASON[r] ?? r} (${n})`)
    .join(', ');
  return (
    <details>
      <summary>
        {L(
          `AX-Brain bu sayfada ${brain.count} öğe gizledi`,
          `AX-Brain hid ${brain.count} elements on this page`,
        )}
      </summary>
      <p className="note">
        {L('Nedenler', 'Reasons')}: {reasons}
      </p>
      <button type="button" className="secondary" onClick={onPause}>
        {L(
          'Yanlış gizledi: bu sitede 7 gün kapat ve yenile',
          'Wrongly hidden: turn off here for 7 days and reload',
        )}
      </button>
    </details>
  );
}

function Report({ report, matched }: { report: TabReport; matched: number | null }) {
  const third = report.hosts.filter((h) => h.thirdParty);
  const blocked = report.hosts.filter((h) => h.blocked > 0).length;
  const { consent } = report;
  return (
    <>
      {report.url && <Security risk={report.risk} />}
      {report.hosts.length > 0 ? (
        <p className="note">
          {L(
            `Bu sayfa ${third.length} üçüncü taraf alan adına bağlandı; ${blocked} alan adına giden isteklerin en az biri engellendi (bu eklenti, başka bir eklenti veya Brave Shields).`,
            `This page connected to ${third.length} third-party domains; at least one request to ${blocked} of them was blocked (by this extension, another one or Brave Shields).`,
          )}
        </p>
      ) : (
        matched !== null && (
          <p className="note">
            {L(
              `AX kuralları bu sayfada ${matched} kez devreye girdi.`,
              `AX rules acted ${matched} times on this page.`,
            )}
          </p>
        )
      )}
      {report.hosts.length > 0 && (
        <details>
          <summary>{L('Alan adları', 'Domains')}</summary>
          <ul className="hosts">
            {report.hosts.map((h) => (
              <li key={h.host}>
                <span>
                  {h.host}
                  {!h.thirdParty && L(' (birinci taraf)', ' (first party)')}
                </span>
                <span className={h.blocked ? 'blocked' : undefined}>
                  {h.blocked ? L(`${h.blocked} engellendi`, `${h.blocked} blocked`) : ''}
                  {h.blocked && h.loaded ? ' · ' : ''}
                  {h.loaded ? L(`${h.loaded} yüklendi`, `${h.loaded} loaded`) : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {consent && (
        <p className="note">
          {L('Çerez bildirimi', 'Cookie notice')} ({consent.cmp}):{' '}
          {consent.result === null
            ? L('işleniyor', 'in progress')
            : consent.result
              ? L('reddedildi', 'rejected')
              : L('reddedilemedi, kendiniz seçin', 'could not be rejected, please choose yourself')}
        </p>
      )}
    </>
  );
}

function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [state, setState] = useState<PopupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<TabReport | null>(null);
  const [matched, setMatched] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [copied, setCopied] = useState(false);
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    void (async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const s = await send('popup/state', { url: active?.url ?? '' });
      setTab(active ?? null);
      setSettings(await send('settings/get', {}));
      setState({ ...s, isBrave: await detectBrave(s.isBrave) });
      if (active?.id !== undefined) {
        setReport(await send('tab/report', { tabId: active.id }));
        // Needs no listener: the browser kept count. Quota-limited, so a refusal just hides the line.
        await chrome.declarativeNetRequest
          .getMatchedRules({ tabId: active.id })
          // Header and other control rules touch requests without blocking them.
          .then((r) =>
            setMatched(
              r.rulesMatchedInfo.filter(
                ({ rule }) => rule.rulesetId !== '_dynamic' || rule.ruleId >= 1000,
              ).length,
            ),
          )
          .catch(() => undefined);
      }
    })().catch((e: unknown) => setError(String(e)));
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setState(await send('popup/state', { url: tab?.url ?? '' }));
      setSettings(await send('settings/get', {}));
      if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
    } catch (e) {
      setError(String(e));
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!state) return null;
  const { site } = state;
  const chosen = settings && currentProfile(settings.privacy);
  const profileName =
    chosen === 'strict'
      ? L('Sıkı', 'Strict')
      : chosen === 'balanced'
        ? L('Dengeli', 'Balanced')
        : L('Özel', 'Custom');
  const copyReport = async (fixedBy?: string) => {
    if (!settings) return;
    await navigator.clipboard.writeText(
      problemReport({
        version: chrome.runtime.getManifest().version,
        browser: state.isBrave ? 'Brave' : navigator.userAgent,
        site,
        enabled: state.enabled,
        paused: state.paused,
        lists: settings.enabledLists,
        customRules: settings.customRules.split(/\r?\n/).filter(Boolean).length,
        userLists: settings.userLists.length,
        matched,
        privacyProfile: profileName,
        ...(fixedBy !== undefined && { fixedBy }),
      }),
    );
    setCopied(true);
  };
  // Requests to the site's own servers being blocked is the usual cause of a broken page.
  const ownBlocked = report?.hosts.some((h) => !h.thirdParty && h.blocked > 0) ?? false;
  const canFix = state.enabled && site !== null;

  return (
    <main>
      <header>
        <img src="icons/icon-32.png" alt="" width={24} height={24} />
        <h1>AX Privacy</h1>
      </header>
      <p className="site">
        {site ?? L('Bu sayfada koruma uygulanamaz', 'Protection cannot run on this page')}
      </p>
      <Toggle
        label={L('Bu sitede koruma', 'Protection on this site')}
        checked={state.enabled && !state.paused}
        disabled={!state.enabled || site === null}
        onChange={(on) => site && run(() => send('site/setPaused', { site, paused: !on }))}
      />
      <Toggle
        label={L('Tüm koruma', 'All protection')}
        checked={state.enabled}
        onChange={(on) => run(() => send('global/set', { enabled: on }))}
      />
      {canFix && settings && fixing && (
        <Fix
          site={site}
          original={{ ...DEFAULT_SITE_PROFILE, ...settings.siteProfiles[site] }}
          run={run}
          onReport={(fixedBy) =>
            void copyReport(fixedBy)
              .then(() =>
                chrome.tabs.create({ url: 'https://github.com/Axthrowa/AX-Privacy/issues/new' }),
              )
              .catch((e: unknown) => setError(String(e)))
          }
          onClose={() => setFixing(false)}
        />
      )}
      {canFix && !fixing && !state.paused && ownBlocked && (
        <p className="note">
          {L(
            'Bu sitenin kendi sunucusuna giden bazı istekler engellendi. Sayfada bir şey çalışmıyorsa sorun gidermeyi deneyin.',
            'Some requests to this site’s own servers were blocked. If something on the page does not work, try fixing it.',
          )}
        </p>
      )}
      {canFix && !fixing && !state.paused && (
        <button type="button" className="secondary" onClick={() => setFixing(true)}>
          {L('Bu sitede sorun var', 'Something is broken here')}
        </button>
      )}
      {canFix && !fixing && !state.paused && (
        <button
          type="button"
          className="link"
          onClick={() => void run(() => send('site/pauseBriefly', { site }))}
        >
          {L('30 dakika duraklat', 'Pause for 30 minutes')}
        </button>
      )}
      {state.enabled && !state.paused && site !== null && tab?.id !== undefined && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            void send('picker/start', { tabId: tab.id as number })
              .then(() => window.close())
              .catch((e: unknown) => setError(String(e)));
          }}
        >
          {L('Sayfada bir öğeyi gizle', 'Hide an element on the page')}
        </button>
      )}
      {settings && site !== null && hidingRulesFor(site, settings.customRules).length > 0 && (
        <details>
          <summary>{L('Bu sitede gizlediklerim', 'What I hid on this site')}</summary>
          <ul className="hosts">
            {hidingRulesFor(site, settings.customRules).map((line) => (
              <li key={line}>
                <span>{line.slice(line.indexOf('##') + 2)}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    void run(async () => {
                      setSettings(await send('rules/removeLine', { line }));
                    })
                  }
                >
                  {L('Geri al', 'Undo')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {report?.brain && tab?.id !== undefined && (
        <Brain
          brain={report.brain}
          onPause={() => {
            void send('brain/pause', { tabId: tab.id as number })
              .then(() => window.close())
              .catch((e: unknown) => setError(String(e)));
          }}
        />
      )}
      {report && <Report report={report} matched={matched} />}
      {state.isBrave && (
        <p className="note">
          {L(
            'Brave algılandı. Brave Shields ayrıca çalışıyor.',
            'Brave detected. Brave Shields runs as well.',
          )}
        </p>
      )}
      {settings && (
        <button
          type="button"
          className="link"
          onClick={() => void copyReport().catch((e: unknown) => setError(String(e)))}
        >
          {copied
            ? L('Rapor panoya kopyalandı', 'Report copied to the clipboard')
            : L(
                'Sorun raporunu kopyala (hiçbir yere gönderilmez)',
                'Copy a problem report (nothing is sent)',
              )}
        </button>
      )}
      <button type="button" className="link" onClick={() => void chrome.runtime.openOptionsPage()}>
        {L('Kontrol paneli', 'Dashboard')}
      </button>
    </main>
  );
}

mount(<Popup />);
