import { useState } from 'react';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import { mount } from './mount.tsx';

const params = new URLSearchParams(location.search);
const url = params.get('url') ?? '';
const list = params.get('list') ?? '';
const isWeb = /^https?:\/\//i.test(url);

function leave(): void {
  // History is [previous page, browser error page, this page]; the error page would block again.
  if (history.length > 2) history.go(-2);
  else
    void chrome.tabs
      .getCurrent()
      .then((t) => (t?.id === undefined ? undefined : chrome.tabs.remove(t.id)));
}

function Blocked() {
  const [error, setError] = useState<string | null>(null);

  const proceed = async () => {
    try {
      await send('security/proceed', { url });
      location.replace(url);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <main>
      <header>
        <img src="icons/icon-32.png" alt="" width={24} height={24} />
        <h1>{L('Bu sayfa engellendi', 'This page was blocked')}</h1>
      </header>
      <p className="url">{url}</p>
      <p>
        {L(
          <>
            Adres <strong>{list}</strong> listesinde zararlı, kimlik avı veya istenmeyen bir site
            olarak kayıtlı. AX Privacy sayfayı açmadan durdurdu.
          </>,
          <>
            The address is listed in <strong>{list}</strong> as a malicious, phishing or unwanted
            site. AX Privacy stopped it before it opened.
          </>,
        )}
      </p>
      <p className="note">
        {L(
          'Listeler hatalı kayıt içerebilir ve listede olmayan bir site de zararlı olabilir. Siteyi tanıyor ve güveniyorsanız devam edebilirsiniz; izin bu tarayıcı oturumu boyunca bu alan adı için geçerli olur.',
          'Lists can contain mistakes, and a site not on any list can still be harmful. If you know and trust the site you can continue; the permission lasts for this domain until the browser closes.',
        )}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" onClick={leave}>
          {L('Güvenli tarafa dön', 'Back to safety')}
        </button>
        {isWeb && (
          <button type="button" className="secondary" onClick={() => void proceed()}>
            {L('Riski anlıyorum, yine de devam et', 'I understand the risk, continue anyway')}
          </button>
        )}
      </div>
    </main>
  );
}

mount(<Blocked />, L('Sayfa engellendi — AX Privacy', 'Page blocked — AX Privacy'));
