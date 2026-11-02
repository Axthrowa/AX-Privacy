import { useState } from 'react';
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
        <h1>Bu sayfa engellendi</h1>
      </header>
      <p className="url">{url}</p>
      <p>
        Adres <strong>{list}</strong> listesinde zararlı, kimlik avı veya istenmeyen bir site olarak
        kayıtlı. AX Privacy sayfayı açmadan durdurdu.
      </p>
      <p className="note">
        Listeler hatalı kayıt içerebilir ve listede olmayan bir site de zararlı olabilir. Siteyi
        tanıyor ve güveniyorsanız devam edebilirsiniz; izin bu tarayıcı oturumu boyunca bu alan adı
        için geçerli olur.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" onClick={leave}>
          Güvenli tarafa dön
        </button>
        {isWeb && (
          <button type="button" className="secondary" onClick={() => void proceed()}>
            Riski anlıyorum, yine de devam et
          </button>
        )}
      </div>
    </main>
  );
}

mount(<Blocked />);
