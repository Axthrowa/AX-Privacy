import { L } from '../shared/i18n.ts';

const PASSWORD = 'input[type="password"]';
let active = false;
let banner: HTMLElement | undefined;
let observer: MutationObserver | undefined;

function lock(field: HTMLInputElement): void {
  field.value = '';
  field.readOnly = true;
  field.dataset.axLocked = '';
  if (document.activeElement === field) field.blur();
}

const lockAll = () => document.querySelectorAll<HTMLInputElement>(PASSWORD).forEach(lock);

const isPassword = (t: EventTarget | null): t is HTMLInputElement =>
  t instanceof HTMLInputElement && t.type === 'password';

function stopTyping(e: Event): void {
  if (!active || !isPassword(e.target)) return;
  e.preventDefault();
  lock(e.target);
}

/** A form that holds a password field does not send while sign-in is stopped. */
function stopSubmit(e: Event): void {
  if (!active || !(e.target instanceof HTMLFormElement) || !e.target.querySelector(PASSWORD))
    return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function unlock(): void {
  active = false;
  observer?.disconnect();
  banner?.remove();
  for (const field of document.querySelectorAll<HTMLInputElement>('input[data-ax-locked]')) {
    field.readOnly = false;
    delete field.dataset.axLocked;
  }
}

function showBanner(reasons: string[], allow: () => Promise<unknown>): void {
  banner = document.createElement('ax-login-guard');
  // Open is safe: the buttons act only on a real click (isTrusted), never on a script's.
  const root = banner.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; position: fixed; inset: 0 0 auto 0; z-index: 2147483647; }
    div { padding: 14px 18px; background: #7f1d1d; color: #fff; border-bottom: 3px solid #f87171;
      box-shadow: 0 6px 24px rgba(0,0,0,.45);
      font: 14px/1.45 -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
    strong { display: block; font-size: 16px; margin-bottom: 4px; }
    ul { margin: 6px 0 10px; padding-left: 20px; }
    button { margin-right: 8px; border-radius: 6px; padding: 6px 12px; font: inherit;
      font-weight: 600; cursor: pointer; border: 1px solid #fecaca; }
    .back { background: #fff; color: #7f1d1d; }
    .anyway { background: transparent; color: #fecaca; }`;
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  const title = document.createElement('strong');
  title.textContent = L(
    'AX Privacy: Bu site sahte olabilir, giriş durduruldu.',
    'AX Privacy: This site may be fake; sign-in was stopped.',
  );
  const list = document.createElement('ul');
  for (const r of reasons) {
    const li = document.createElement('li');
    li.textContent = r;
    list.append(li);
  }
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'back';
  back.textContent = L('Buradan çık', 'Leave this site');
  back.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    if (history.length > 1) history.back();
    else location.replace('about:blank');
  });
  const anyway = document.createElement('button');
  anyway.type = 'button';
  anyway.className = 'anyway';
  anyway.textContent = L(
    'Adresi kontrol ettim, yine de giriş yap',
    'I checked the address, sign in anyway',
  );
  anyway.addEventListener('click', (e) => {
    // Only a real click: the page's own script must not be able to lift the lock.
    if (!e.isTrusted) return;
    unlock();
    void allow().catch(() => undefined);
  });
  box.append(title, list, back, anyway);
  root.append(style, box);
  document.documentElement.append(banner);
}

/**
 * Stops sign-in on a page that looks fake: password fields are emptied and locked, forms holding
 * one do not send, and a banner says why. The user can lift it for the site with a real click.
 */
export function blockLogin(reasons: string[], allow: () => Promise<unknown>): void {
  if (active) return;
  active = true;
  lockAll();
  for (const type of ['keydown', 'beforeinput', 'paste', 'focusin']) {
    addEventListener(type, stopTyping, true);
  }
  addEventListener('submit', stopSubmit, true);
  observer = new MutationObserver(lockAll);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  showBanner(reasons, allow);
}
