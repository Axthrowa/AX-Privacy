// Page checks of the security module, kept apart from cosmetic filtering so that turning the
// cosmetic shield or a site's ad blocking off never turns them off too.
import {
  isSupportScam,
  loginBrandMismatch,
  passwordTarget,
} from '../engines/security/page-checks.ts';
import { send } from '../shared/messages.ts';
import { blockLogin } from './login-guard.ts';

// Isolated-world half of miner-guard.ts: passes its verdict to the background, once per frame.

let sent = 0;
document.addEventListener('ax-miner', (e) => {
  if (!(e instanceof CustomEvent) || sent >= 2) return;
  const verdict = e.detail as unknown;
  if (verdict !== 'stop' && verdict !== 'warn') return;
  sent++;
  void send('security/miner', { stopped: verdict === 'stop' }).catch(() => undefined);
});

// Password typed over plain http: checked at load and when a later-added field gets focus.
if (location.protocol === 'http:' && window === window.top) {
  let reported = false;
  const check = (el: unknown) => {
    if (reported || !(el instanceof HTMLInputElement) || el.type !== 'password') return;
    reported = true;
    void send('security/insecurePassword', {}).catch(() => undefined);
  };
  addEventListener('load', () => check(document.querySelector('input[type="password"]')), {
    once: true,
  });
  addEventListener('focusin', (e) => check(e.target), true);
}

// Fake "your PC is infected, call this number" pages: checked once the text has rendered. The
// forced fullscreen that makes them look like the desktop is undone; the popup explains why.
if (window === window.top) {
  addEventListener(
    'load',
    () =>
      setTimeout(() => {
        const text = document.body?.innerText.slice(0, 20_000) ?? '';
        if (!isSupportScam(text)) return;
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        void send('security/supportScam', {}).catch(() => undefined);
      }, 1500),
    { once: true },
  );
}

/** What a sign-in page says it is: its title, site name and logo text, never the body. */
function claimedName(): string {
  const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content ?? '';
  const logos = [...document.images]
    // "Sign in with Google" buttons carry small brand icons; the site's own logo is larger.
    .filter(
      (img) =>
        /logo/i.test(`${img.alt} ${img.className} ${img.id} ${img.src}`) &&
        img.width >= 48 &&
        !img.closest('button, [role="button"]'),
    )
    .slice(0, 3)
    .map((img) => `${img.alt} ${img.src.split('/').pop() ?? ''}`);
  return [
    document.title,
    meta('meta[property="og:site_name"]'),
    meta('meta[name="application-name"]'),
    ...logos,
  ]
    .join(' ')
    .slice(0, 500);
}

// Sign-in on a fake-looking site (lookalike or fake government address, a page dressed as a brand
// it is not on) is stopped. Asked only on pages with a password field, so others never wake the
// worker; at load too, because password managers fill fields without focusing them. Every frame:
// a sign-in form inside an iframe is locked in place.
{
  let checked = false;
  const check = () => {
    if (checked) return;
    checked = true;
    const brand = loginBrandMismatch(location.href, claimedName());
    void send('security/login', { brand })
      .then((v) => {
        if (v.block) blockLogin(v.reasons, () => send('security/allowLogin', {}));
      })
      .catch(() => undefined);
  };
  addEventListener(
    'focusin',
    (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'password') check();
    },
    true,
  );
  const early = () => {
    if (document.querySelector('input[type="password"]')) check();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', early, { once: true });
  } else early();
}

// A password form posting to another site: reported once, when a password field gets focus.
if (window === window.top) {
  let reported = false;
  addEventListener(
    'focusin',
    (e) => {
      const field = e.target;
      if (reported || !(field instanceof HTMLInputElement) || field.type !== 'password') return;
      const action = field.form?.getAttribute('action');
      const host = action ? passwordTarget(location.href, field.form?.action ?? '') : null;
      if (!host) return;
      reported = true;
      void send('security/passwordElsewhere', { host }).catch(() => undefined);
    },
    true,
  );
}
