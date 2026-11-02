import { useState } from 'react';
import type { ListStats } from '../engines/adblock/network.ts';
import { send } from '../shared/messages.ts';
import type { ListsView } from '../shared/types.ts';
import { Toggle } from './Toggle.tsx';

const nf = new Intl.NumberFormat('tr-TR');
const CATEGORY: Record<string, string> = {
  ads: 'Reklam',
  privacy: 'Gizlilik',
  regional: 'Bölgesel',
  cookies: 'Çerez bildirimleri',
  annoyances: 'Rahatsız ediciler',
  security: 'Güvenlik',
};

function Stats({ stats }: { stats: ListStats }) {
  const unsupported = Object.entries(stats.unsupported).sort((a, b) => b[1] - a[1]);
  const skipped = unsupported.reduce((n, [, c]) => n + c, 0);
  return (
    <div className="stats">
      <span>
        {nf.format(stats.converted)}/{nf.format(stats.networkFilters)} ağ filtresi dönüştürüldü ·{' '}
        {nf.format(stats.dnrRules)} DNR kuralı · {nf.format(stats.popupRules)} açılır pencere ·{' '}
        {nf.format(stats.cosmetic)} gizleme
      </span>
      {skipped > 0 && (
        <details>
          <summary>{nf.format(skipped)} filtre desteklenmiyor</summary>
          <ul>
            {unsupported.map(([reason, count]) => (
              <li key={reason}>
                <code>{reason}</code>: {nf.format(count)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const date = (v: string | number | null) =>
  v === null ? '—' : new Date(v).toLocaleString('tr-TR');

export function Lists({
  view,
  onView,
  guard,
  categories,
  hideUser,
}: {
  view: ListsView;
  onView(v: ListsView): void;
  guard(action: () => Promise<unknown>): Promise<void>;
  categories?: string[];
  hideUser?: boolean;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<ListsView>) =>
    guard(async () => {
      setBusy(true);
      try {
        onView(await action());
      } finally {
        setBusy(false);
      }
    });

  return (
    <>
      <section>
        <h2>Filtre listeleri</h2>
        <p className="muted">
          Ortak havuzda kalan statik kural kotası: {nf.format(view.availableStaticRules)}.
        </p>
        {!hideUser && (
          <>
            <Toggle
              label="Listeleri otomatik güncelle"
              checked={view.updates.auto}
              disabled={busy}
              onChange={(on) => void run(() => send('lists/setAutoUpdate', { enabled: on }))}
            />
            <p className="note">
              Açık listelerin yeni sürümü 12 saatte bir kaynağından indirilir; değişmeyen liste
              yeniden indirilmez. AdGuard listeleri bunun dışındadır, yalnızca eklenti sürümüyle
              güncellenir. Yalnızca filtre metni gelir, kod çalıştırılmaz. Scriptlet kuralları ise
              güvenlik gereği yalnızca eklenti sürümüyle güncellenir.
              {view.updates.status && (
                <>
                  {' '}
                  Son kontrol: {date(view.updates.status.at)} ·{' '}
                  {nf.format(view.updates.status.changed.length)} liste yenilendi ·{' '}
                  {nf.format(view.updates.status.added)} kural eklendi ·{' '}
                  {nf.format(view.updates.status.removed)} kural kaldırıldı.
                </>
              )}
            </p>
            {view.updates.status &&
              Object.entries(view.updates.status.errors).map(([id, error]) => (
                <p key={id} className="error">
                  {id}: {error}. Liste eski haliyle çalışmaya devam ediyor.
                </p>
              ))}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => send('lists/updateNow', {}))}
            >
              Şimdi güncelle
            </button>
          </>
        )}
        <ul className="lists">
          {view.builtin
            .filter((l) => !categories || categories.includes(l.category))
            .map((l) => (
              <li key={l.id}>
                <Toggle
                  label={`${l.name} (${CATEGORY[l.category] ?? l.category})`}
                  checked={l.enabled}
                  disabled={busy}
                  onChange={(on) =>
                    void run(() => send('lists/setEnabled', { id: l.id, enabled: on }))
                  }
                />
                <p className="note">
                  {l.buildOnly && 'Yalnızca eklenti sürümüyle güncellenir · '}
                  Sürüm {l.version ?? 'bilinmiyor'} · derlendi {date(l.builtAt)} · lisans{' '}
                  {l.license} ·{' '}
                  <a href={l.homepage} target="_blank" rel="noreferrer">
                    kaynak
                  </a>
                </p>
                {l.stats && <Stats stats={l.stats} />}
              </li>
            ))}
        </ul>
      </section>

      {!hideUser && (
        <section>
          <h2>Kendi listelerim</h2>
          <p className="muted">
            https:// adresinden ABP/uBO söz dizimli liste ekleyin (en fazla 10 MB). Ağ kuralları
            dinamik kurallara dönüşür: {nf.format(view.dynamicRules)}/
            {nf.format(view.maxDynamicRules)} kullanılıyor.
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => send('userList/add', { url: url.trim() })).then(() => setUrl(''));
            }}
          >
            <input
              type="url"
              aria-label="Liste adresi"
              placeholder="https://ornek.org/liste.txt"
              value={url}
              required
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              Ekle
            </button>
          </form>
          {view.user.length === 0 ? (
            <p className="muted">Eklenmiş liste yok.</p>
          ) : (
            <>
              <ul className="lists">
                {view.user.map((l) => (
                  <li key={l.url}>
                    <Toggle
                      label={l.url}
                      checked={l.enabled}
                      disabled={busy}
                      onChange={(on) =>
                        void run(() => send('userList/setEnabled', { url: l.url, enabled: on }))
                      }
                    />
                    <p className="note">
                      Son indirme {date(l.fetchedAt)} ·{' '}
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => void run(() => send('userList/remove', { url: l.url }))}
                      >
                        Kaldır
                      </button>
                    </p>
                    {l.error && <p className="error">İndirme hatası: {l.error}</p>}
                    {l.truncated > 0 && (
                      <p className="error">
                        {nf.format(l.truncated)} kural kota dolduğu için eklenmedi.
                      </p>
                    )}
                    {l.stats && <Stats stats={l.stats} />}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => send('userList/refresh', {}))}
              >
                Tümünü güncelle
              </button>
              <p className="note">Eklenen listeler ayrıca günde bir kez otomatik güncellenir.</p>
            </>
          )}
          {busy && <p className="muted">İşleniyor…</p>}
        </section>
      )}
    </>
  );
}
