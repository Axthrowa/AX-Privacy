import { useState } from 'react';
import type { ListStats } from '../engines/adblock/network.ts';
import { L, LOCALE } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import type { ListsView } from '../shared/types.ts';
import { Toggle } from './Toggle.tsx';

const nf = new Intl.NumberFormat(LOCALE);
const CATEGORY: Record<string, string> = {
  ads: L('Reklam', 'Ads'),
  privacy: L('Gizlilik', 'Privacy'),
  regional: L('Bölgesel', 'Regional'),
  cookies: L('Çerez bildirimleri', 'Cookie notices'),
  annoyances: L('Rahatsız ediciler', 'Annoyances'),
  security: L('Güvenlik', 'Security'),
};

function Stats({ stats }: { stats: ListStats }) {
  const unsupported = Object.entries(stats.unsupported).sort((a, b) => b[1] - a[1]);
  const skipped = unsupported.reduce((n, [, c]) => n + c, 0);
  return (
    <div className="stats">
      <span>
        {L(
          `${nf.format(stats.converted)}/${nf.format(stats.networkFilters)} ağ filtresi dönüştürüldü · ${nf.format(stats.dnrRules)} DNR kuralı · ${nf.format(stats.popupRules)} açılır pencere · ${nf.format(stats.cosmetic)} gizleme`,
          `${nf.format(stats.converted)}/${nf.format(stats.networkFilters)} network filters converted · ${nf.format(stats.dnrRules)} DNR rules · ${nf.format(stats.popupRules)} pop-up · ${nf.format(stats.cosmetic)} hiding`,
        )}
      </span>
      {skipped > 0 && (
        <details>
          <summary>
            {L(
              `${nf.format(skipped)} filtre desteklenmiyor`,
              `${nf.format(skipped)} filters not supported`,
            )}
          </summary>
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

const date = (v: string | number | null) => (v === null ? '—' : new Date(v).toLocaleString(LOCALE));

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
        <h2>{L('Filtre listeleri', 'Filter lists')}</h2>
        <p className="muted">
          {L(
            'Ortak havuzda kalan statik kural kotası',
            'Static rule quota left in the shared pool',
          )}
          : {nf.format(view.availableStaticRules)}.
        </p>
        {!hideUser && (
          <>
            <Toggle
              label={L('Listeleri otomatik güncelle', 'Update lists automatically')}
              checked={view.updates.auto}
              disabled={busy}
              onChange={(on) => void run(() => send('lists/setAutoUpdate', { enabled: on }))}
            />
            <p className="note">
              {L(
                'Açık listelerin yeni sürümü 12 saatte bir kaynağından indirilir; değişmeyen liste yeniden indirilmez. AdGuard listeleri bunun dışındadır, yalnızca eklenti sürümüyle güncellenir. Yalnızca filtre metni gelir, kod çalıştırılmaz. Scriptlet kuralları ise güvenlik gereği yalnızca eklenti sürümüyle güncellenir.',
                'New versions of enabled lists are downloaded from their source every 12 hours; an unchanged list is not downloaded again. AdGuard lists are the exception and update only with the extension. Only filter text arrives; no code runs. Scriptlet rules, for safety, also update only with the extension.',
              )}
              {view.updates.status &&
                L(
                  ` Son kontrol: ${date(view.updates.status.at)} · ${nf.format(view.updates.status.changed.length)} liste yenilendi · ${nf.format(view.updates.status.added)} kural eklendi · ${nf.format(view.updates.status.removed)} kural kaldırıldı.`,
                  ` Last check: ${date(view.updates.status.at)} · ${nf.format(view.updates.status.changed.length)} lists refreshed · ${nf.format(view.updates.status.added)} rules added · ${nf.format(view.updates.status.removed)} rules removed.`,
                )}
            </p>
            {view.updates.status &&
              Object.entries(view.updates.status.errors).map(([id, error]) => (
                <p key={id} className="error">
                  {id}: {error}.{' '}
                  {L(
                    'Liste eski haliyle çalışmaya devam ediyor.',
                    'The list keeps working as it was.',
                  )}
                </p>
              ))}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => send('lists/updateNow', {}))}
            >
              {L('Şimdi güncelle', 'Update now')}
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
                {l.enabled && !l.active && (
                  <p className="error">
                    {L(
                      'Tarayıcının ortak kural havuzunda yer kalmadığı için bu liste şu an kapalı. Başka bir listeyi kapatmak ya da başka eklentileri kaldırmak yer açar.',
                      'This list is off because the browser’s shared rule pool is full. Turning off another list or removing other extensions frees room.',
                    )}
                  </p>
                )}
                <p className="note">
                  {l.buildOnly &&
                    L(
                      'Yalnızca eklenti sürümüyle güncellenir · ',
                      'Updates only with the extension · ',
                    )}
                  {L(
                    `Sürüm ${l.version ?? 'bilinmiyor'} · derlendi ${date(l.builtAt)} · lisans ${l.license} · `,
                    `Version ${l.version ?? 'unknown'} · built ${date(l.builtAt)} · licence ${l.license} · `,
                  )}
                  <a href={l.homepage} target="_blank" rel="noreferrer">
                    {L('kaynak', 'source')}
                  </a>
                </p>
                {l.stats && <Stats stats={l.stats} />}
              </li>
            ))}
        </ul>
      </section>

      {!hideUser && (
        <section>
          <h2>{L('Kendi listelerim', 'My lists')}</h2>
          <p className="muted">
            {L(
              `https:// adresinden ABP/uBO söz dizimli liste ekleyin (en fazla 10 MB). Ağ kuralları dinamik kurallara dönüşür: ${nf.format(view.dynamicRules)}/${nf.format(view.maxDynamicRules)} kullanılıyor.`,
              `Add a list in ABP/uBO syntax from an https:// address (at most 10 MB). Network rules become dynamic rules: ${nf.format(view.dynamicRules)}/${nf.format(view.maxDynamicRules)} in use.`,
            )}
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
              aria-label={L('Liste adresi', 'List address')}
              placeholder={L('https://ornek.org/liste.txt', 'https://example.org/list.txt')}
              value={url}
              required
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              {L('Ekle', 'Add')}
            </button>
          </form>
          {view.user.length === 0 ? (
            <p className="muted">{L('Eklenmiş liste yok.', 'No lists added.')}</p>
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
                      {L('Son indirme', 'Last download')} {date(l.fetchedAt)} ·{' '}
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => void run(() => send('userList/remove', { url: l.url }))}
                      >
                        {L('Kaldır', 'Remove')}
                      </button>
                    </p>
                    {l.error && (
                      <p className="error">
                        {L('İndirme hatası', 'Download error')}: {l.error}
                      </p>
                    )}
                    {l.truncated > 0 && (
                      <p className="error">
                        {L(
                          `${nf.format(l.truncated)} kural kota dolduğu için eklenmedi.`,
                          `${nf.format(l.truncated)} rules were not added because the quota is full.`,
                        )}
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
                {L('Tümünü güncelle', 'Update all')}
              </button>
              <p className="note">
                {L(
                  'Eklenen listeler ayrıca günde bir kez otomatik güncellenir.',
                  'Added lists also update automatically once a day.',
                )}
              </p>
            </>
          )}
          {busy && <p className="muted">{L('İşleniyor…', 'Working…')}</p>}
        </section>
      )}
    </>
  );
}
