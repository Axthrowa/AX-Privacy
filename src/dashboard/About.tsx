import { useRef, useState } from 'react';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import type { Settings } from '../shared/types.ts';
import { browserLabel } from './brave.ts';

export function About({
  settings,
  guard,
}: {
  settings: Settings;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <section id="about">
      <h2>{L('Hakkında ve yedek', 'About and backup')}</h2>
      <p>
        {L('Tarayıcı', 'Browser')}: {browserLabel(settings.isBrave)}
      </p>
      <p className="note">
        {L(
          `Sürüm ${chrome.runtime.getManifest().version}. Geçmiş sunucuya gitmez. Dışarı istek yalnız şunlarda vardır: SponsorBlock açıksa video kimliğinin 4 karakterlik özeti, ve sizin eklediğiniz bir filtre listesinin adresi.`,
          `Version ${chrome.runtime.getManifest().version}. Your history never goes to a server. The only outgoing requests are: the 4-character hash prefix of the video ID when SponsorBlock is on, and the address of a filter list you added.`,
        )}
      </p>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            void guard(async () => {
              const data = await send('settings/export', {});
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'ax-privacy-settings.json';
              a.click();
              URL.revokeObjectURL(a.href);
            })
          }
        >
          {L('Ayarları dışa aktar', 'Export settings')}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void guard(async () => {
              const data = await send('settings/export', {});
              await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
              setCopied(true);
            })
          }
        >
          {copied ? L('Kopyalandı', 'Copied') : L('Panoya kopyala', 'Copy to clipboard')}
        </button>
        <button type="button" className="secondary" onClick={() => file.current?.click()}>
          {L('Ayarları içe aktar', 'Import settings')}
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          aria-label={L('Ayar yedeği', 'Settings backup')}
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = '';
            if (!chosen) return;
            void guard(async () => {
              const text = await chosen.text();
              let data: unknown;
              try {
                data = JSON.parse(text) as unknown;
              } catch {
                throw new Error(L('Dosya JSON değil', 'The file is not JSON'));
              }
              await send('settings/import', { data });
            });
          }}
        />
      </div>
      <p className="note">
        {L(
          'Yedek ayarları, özel kuralları, liste adreslerini ve varsa son 30 günün sayaçlarını içerir. Abone listenin metni yoktur; içe aktarınca listeler yeniden indirilir.',
          'The backup holds settings, custom rules, list addresses and, if any, the last 30 days of counters. Subscribed list text is not included; lists are downloaded again on import.',
        )}
      </p>
    </section>
  );
}
