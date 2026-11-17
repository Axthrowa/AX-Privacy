import { useCallback, useEffect, useState } from 'react';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import type {
  CustomRulesResult,
  ListsView,
  Settings,
  SiteProfile,
  StatsView,
} from '../shared/types.ts';
import { isValidSite } from '../shared/site.ts';
import { siteProfile } from '../engines/core/control.ts';
import { About } from './About.tsx';
import { detectBrave } from './brave.ts';
import { Lists } from './Lists.tsx';
import { mount } from './mount.tsx';
import { Overview } from './Overview.tsx';
import { Privacy } from './Privacy.tsx';
import { Toggle } from './Toggle.tsx';
import { Video } from './Video.tsx';
import { Welcome } from './Welcome.tsx';

const NAV = [
  ['overview', L('Özet', 'Overview')],
  ['ads', L('Reklam', 'Ads')],
  ['privacy', L('Gizlilik', 'Privacy')],
  ['tracking', L('İzleme', 'Tracking')],
  ['fingerprint', L('Parmak izi', 'Fingerprint')],
  ['security', L('Güvenlik', 'Security')],
  ['scam', L('Dolandırıcılık', 'Scams')],
  ['video', 'Video'],
  ['cookies', L('Çerez', 'Cookies')],
  ['lists', L('Listeler', 'Lists')],
  ['sites', L('Siteler', 'Sites')],
  ['advanced', L('Gelişmiş', 'Advanced')],
  ['statistics', L('İstatistik', 'Statistics')],
  ['about', L('Hakkında', 'About')],
] as const;

const INVALID_SITE = L(
  'Geçerli bir alan adı veya IP girin (ör. example.com)',
  'Enter a valid domain or IP (e.g. example.com)',
);

function applyTheme(theme: Settings['theme']) {
  document.documentElement.dataset.theme = theme;
}

function useHash(fallback = 'overview') {
  const [page, setPage] = useState(() => location.hash.replace(/^#/, '') || fallback);
  useEffect(() => {
    const on = () => setPage(location.hash.replace(/^#/, '') || fallback);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [fallback]);
  return page;
}

function Dashboard() {
  const page = useHash();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lists, setLists] = useState<ListsView | null>(null);
  const [draft, setDraft] = useState('');
  const [report, setReport] = useState<CustomRulesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsView | null>(null);
  const [range, setRange] = useState<7 | 30>(7);
  const [siteDraft, setSiteDraft] = useState('');

  const refresh = useCallback(async () => {
    const s = await send('settings/get', {});
    setSettings(s);
    applyTheme(s.theme);
    return s;
  }, []);

  const loadStats = useCallback(async (days: 7 | 30) => {
    setStats(await send('stats/get', { days }));
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await refresh();
      setDraft(s.customRules);
      setLists(await send('lists/get', {}));
      setReport(await send('rules/report', {}));
      await detectBrave(s.isBrave);
      await refresh();
      await loadStats(range);
    })().catch((e: unknown) => setError(String(e)));
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && 'settings' in changes) void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh, loadStats, range]);

  const guard = async (action: () => Promise<unknown>) => {
    setError(null);
    await action().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  if (!settings) return error ? <p className="error">{error}</p> : null;
  const show = (id: string) => page === id;
  const overview = stats && (
    <Overview
      settings={settings}
      stats={stats}
      range={range}
      onRange={(days) => {
        setRange(days);
        void loadStats(days);
      }}
      onClear={() =>
        void guard(async () => {
          setStats(await send('stats/clear', {}));
        })
      }
    />
  );

  return (
    <>
      <header>
        <img src="icons/icon-48.png" alt="" width={36} height={36} />
        <h1>AX Privacy</h1>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void guard(() =>
              send('theme/set', { theme: settings.theme === 'dark' ? 'light' : 'dark' }),
            )
          }
        >
          {settings.theme === 'dark' ? L('Açık tema', 'Light theme') : L('Koyu tema', 'Dark theme')}
        </button>
      </header>
      <nav aria-label={L('Sayfalar', 'Pages')}>
        {NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-current={page === id ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <main>
        {error && <p className="error">{error}</p>}

        {show('overview') && (
          <>
            {overview}
            <section>
              <h2>{L('Genel koruma', 'Protection')}</h2>
              <Toggle
                label={L('Tüm koruma', 'All protection')}
                checked={settings.enabled}
                onChange={(on) => void guard(() => send('global/set', { enabled: on }))}
              />
            </section>
          </>
        )}

        {show('ads') && lists && (
          <>
            <p className="muted">
              {L(
                'Reklam sayacı EasyList, uBlock filters ve AdGuard Türkçe eşleşmelerinden gelir.',
                'The ad counter comes from EasyList, uBlock filters and AdGuard Turkish matches.',
              )}
            </p>
            <Lists
              view={lists}
              onView={setLists}
              guard={guard}
              categories={['ads', 'regional']}
              hideUser
            />
          </>
        )}
        {show('welcome') && <Welcome settings={settings} guard={guard} />}
        {show('privacy') && <Privacy settings={settings} guard={guard} />}
        {show('tracking') && lists && (
          <>
            <p className="muted">
              {L(
                'İzleyici sayacı EasyPrivacy ve AdGuard URL Tracking eşleşmelerinden gelir.',
                'The tracker counter comes from EasyPrivacy and AdGuard URL Tracking matches.',
              )}
            </p>
            <Lists view={lists} onView={setLists} guard={guard} categories={['privacy']} hideUser />
          </>
        )}
        {show('fingerprint') && <Privacy settings={settings} guard={guard} />}
        {show('security') && lists && (
          <>
            <p className="muted">
              {L(
                'Sayfa engeli Badware ve URLhaus listelerinden gelir. Kimlik avı listesi paketle gelmez (OpenPhish yeniden dağıtılamaz).',
                'Page blocks come from the Badware and URLhaus lists. No phishing list ships with the package (OpenPhish may not be redistributed).',
              )}
            </p>
            <Lists
              view={lists}
              onView={setLists}
              guard={guard}
              categories={['security']}
              hideUser
            />
            {overview}
          </>
        )}
        {show('scam') && (
          <section>
            <h2>{L('Dolandırıcılık işaretleri', 'Scam signs')}</h2>
            <p className="muted">
              {L(
                'Popup’taki risk metni yerel adres kontrolleridir (homograf, marka benzerliği, http şifre). Dış itibar puanı yoktur. Aşağıda yalnızca gerçekten engellenen sayfalar var.',
                'The risk text in the popup comes from local address checks (homographs, brand look-alikes, passwords over http). There is no outside reputation score. Below are only pages that were really blocked.',
              )}
            </p>
            {overview}
          </section>
        )}
        {show('video') && <Video settings={settings} guard={guard} />}
        {show('cookies') && lists && (
          <>
            <Privacy settings={settings} guard={guard} />
            <Lists view={lists} onView={setLists} guard={guard} categories={['cookies']} hideUser />
          </>
        )}
        {show('lists') && lists && <Lists view={lists} onView={setLists} guard={guard} />}
        {show('sites') && (
          <Sites
            settings={settings}
            siteDraft={siteDraft}
            setSiteDraft={setSiteDraft}
            guard={guard}
            setError={setError}
          />
        )}
        {show('advanced') && (
          <Rules
            draft={draft}
            setDraft={setDraft}
            report={report}
            setReport={setReport}
            setLists={setLists}
            guard={guard}
          />
        )}
        {show('statistics') && overview}
        {show('about') && <About settings={settings} guard={guard} />}
      </main>
    </>
  );
}

function Rules({
  draft,
  setDraft,
  report,
  setReport,
  setLists,
  guard,
}: {
  draft: string;
  setDraft(v: string): void;
  report: CustomRulesResult | null;
  setReport(v: CustomRulesResult): void;
  setLists(v: ListsView): void;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  return (
    <section id="rules">
      <h2>{L('Özel kurallar', 'Custom rules')}</h2>
      <p className="muted">
        {L(
          <>
            Satır başına bir kural. Ağ: <code>||reklam.example^</code>,{' '}
            <code>||pop.example^$popup</code>, istisna <code>@@||cdn.example^</code>, regex{' '}
            <code>/reklam[0-9]+/</code>. Gizleme: <code>example.com##.reklam</code>, tüm siteler{' '}
            <code>##.reklam</code>, istisna <code>example.com#@#.reklam</code>, gelişmiş{' '}
            <code>##div:has-text(Sponsorlu)</code>. <code>!</code> ile başlayan satırlar yorumdur.
          </>,
          <>
            One rule per line. Network: <code>||ads.example^</code>,{' '}
            <code>||pop.example^$popup</code>, exception <code>@@||cdn.example^</code>, regex{' '}
            <code>/ads[0-9]+/</code>. Hiding: <code>example.com##.ad</code>, all sites{' '}
            <code>##.ad</code>, exception <code>example.com#@#.ad</code>, advanced{' '}
            <code>##div:has-text(Sponsored)</code>. Lines starting with <code>!</code> are comments.
          </>,
        )}
      </p>
      <textarea
        aria-label={L('Özel kurallar', 'Custom rules')}
        value={draft}
        spellCheck={false}
        rows={10}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        type="button"
        onClick={() =>
          void guard(async () => {
            setReport(await send('rules/setCustom', { text: draft }));
            setLists(await send('lists/get', {}));
          })
        }
      >
        {L('Kaydet', 'Save')}
      </button>
      {report && (
        <div className="result">
          <p>
            {L(
              `${report.network} ağ kuralı, ${report.cosmetic} gizleme kuralı etkin. Gizleme kuralları açık sayfalar yenilenince uygulanır.`,
              `${report.network} network rules and ${report.cosmetic} hiding rules active. Hiding rules apply to open pages after a reload.`,
            )}
          </p>
          {report.rejected.length > 0 && (
            <ul className="rejected">
              {report.rejected.map((r, i) => (
                <li key={`${i}:${r.line}`}>
                  <code>{r.line}</code>: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Sites({
  settings,
  siteDraft,
  setSiteDraft,
  guard,
  setError,
}: {
  settings: Settings;
  siteDraft: string;
  setSiteDraft(v: string): void;
  guard(action: () => Promise<unknown>): Promise<void>;
  setError(v: string | null): void;
}) {
  const known = [
    ...new Set([...settings.pausedSites, ...Object.keys(settings.siteProfiles)]),
  ].sort();
  return (
    <section id="sites">
      <h2>{L('Duraklatılan siteler', 'Paused sites')}</h2>
      <p className="muted">
        {L(
          'Duraklatma her şeyi kapatır (sayfa engeli dahil). Aşağıdaki anahtarlar daha dardır: ağ kapatılınca alt kaynaklar serbest kalır, belge (zararlı site) engeli durur. Güvenliği kapatmak o adresi kara listeden muaf tutar.',
          'Pausing turns everything off (page blocks included). The switches below are narrower: with network off, subresources are let through and the document (harmful site) block stays. Turning security off exempts that address from the blocklists.',
        )}
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const site = siteDraft.trim().toLowerCase();
          if (!isValidSite(site)) {
            setError(INVALID_SITE);
            return;
          }
          void guard(async () => {
            await send('site/setPaused', { site, paused: true });
            setSiteDraft('');
          });
        }}
      >
        <input
          type="text"
          aria-label={L('Duraklatılacak site', 'Site to pause')}
          placeholder="example.com"
          value={siteDraft}
          onChange={(e) => setSiteDraft(e.target.value)}
        />
        <button type="submit">{L('Duraklat', 'Pause')}</button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const site = siteDraft.trim().toLowerCase();
            if (!isValidSite(site)) {
              setError(INVALID_SITE);
              return;
            }
            void guard(async () => {
              await send('site/setProfile', { site, profile: { network: false } });
              setSiteDraft('');
            });
          }}
        >
          {L('Yalnız ağı kapat', 'Turn off network only')}
        </button>
      </form>
      {known.length === 0 ? (
        <p className="muted">{L('Duraklatılan site yok.', 'No paused sites.')}</p>
      ) : (
        <ul className="sites profiles">
          {known.map((site) => {
            const paused = settings.pausedSites.includes(site);
            const p = siteProfile(settings, site);
            return (
              <li key={site}>
                <div>
                  <strong>{site}</strong>
                  {paused ? (
                    <button
                      type="button"
                      onClick={() =>
                        void guard(() => send('site/setPaused', { site, paused: false }))
                      }
                    >
                      {L('Korumayı aç', 'Turn protection on')}
                    </button>
                  ) : (
                    <ModuleToggles site={site} profile={p} guard={guard} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ModuleToggles({
  site,
  profile,
  guard,
}: {
  site: string;
  profile: SiteProfile;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const set = (patch: Partial<SiteProfile>) =>
    void guard(() => send('site/setProfile', { site, profile: patch }));
  return (
    <div className="modules">
      <Toggle
        label={L('Ağ ve gizleme', 'Network and hiding')}
        checked={profile.network}
        onChange={(on) => set({ network: on })}
      />
      <Toggle
        label={L('Gizlilik', 'Privacy')}
        checked={profile.privacy}
        onChange={(on) => set({ privacy: on })}
      />
      <Toggle label="Video" checked={profile.video} onChange={(on) => set({ video: on })} />
      <Toggle
        label={L('Güvenlik (sayfa engeli)', 'Security (page block)')}
        checked={profile.security}
        onChange={(on) => set({ security: on })}
      />
    </div>
  );
}

mount(<Dashboard />, L('AX Privacy — Kontrol paneli', 'AX Privacy — Dashboard'));
