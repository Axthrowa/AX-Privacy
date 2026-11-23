import { useEffect, useState } from 'react';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import { currentProfile } from '../shared/privacy-profiles.ts';
import { DEFAULT_SITE_PROFILE } from '../storage/settings.ts';
import type { RiskLevel } from '../engines/security/heuristics.ts';
import { hidingRulesFor, problemReport } from '../shared/picked.ts';
import type { ListsView, PopupState, Settings, TabReport } from '../shared/types.ts';
import { detectBrave } from './brave.ts';
import { Fix } from './Fix.tsx';
import { mount } from './mount.tsx';

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

const SECURITY_LISTS = ['ublock-badware', 'urlhaus'];

const formatCount = (n: number) =>
  n >= 1000 ? `${(Math.floor(n / 1000) * 1000).toLocaleString('tr-TR')}+` : String(n);

function CustomLists({
  lists,
  onChange,
}: {
  lists: ListsView;
  onChange: (next: Promise<ListsView>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const staticRules = lists.builtin
    .filter((l) => l.active)
    .reduce((sum, l) => sum + (l.stats?.dnrRules ?? 0), 0);
  const status = lists.updates.status;
  const failed = status && Object.keys(status.errors).length > 0;
  const add = () => {
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
    } catch {
      setError(L('Geçerli bir http(s) adresi girin.', 'Enter a valid http(s) address.'));
      return;
    }
    setError(null);
    setBusy(true);
    onChange(
      send('userList/add', { url: url.trim() }).finally(() => {
        setBusy(false);
        setUrl('');
      }),
    );
  };
  return (
    <section className="card custom-filters-card">
      <div
        className="custom-filters-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        <div className="custom-filters-header-title">
          <span className="custom-filters-header-icon">📑</span>
          <span>
            {L('Özel Filtre Listeleri', 'Custom Filter Lists')} ({lists.user.length})
          </span>
        </div>
        <div className="custom-filters-header-actions">
          <button
            type="button"
            className={`btn-icon-refresh${busy ? ' spinning' : ''}`}
            title={L('Tüm filtre listelerini şimdi güncelle', 'Update all filter lists now')}
            aria-label={L('Listeleri güncelle', 'Update lists')}
            onClick={(e) => {
              e.stopPropagation();
              setBusy(true);
              onChange(
                send('lists/updateNow', {})
                  .then(() => send('userList/refresh', {}))
                  .finally(() => setBusy(false)),
              );
            }}
          >
            🔄
          </button>
          <span className={`accordion-arrow${open ? ' expanded' : ''}`}>▼</span>
        </div>
      </div>
      <div className={`custom-filters-content${open ? '' : ' collapsed'}`}>
        <div className="custom-filter-form">
          <div className="filter-form-row">
            <input
              type="url"
              className="filter-input"
              placeholder="https://ornek.com/filter.txt"
              aria-label={L('Liste adresi', 'List address')}
              spellCheck={false}
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button type="button" className="btn-filter-add" disabled={busy || !url} onClick={add}>
              {L('Ekle', 'Add')}
            </button>
          </div>
          {error && <div className="filter-error-text">{error}</div>}
        </div>
        <div className="custom-filter-list-scroll">
          {lists.user.length === 0 ? (
            <div className="filter-empty-state">
              {L(
                "Henüz özel liste eklenmedi (ABP, Hosts veya düz domain URL'si desteklenir).",
                'No custom list yet (ABP, hosts or plain domain URLs are supported).',
              )}
            </div>
          ) : (
            <div className="custom-filter-items">
              {lists.user.map((l) => (
                <div className="custom-filter-item" key={l.url}>
                  <div className="custom-filter-info">
                    <div className="custom-filter-name">{new URL(l.url).hostname}</div>
                    <div className="custom-filter-url" title={l.url}>
                      {l.url}
                    </div>
                  </div>
                  <div className="custom-filter-actions">
                    <span
                      className={`custom-filter-status ${l.error ? 'status-err' : l.stats ? 'status-ok' : 'status-idle'}`}
                      title={l.error ?? undefined}
                    >
                      {l.error
                        ? L('Hata', 'Error')
                        : l.stats
                          ? L(`+${l.stats.dnrRules} kural`, `+${l.stats.dnrRules} rules`)
                          : L('Bekliyor', 'Pending')}
                    </span>
                    <label className="switch switch-sm">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={l.url}
                        checked={l.enabled}
                        onChange={(e) =>
                          onChange(
                            send('userList/setEnabled', { url: l.url, enabled: e.target.checked }),
                          )
                        }
                      />
                      <span className="slider" />
                    </label>
                    <button
                      type="button"
                      className="btn-delete-filter"
                      aria-label={L('Listeyi sil', 'Remove list')}
                      title={L('Listeyi sil', 'Remove list')}
                      onClick={() => onChange(send('userList/remove', { url: l.url }))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="filter-stats-footer">
          <span>
            {L('Statik', 'Static')}: {formatCount(staticRules)} • {L('Canlı', 'Live')}:{' '}
            {lists.dynamicRules} {L('kural', 'rules')}
          </span>
          <span className={`filter-status-pill ${failed ? 'pill-err' : 'pill-ok'}`}>
            {failed ? L('Kısmi', 'Partial') : L('Güncel', 'Up to date')}
          </span>
        </div>
      </div>
    </section>
  );
}

function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [state, setState] = useState<PopupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<TabReport | null>(null);
  const [matched, setMatched] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lists, setLists] = useState<ListsView | null>(null);
  const [threats, setThreats] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const s = await send('popup/state', { url: active?.url ?? '' });
      setTab(active ?? null);
      setSettings(await send('settings/get', {}));
      setState({ ...s, isBrave: await detectBrave(s.isBrave) });
      void send('lists/get', {})
        .then(setLists)
        .catch(() => undefined);
      void send('stats/get', { days: 30 })
        .then((v) => setThreats(v.totals.security))
        .catch(() => undefined);
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

  const run = async (action: () => Promise<unknown>, reload = true) => {
    try {
      await action();
      setState(await send('popup/state', { url: tab?.url ?? '' }));
      setSettings(await send('settings/get', {}));
      if (reload && tab?.id !== undefined) await chrome.tabs.reload(tab.id);
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
  const active = state.enabled && !state.paused;
  const version = chrome.runtime.getManifest().version;

  const level = report?.risk.level ?? 'none';
  const badge = !state.enabled
    ? { cls: 'status-warning', text: L('KAPALI', 'OFF') }
    : level === 'high'
      ? { cls: 'status-danger', text: L('TEHLİKELİ', 'DANGER') }
      : level === 'medium'
        ? { cls: 'status-warning', text: L('DİKKAT', 'CAUTION') }
        : { cls: 'status-safe', text: L('GÜVENLİ', 'SAFE') };
  const url = tab?.url ?? '';
  const protocol = url.startsWith('https:')
    ? 'HTTPS'
    : url.startsWith('http:')
      ? 'HTTP'
      : L('SİSTEM', 'SYSTEM');

  const staticRules =
    lists?.builtin.filter((l) => l.active).reduce((sum, l) => sum + (l.stats?.dnrRules ?? 0), 0) ??
    0;
  const totalRules = staticRules + (lists?.dynamicRules ?? 0);
  const securityOn =
    settings !== null && SECURITY_LISTS.some((id) => settings.enabledLists.includes(id));
  const learned = settings ? (settings.customRules.match(/^[^!\n]*##/gm) ?? []).length : 0;
  const hidden = settings && site !== null ? hidingRulesFor(site, settings.customRules) : [];

  const modules: {
    id: string;
    title: string;
    desc: string;
    checked: boolean;
    set(on: boolean): Promise<unknown>;
  }[] = settings
    ? [
        {
          id: 'all',
          title: L('Reklam & İzleyici Engelleme', 'Ad & Tracker Blocking'),
          desc: L(
            `${formatCount(totalRules)} reklam ve izleyici kuralını uygular`,
            `Applies ${formatCount(totalRules)} ad and tracker rules`,
          ),
          checked: state.enabled,
          set: (on) => send('global/set', { enabled: on }),
        },
        {
          id: 'links',
          title: L('URL Veri Temizleyici', 'URL Cleaner'),
          desc: L(
            "URL'lerdeki takip parametrelerini siler",
            'Strips tracking parameters from links',
          ),
          checked: settings.privacy.cleanLinks,
          set: (on) => send('privacy/set', { privacy: { cleanLinks: on } }),
        },
        {
          id: 'cosmetic',
          title: L('Kozmetik Filtre', 'Cosmetic Filter'),
          desc: L('Sayfalardaki boş reklam alanlarını gizler', 'Hides empty ad slots on pages'),
          checked: settings.shields.cosmetic,
          set: (on) => send('shields/set', { shields: { cosmetic: on } }),
        },
        {
          id: 'security',
          title: L('Tehlike Uyarı Sistemi', 'Threat Warnings'),
          desc: L(
            'Zararlı yazılım ve oltalama sitelerini engeller, riskleri bildirir',
            'Blocks malware and phishing sites and reports risks',
          ),
          checked: securityOn,
          set: async (on) => {
            for (const id of SECURITY_LISTS) await send('lists/setEnabled', { id, enabled: on });
          },
        },
        {
          id: 'twitch',
          title: L('Twitch Yayın Kalkanı (SSAI)', 'Twitch Stream Shield (SSAI)'),
          desc: L(
            'Canlı yayın içi video reklamlarını atlatır',
            'Skips ads stitched into live streams',
          ),
          checked: settings.video.twitchAds,
          set: (on) => send('video/set', { video: { twitchAds: on } }),
        },
        {
          id: 'youtube',
          title: L('YouTube Video Kalkanı', 'YouTube Video Shield'),
          desc: L(
            'Video içi reklamları ve uyarı ekranlarını engeller',
            'Blocks in-video ads and warning screens',
          ),
          checked: settings.video.youtubeAds,
          set: (on) => send('video/set', { video: { youtubeAds: on } }),
        },
        {
          id: 'popups',
          title: L('Pop-up, GIF & Yönlendirme Kalkanı', 'Pop-up, GIF & Redirect Shield'),
          desc: L(
            "İzinsiz pop-up/pop-under, yönlendirmeler ve GIF banner'ları engeller",
            'Blocks unwanted pop-ups, pop-unders, redirects and GIF banners',
          ),
          checked: settings.shields.popups,
          set: (on) => send('shields/set', { shields: { popups: on } }),
        },
      ]
    : [];

  return (
    <main className="popup-container">
      <header className="header">
        <div className="brand">
          <img className="brand-logo" src="icons/icon-32.png" alt="" width={22} height={22} />
          <div className="brand-text">
            <span className="brand-name">AX-Privacy</span>
            <span className="brand-version">v{version}</span>
          </div>
        </div>
        <div className="header-actions">
          <div className={`status-badge ${badge.cls}`} role="status">
            <span className="status-indicator" />
            <span>{badge.text}</span>
          </div>
          <button
            type="button"
            className="btn-gear"
            title={L('Kontrol Paneli', 'Dashboard')}
            aria-label={L('Kontrol Paneli', 'Dashboard')}
            onClick={() => void chrome.runtime.openOptionsPage()}
          >
            ⚙
          </button>
        </div>
      </header>

      <section className="card site-card">
        <div className="card-meta">
          <span className="card-label">{L('AKTİF SİTE', 'ACTIVE SITE')}</span>
          <span className={`protocol-badge${protocol === 'HTTP' ? ' insecure' : ''}`}>
            {protocol}
          </span>
        </div>
        <div className="site-info">
          <div className="site-domain-wrapper">
            <span className="site-domain">
              {site ?? L('Tarayıcı Sistem Sayfası', 'Browser System Page')}
            </span>
          </div>
          <button
            type="button"
            className={`site-btn ${active ? 'btn-active' : 'btn-paused'}`}
            disabled={!state.enabled || site === null}
            aria-pressed={site === null ? undefined : active}
            onClick={() => site && void run(() => send('site/setPaused', { site, paused: active }))}
          >
            <span className="btn-icon">{site === null ? '🔒' : active ? '✓' : '⏸'}</span>
            <span>
              {site === null
                ? L('Sistem Sayfası', 'System Page')
                : active
                  ? L('Koruma Açık', 'Protection On')
                  : L('Koruma Duraklatıldı', 'Protection Paused')}
            </span>
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-wrapper blocked-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
              />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-number stat-rules">{lists ? formatCount(totalRules) : '…'}</span>
            <span className="stat-label">{L('Aktif Kural Kalkanı', 'Active Rule Shield')}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper shield-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
              />
            </svg>
          </div>
          <div className="stat-content">
            <span
              className={`stat-number ${state.enabled && securityOn ? 'stat-active' : 'stat-disabled'}`}
            >
              {state.enabled && securityOn ? L('Aktif', 'Active') : L('Kapalı', 'Off')}
            </span>
            <span className="stat-label">{L('Tehdit Kalkanı', 'Threat Shield')}</span>
          </div>
        </div>
      </section>

      <div className="live-counter-info">
        <span className="info-dot" />
        <span>
          {L(
            'Sekme bazlı canlı engelleme sayısı doğrudan ',
            'The live per-tab block count is shown on the ',
          )}
          <b>{L('eklenti simgesi rozetinde', 'extension icon badge')}</b>
          {L(' gösterilir.', '.')}
          {matched !== null && L(` Bu sayfada: ${matched}.`, ` This page: ${matched}.`)}
        </span>
      </div>

      {report?.url && report.risk.level !== 'none' && <Security risk={report.risk} />}

      <section className="card ax-brain-card">
        <div className="card-meta">
          <span className="card-label">
            {L('AX-BRAIN ÖĞRENEN KALKAN', 'AX-BRAIN LEARNING SHIELD')}
          </span>
          <span className="brain-chip">{L('Yerel AI', 'Local AI')}</span>
        </div>
        <div className="ax-brain-body">
          <p className="ax-brain-desc">
            {L(
              'Sayfadaki herhangi bir reklamı seçip gizleyin; kalkan anında öğrenir ve kalıcı olarak engeller.',
              'Pick any ad on the page to hide it; the shield learns at once and blocks it for good.',
            )}
          </p>
          <button
            type="button"
            className="btn-picker"
            disabled={!active || site === null || tab?.id === undefined}
            onClick={() => {
              if (tab?.id === undefined) return;
              void send('picker/start', { tabId: tab.id })
                .then(() => window.close())
                .catch((e: unknown) => setError(String(e)));
            }}
          >
            <span>🎯 {L('Reklamı Seç ve Öğret', 'Pick an Ad and Teach')}</span>
          </button>
          <div className="ax-brain-stats-row">
            <span className="ax-brain-stats">
              {L('Öğrenilen', 'Learned')}: {learned} {L('kural', 'rules')} • {threats ?? 0}{' '}
              {L('tehdit engellendi', 'threats blocked')}
            </span>
            <button
              type="button"
              className="btn-brain-reset"
              title={L(
                'AX-Brain modelini sıfırla (gizleme kuralların silinmez)',
                'Reset the AX-Brain model (your hiding rules stay)',
              )}
              onClick={() => {
                if (!confirm(L('AX-Brain modeli sıfırlansın mı?', 'Reset the AX-Brain model?')))
                  return;
                void send('brain/reset', {})
                  .then(() => setResetDone(true))
                  .catch((e: unknown) => setError(String(e)));
              }}
            >
              {resetDone ? L('Sıfırlandı', 'Reset') : L('Sıfırla', 'Reset')}
            </button>
          </div>
          {report?.brain && tab?.id !== undefined && (
            <Brain
              brain={report.brain}
              onPause={() => {
                if (tab.id === undefined) return;
                void send('brain/pause', { tabId: tab.id })
                  .then(() => window.close())
                  .catch((e: unknown) => setError(String(e)));
              }}
            />
          )}
          {hidden.length > 0 && (
            <details>
              <summary>
                {L(
                  `Bu sitede gizlediklerim (${hidden.length})`,
                  `What I hid here (${hidden.length})`,
                )}
              </summary>
              <ul className="hosts">
                {hidden.map((line) => (
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
        </div>
      </section>

      {lists && (
        <CustomLists
          lists={lists}
          onChange={(next) => void next.then(setLists).catch((e: unknown) => setError(String(e)))}
        />
      )}

      {canFix && settings && fixing && (
        <section className="card">
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
        </section>
      )}

      {report && (
        <details className="card report-card">
          <summary>{L('Sayfa raporu ve sorun giderme', 'Page report and troubleshooting')}</summary>
          <Report report={report} matched={matched} />
          {canFix && !fixing && !state.paused && ownBlocked && (
            <p className="note">
              {L(
                'Bu sitenin kendi sunucusuna giden bazı istekler engellendi. Sayfada bir şey çalışmıyorsa sorun gidermeyi deneyin.',
                'Some requests to this site’s own servers were blocked. If something on the page does not work, try fixing it.',
              )}
            </p>
          )}
          {canFix && !fixing && !state.paused && (
            <div className="action-row">
              <button type="button" className="btn-ghost" onClick={() => setFixing(true)}>
                {L('Bu sitede sorun var', 'Something is broken')}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void run(() => send('site/pauseBriefly', { site }))}
              >
                {L('30 dk duraklat', 'Pause 30 min')}
              </button>
            </div>
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
        </details>
      )}

      {modules.length > 0 && (
        <section className="modules-section">
          <div className="section-title">{L('KORUMA MODÜLLERİ', 'PROTECTION MODULES')}</div>
          {modules.map((m) => (
            <div className="module-item" key={m.id}>
              <div className="module-text">
                <div className="module-title">{m.title}</div>
                <div className="module-desc">{m.desc}</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={m.title}
                  checked={m.checked}
                  disabled={m.id !== 'all' && !state.enabled}
                  onChange={(e) =>
                    void run(async () => {
                      await m.set(e.target.checked);
                      if (m.id === 'security') setLists(await send('lists/get', {}));
                    })
                  }
                />
                <span className="slider" />
              </label>
            </div>
          ))}
        </section>
      )}

      {state.isBrave && (
        <p className="note">
          {L(
            'Brave algılandı. Brave Shields ayrıca çalışıyor.',
            'Brave detected. Brave Shields runs as well.',
          )}
        </p>
      )}

      <button
        type="button"
        className="btn-panel"
        onClick={() => void chrome.runtime.openOptionsPage()}
      >
        ⚙ {L('Kontrol Paneli', 'Dashboard')}
      </button>

      <footer className="footer">
        <span>
          AX-Privacy v{version} • {L('%100 Yerel ve Şifresiz Koruma', '100% Local Protection')}
        </span>
      </footer>
    </main>
  );
}

mount(<Popup />);
