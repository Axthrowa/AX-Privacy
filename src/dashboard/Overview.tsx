import { blockedRequests } from '../engines/core/stats.ts';
import { L, LOCALE } from '../shared/i18n.ts';
import type { Settings, StatsView } from '../shared/types.ts';

const nf = new Intl.NumberFormat(LOCALE);
const LABELS = {
  requests: L('Engellenen istek', 'Blocked requests'),
  security: L('Güvenlik listesinden sayfa', 'Pages from security lists'),
  pages: L('Engellenen sayfa', 'Blocked pages'),
  popups: L('Kapatılan açılır pencere', 'Closed pop-ups'),
  consent: L('Reddedilen çerez bildirimi', 'Rejected cookie notices'),
} as const;

export function Overview({
  settings,
  stats,
  range,
  onRange,
  onClear,
}: {
  settings: Settings;
  stats: StatsView;
  range: 7 | 30;
  onRange(days: 7 | 30): void;
  onClear(): void;
}) {
  const today = stats.days.at(-1);
  const max = Math.max(
    1,
    ...stats.days.map((d) => blockedRequests(d) + d.pages + d.popups + d.consent),
  );
  return (
    <section id="overview">
      <h2>{L('Özet', 'Overview')}</h2>
      <p className="muted">
        {L(
          `Koruma ${settings.enabled ? 'açık' : 'kapalı'}. Tarayıcı bir isteği kimin engellediğini bildirmez: istek sayısına Brave Shields veya başka bir engelleyicinin durdurdukları da girer. Sayfa sayıları yalnızca AX'indir.`,
          `Protection is ${settings.enabled ? 'on' : 'off'}. The browser does not say who blocked a request: the request count includes what Brave Shields or another blocker stopped. Page counts are AX’s alone.`,
        )}
      </p>
      {!settings.privacy.detailedReports && (
        <p className="note">
          {L(
            'Ayrıntılı raporlar kapalı: istek sayaçları kaynak harcamamak için artmıyor. Gizlilik bölümünden açabilirsiniz. Engelleme bundan etkilenmez.',
            'Detailed reports are off: request counters do not grow, to save resources. You can turn them on under Privacy. Blocking does not depend on it.',
          )}
        </p>
      )}
      <div className="cards">
        {(
          [
            ['requests', today ? blockedRequests(today) : 0],
            ['pages', today?.pages ?? 0],
            ['security', today?.security ?? 0],
            ['popups', today?.popups ?? 0],
            ['consent', today?.consent ?? 0],
          ] as const
        ).map(([k, n]) => (
          <div key={k} className="card">
            <strong>{nf.format(n)}</strong>
            <span>
              {L('bugün', 'today')} · {LABELS[k]}
            </span>
            <span className="note">
              {L(
                `${range} günde ${nf.format(stats.totals[k])}`,
                `${nf.format(stats.totals[k])} in ${range} days`,
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="row">
        <label className="field">
          <span>{L('Aralık', 'Range')}</span>
          <select
            aria-label={L('İstatistik aralığı', 'Statistics range')}
            value={range}
            onChange={(e) => onRange(Number(e.target.value) as 7 | 30)}
          >
            <option value={7}>{L('Son 7 gün', 'Last 7 days')}</option>
            <option value={30}>{L('Son 30 gün', 'Last 30 days')}</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={onClear}>
          {L('Sayaçları sıfırla', 'Reset counters')}
        </button>
      </div>
      <div
        className="bars"
        role="img"
        aria-label={L(`${range} günlük yığın grafik`, `Stacked chart of ${range} days`)}
      >
        {stats.days.map((d) => (
          <div
            key={d.day}
            title={L(
              `${d.day}: ${blockedRequests(d)} istek, ${d.pages} sayfa`,
              `${d.day}: ${blockedRequests(d)} requests, ${d.pages} pages`,
            )}
          >
            {(
              [
                ['ads', blockedRequests(d)],
                ['security', d.security],
                // Security pages are counted in `pages` too.
                ['pages', d.pages - d.security],
              ] as const
            ).map(([k, n]) => (
              <i key={k} className={k} style={{ height: `${Math.round((n / max) * 100)}%` }} />
            ))}
          </div>
        ))}
      </div>
      <p className="note">
        {L(
          'Çubuk: yeşil engellenen istek, kırmızı güvenlik listesinden sayfa, turuncu diğer sayfa.',
          'Bars: green blocked requests, red pages from security lists, orange other pages.',
        )}
      </p>
      <h3>{L('En çok engellenen alan adları', 'Most blocked domains')}</h3>
      {stats.topHosts.length === 0 ? (
        <p className="muted">{L('Henüz engellenen istek yok.', 'No blocked requests yet.')}</p>
      ) : (
        <ul className="hosts">
          {stats.topHosts.map((h) => (
            <li key={h.host}>
              <span>{h.host}</span>
              <span className="blocked">{nf.format(h.count)}</span>
            </li>
          ))}
        </ul>
      )}
      <h3>{L('Güvenlik olayları', 'Security events')}</h3>
      {stats.events.length === 0 ? (
        <p className="muted">
          {L(
            'Kayıtlı sayfa engeli veya kapatılan açılır pencere yok.',
            'No recorded page blocks or closed pop-ups.',
          )}
        </p>
      ) : (
        <ul className="events">
          {stats.events.map((e) => (
            <li key={`${e.at}:${e.url}`}>
              <span>
                {e.kind === 'page' ? L('Sayfa', 'Page') : L('Açılır pencere', 'Pop-up')}
                {e.list ? ` · ${e.list}` : ''}
              </span>
              <code>{e.url}</code>
              <time dateTime={new Date(e.at).toISOString()}>
                {new Date(e.at).toLocaleString(LOCALE)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
