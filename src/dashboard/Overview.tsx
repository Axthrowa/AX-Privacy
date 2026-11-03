import { blockedRequests } from '../engines/core/stats.ts';
import type { Settings, StatsView } from '../shared/types.ts';

const nf = new Intl.NumberFormat('tr-TR');
const LABELS = {
  requests: 'Engellenen istek',
  security: 'Güvenlik listesinden sayfa',
  pages: 'Engellenen sayfa',
  popups: 'Kapatılan açılır pencere',
  consent: 'Reddedilen çerez bildirimi',
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
      <h2>Özet</h2>
      <p className="muted">
        Koruma {settings.enabled ? 'açık' : 'kapalı'}. Tarayıcı bir isteği kimin engellediğini
        bildirmez: istek sayısına Brave Shields veya başka bir engelleyicinin durdurdukları da
        girer. Sayfa sayıları yalnızca AX'indir.
      </p>
      {!settings.privacy.detailedReports && (
        <p className="note">
          Ayrıntılı raporlar kapalı: istek sayaçları kaynak harcamamak için artmıyor. Gizlilik
          bölümünden açabilirsiniz. Engelleme bundan etkilenmez.
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
            <span>bugün · {LABELS[k]}</span>
            <span className="note">
              {range} günde {nf.format(stats.totals[k])}
            </span>
          </div>
        ))}
      </div>
      <div className="row">
        <label className="field">
          <span>Aralık</span>
          <select
            aria-label="İstatistik aralığı"
            value={range}
            onChange={(e) => onRange(Number(e.target.value) as 7 | 30)}
          >
            <option value={7}>Son 7 gün</option>
            <option value={30}>Son 30 gün</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={onClear}>
          Sayaçları sıfırla
        </button>
      </div>
      <div className="bars" role="img" aria-label={`${range} günlük yığın grafik`}>
        {stats.days.map((d) => (
          <div key={d.day} title={`${d.day}: ${blockedRequests(d)} istek, ${d.pages} sayfa`}>
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
        Çubuk: yeşil engellenen istek, kırmızı güvenlik listesinden sayfa, turuncu diğer sayfa.
      </p>
      <h3>En çok engellenen alan adları</h3>
      {stats.topHosts.length === 0 ? (
        <p className="muted">Henüz engellenen istek yok.</p>
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
      <h3>Güvenlik olayları</h3>
      {stats.events.length === 0 ? (
        <p className="muted">Kayıtlı sayfa engeli veya kapatılan açılır pencere yok.</p>
      ) : (
        <ul className="events">
          {stats.events.map((e) => (
            <li key={`${e.at}:${e.url}`}>
              <span>
                {e.kind === 'page' ? 'Sayfa' : 'Açılır pencere'}
                {e.list ? ` · ${e.list}` : ''}
              </span>
              <code>{e.url}</code>
              <time dateTime={new Date(e.at).toISOString()}>
                {new Date(e.at).toLocaleString('tr-TR')}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
