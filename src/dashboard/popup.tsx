import { useEffect, useState } from 'react';
import { send } from '../shared/messages.ts';
import type { RiskLevel } from '../engines/security/heuristics.ts';
import type { PopupState, TabReport } from '../shared/types.ts';
import { detectBrave } from './brave.ts';
import { mount } from './mount.tsx';
import { Toggle } from './Toggle.tsx';

const RISK_LABEL: Record<Exclude<RiskLevel, 'none'>, string> = {
  high: 'Yüksek risk',
  medium: 'Dikkat',
  low: 'Düşük risk işareti',
};

function Security({ risk }: { risk: TabReport['risk'] }) {
  if (risk.level === 'none') {
    return (
      <p className="note">
        Güvenlik: bilinen bir risk bulunamadı. Bu, sitenin güvenli olduğu anlamına gelmez.
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
      <p>Bu uyarılar adres ve sayfa üzerinden yapılan yerel kontrollere dayanır; kesin değildir.</p>
    </div>
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
          Bu sayfa {third.length} üçüncü taraf alan adına bağlandı; {blocked} alan adına giden
          isteklerin en az biri engellendi (bu eklenti, başka bir eklenti veya Brave Shields).
        </p>
      ) : (
        matched !== null && (
          <p className="note">AX kuralları bu sayfada {matched} kez devreye girdi.</p>
        )
      )}
      {report.hosts.length > 0 && (
        <details>
          <summary>Alan adları</summary>
          <ul className="hosts">
            {report.hosts.map((h) => (
              <li key={h.host}>
                <span>
                  {h.host}
                  {!h.thirdParty && ' (birinci taraf)'}
                </span>
                <span className={h.blocked ? 'blocked' : undefined}>
                  {h.blocked ? `${h.blocked} engellendi` : ''}
                  {h.blocked && h.loaded ? ' · ' : ''}
                  {h.loaded ? `${h.loaded} yüklendi` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {consent && (
        <p className="note">
          Çerez bildirimi ({consent.cmp}):{' '}
          {consent.result === null
            ? 'işleniyor'
            : consent.result
              ? 'reddedildi'
              : 'reddedilemedi, kendiniz seçin'}
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

  useEffect(() => {
    void (async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const s = await send('popup/state', { url: active?.url ?? '' });
      setTab(active ?? null);
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
      if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
    } catch (e) {
      setError(String(e));
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!state) return null;
  const { site } = state;

  return (
    <main>
      <header>
        <img src="icons/icon-32.png" alt="" width={24} height={24} />
        <h1>AX Privacy</h1>
      </header>
      <p className="site">{site ?? 'Bu sayfada koruma uygulanamaz'}</p>
      <Toggle
        label="Bu sitede koruma"
        checked={state.enabled && !state.paused}
        disabled={!state.enabled || site === null}
        onChange={(on) => site && run(() => send('site/setPaused', { site, paused: !on }))}
      />
      <Toggle
        label="Tüm koruma"
        checked={state.enabled}
        onChange={(on) => run(() => send('global/set', { enabled: on }))}
      />
      {state.enabled && !state.paused && site !== null && (
        <button
          type="button"
          className="secondary"
          onClick={() => void run(() => send('site/pauseBriefly', { site }))}
        >
          Bu sitede sorun var: 30 dakika duraklat
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
          Sayfada bir öğeyi gizle
        </button>
      )}
      {report && <Report report={report} matched={matched} />}
      {state.isBrave && <p className="note">Brave algılandı. Brave Shields ayrıca çalışıyor.</p>}
      <button type="button" className="link" onClick={() => void chrome.runtime.openOptionsPage()}>
        Kontrol paneli
      </button>
    </main>
  );
}

mount(<Popup />);
