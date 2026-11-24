import { useEffect, useRef, useState } from 'react';
import { L } from '../shared/i18n.ts';
import { LOG_PERMISSIONS } from '../shared/permissions.ts';
import { describeRule, pairMatches, type LogEntry } from './log-match.ts';
import { PermissionNote, useGranted } from './Permission.tsx';

type Rule = chrome.declarativeNetRequest.Rule;
const MAX_ENTRIES = 500;
const FILTER = { urls: ['http://*/*', 'https://*/*'] };

/** Static rulesets are large; each is read once per page and only when a match names it. */
const rulesets = new Map<string, Promise<Map<number, Rule>>>();
function rulesetRules(id: string): Promise<Map<number, Rule>> {
  let got = rulesets.get(id);
  if (!got) {
    got = (async () => {
      const list =
        id === '_dynamic'
          ? await chrome.declarativeNetRequest.getDynamicRules()
          : id === '_session'
            ? await chrome.declarativeNetRequest.getSessionRules()
            : ((await (
                await fetch(chrome.runtime.getURL(`rulesets/${id}.json`))
              ).json()) as Rule[]);
      return new Map(list.map((r) => [r.id, r]));
    })();
    if (!id.startsWith('_')) rulesets.set(id, got);
  }
  return got;
}

/** Requests of one tab while this page is open, and which rule stopped each blocked one. */
export function Log() {
  const granted = useGranted(LOG_PERMISSIONS);
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [other, setOther] = useState<string[]>([]);
  const since = useRef(0);

  useEffect(() => {
    void chrome.tabs.query({}).then((all) => {
      const web = all.filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ''));
      setTabs(web);
      setTabId((cur) => cur ?? web.find((t) => t.active)?.id ?? web[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!granted || tabId === null) return;
    since.current = Date.now();
    const add = (e: LogEntry) => setEntries((list) => [e, ...list].slice(0, MAX_ENTRIES));
    const done = (d: chrome.webRequest.OnCompletedDetails) => {
      if (d.tabId === tabId) add({ time: d.timeStamp, url: d.url, type: d.type, error: null });
    };
    const failed = (d: chrome.webRequest.OnErrorOccurredDetails) => {
      if (d.tabId === tabId) add({ time: d.timeStamp, url: d.url, type: d.type, error: d.error });
    };
    chrome.webRequest.onCompleted.addListener(done, FILTER);
    chrome.webRequest.onErrorOccurred.addListener(failed, FILTER);
    return () => {
      chrome.webRequest.onCompleted.removeListener(done);
      chrome.webRequest.onErrorOccurred.removeListener(failed);
    };
  }, [granted, tabId]);

  // Called from a click: the browser limits how often this may run without one.
  const explain = async () => {
    if (tabId === null) return;
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({
      tabId,
      minTimeStamp: since.current,
    });
    const texts = await Promise.all(
      rulesMatchedInfo.map(async (m) => {
        const rule = (await rulesetRules(m.rule.rulesetId)).get(m.rule.ruleId);
        return { time: m.timeStamp, text: describeRule(m.rule.rulesetId, m.rule.ruleId, rule) };
      }),
    );
    const { entries: paired, unpaired } = pairMatches(entries, texts);
    setEntries(paired);
    setOther(unpaired);
  };

  return (
    <section>
      <h2>{L('Filtre günlüğü', 'Filter log')}</h2>
      <p className="muted">
        {L(
          'Seçilen sekmenin bu sayfa açıkken yaptığı istekler. “Kuralları göster” engellenen her isteğe onu durduran kuralı yazar. Günlük yalnız bu sayfada tutulur, kaydedilmez.',
          'Requests the chosen tab makes while this page is open. “Show rules” names the rule that stopped each blocked request. The log lives only in this page and is never saved.',
        )}
      </p>
      <PermissionNote
        perms={LOG_PERMISSIONS}
        why={L(
          'Günlük için tarayıcının isteğe bağlı “webRequest” ve “declarativeNetRequestFeedback” izinleri gerekiyor.',
          'The log needs the optional “webRequest” and “declarativeNetRequestFeedback” browser permissions.',
        )}
      />
      {granted && (
        <>
          <div className="row">
            <select
              aria-label={L('Sekme', 'Tab')}
              value={tabId ?? ''}
              onChange={(e) => {
                setTabId(Number(e.target.value));
                setEntries([]);
                setOther([]);
              }}
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {(t.title ?? t.url ?? '').slice(0, 80)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={tabId === null}
              onClick={() => tabId !== null && void chrome.tabs.reload(tabId)}
            >
              {L('Sekmeyi yenile', 'Reload tab')}
            </button>
            <button type="button" disabled={tabId === null} onClick={() => void explain()}>
              {L('Kuralları göster', 'Show rules')}
            </button>
          </div>
          <table className="log">
            <thead>
              <tr>
                <th>{L('Tür', 'Type')}</th>
                <th>{L('Adres', 'Address')}</th>
                <th>{L('Sonuç', 'Result')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.time}-${i}`} className={e.error ? 'log-blocked' : undefined}>
                  <td>{e.type}</td>
                  <td className="log-url">{e.url}</td>
                  <td>
                    {e.error === null
                      ? L('yüklendi', 'loaded')
                      : e.error.includes('BLOCKED_BY_CLIENT')
                        ? (e.rule ?? L('engellendi', 'blocked'))
                        : e.error}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {other.length > 0 && (
            <>
              <h3>{L('İsteği durdurmayan eşleşmeler', 'Matches that did not stop a request')}</h3>
              <ul>
                {other.map((t, i) => (
                  <li key={i}>
                    <code>{t}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
