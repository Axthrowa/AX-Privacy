import { useCallback, useEffect, useState } from 'react';
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

const NAV = [
  ['overview', 'Özet'],
  ['ads', 'Reklam'],
  ['privacy', 'Gizlilik'],
  ['tracking', 'İzleme'],
  ['fingerprint', 'Parmak izi'],
  ['security', 'Güvenlik'],
  ['scam', 'Dolandırıcılık'],
  ['video', 'Video'],
  ['cookies', 'Çerez'],
  ['lists', 'Listeler'],
  ['sites', 'Siteler'],
  ['advanced', 'Gelişmiş'],
  ['statistics', 'İstatistik'],
  ['about', 'Hakkında'],
] as const;

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
          {settings.theme === 'dark' ? 'Açık tema' : 'Koyu tema'}
        </button>
      </header>
      <nav aria-label="Sayfalar">
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
              <h2>Genel koruma</h2>
              <Toggle
                label="Tüm koruma"
                checked={settings.enabled}
                onChange={(on) => void guard(() => send('global/set', { enabled: on }))}
              />
            </section>
          </>
        )}

        {show('ads') && lists && (
          <>
            <p className="muted">
              Reklam sayacı EasyList, uBlock filters ve AdGuard Türkçe eşleşmelerinden gelir.
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
        {show('privacy') && <Privacy settings={settings} guard={guard} />}
        {show('tracking') && lists && (
          <>
            <p className="muted">
              İzleyici sayacı EasyPrivacy ve AdGuard URL Tracking eşleşmelerinden gelir.
            </p>
            <Lists view={lists} onView={setLists} guard={guard} categories={['privacy']} hideUser />
          </>
        )}
        {show('fingerprint') && <Privacy settings={settings} guard={guard} />}
        {show('security') && lists && (
          <>
            <p className="muted">
              Sayfa engeli Badware ve URLhaus listelerinden gelir. Kimlik avı listesi paketle gelmez
              (OpenPhish yeniden dağıtılamaz).
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
            <h2>Dolandırıcılık işaretleri</h2>
            <p className="muted">
              Popup’taki risk metni yerel adres kontrolleridir (homograf, marka benzerliği, http
              şifre). Dış itibar puanı yoktur. Aşağıda yalnızca gerçekten engellenen sayfalar var.
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
      <h2>Özel kurallar</h2>
      <p className="muted">
        Satır başına bir kural. Ağ: <code>||reklam.example^</code>,{' '}
        <code>||pop.example^$popup</code>, istisna <code>@@||cdn.example^</code>, regex{' '}
        <code>/reklam[0-9]+/</code>. Gizleme: <code>example.com##.reklam</code>, tüm siteler{' '}
        <code>##.reklam</code>, istisna <code>example.com#@#.reklam</code>, gelişmiş{' '}
        <code>##div:has-text(Sponsorlu)</code>. <code>!</code> ile başlayan satırlar yorumdur.
      </p>
      <textarea
        aria-label="Özel kurallar"
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
        Kaydet
      </button>
      {report && (
        <div className="result">
          <p>
            {report.network} ağ kuralı, {report.cosmetic} gizleme kuralı etkin. Gizleme kuralları
            açık sayfalar yenilenince uygulanır.
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
      <h2>Duraklatılan siteler</h2>
      <p className="muted">
        Duraklatma her şeyi kapatır (sayfa engeli dahil). Aşağıdaki anahtarlar daha dardır: ağ
        kapatılınca alt kaynaklar serbest kalır, belge (zararlı site) engeli durur. Güvenliği
        kapatmak o adresi kara listeden muaf tutar.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const site = siteDraft.trim().toLowerCase();
          if (!isValidSite(site)) {
            setError('Geçerli bir alan adı veya IP girin (ör. example.com)');
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
          aria-label="Duraklatılacak site"
          placeholder="example.com"
          value={siteDraft}
          onChange={(e) => setSiteDraft(e.target.value)}
        />
        <button type="submit">Duraklat</button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const site = siteDraft.trim().toLowerCase();
            if (!isValidSite(site)) {
              setError('Geçerli bir alan adı veya IP girin (ör. example.com)');
              return;
            }
            void guard(async () => {
              await send('site/setProfile', { site, profile: { network: false } });
              setSiteDraft('');
            });
          }}
        >
          Yalnız ağı kapat
        </button>
      </form>
      {known.length === 0 ? (
        <p className="muted">Duraklatılan site yok.</p>
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
                      Korumayı aç
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
        label="Ağ ve gizleme"
        checked={profile.network}
        onChange={(on) => set({ network: on })}
      />
      <Toggle label="Gizlilik" checked={profile.privacy} onChange={(on) => set({ privacy: on })} />
      <Toggle label="Video" checked={profile.video} onChange={(on) => set({ video: on })} />
      <Toggle
        label="Güvenlik (sayfa engeli)"
        checked={profile.security}
        onChange={(on) => set({ security: on })}
      />
    </div>
  );
}

mount(<Dashboard />);
