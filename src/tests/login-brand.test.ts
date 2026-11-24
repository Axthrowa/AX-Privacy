import { describe, expect, it } from 'vitest';
import { brandsNamed, loginBrandMismatch } from '../engines/security/page-checks.ts';
import { assessRisk } from '../engines/security/heuristics.ts';
import { parseMessage } from '../shared/messages.ts';

describe('sign-in page brand check', () => {
  it('reads brand names as words, written apart and with Turkish letters', () => {
    expect(brandsNamed('Garanti BBVA İnternet Şubesi')).toEqual(['garantibbva']);
    expect(brandsNamed('e-Devlet Kapısı Giriş')).toEqual(['edevlet']);
    expect(brandsNamed('Sign in - Google Accounts')).toEqual(['google']);
    // Inside another word is not a mention.
    expect(brandsNamed('Pineapple recipes')).toEqual([]);
  });

  it('flags a page named for a brand only off that brand’s domains', () => {
    expect(loginBrandMismatch('https://garanti-guvenli.xyz/giris', 'Garanti BBVA Giriş')).toBe(
      'garantibbva',
    );
    expect(loginBrandMismatch('https://sube.garantibbva.com.tr/', 'Garanti BBVA Giriş')).toBeNull();
    expect(
      loginBrandMismatch('https://accounts.google.com/', 'Sign in - Google Accounts'),
    ).toBeNull();
    expect(loginBrandMismatch('https://shop.example/login', 'Example Shop - Log in')).toBeNull();
  });

  it('accepts only known brands from the page and reports a high finding', () => {
    expect(parseMessage({ type: 'security/loginBrand', brand: 'paypal' })).toEqual({
      type: 'security/loginBrand',
      brand: 'paypal',
    });
    expect(parseMessage({ type: 'security/loginBrand', brand: 'anything' })).toBeNull();
    expect(parseMessage({ type: 'security/loginBrand', brand: '__proto__' })).toBeNull();
    const r = assessRisk('https://paypal-help.example/', {
      insecurePassword: false,
      bypassed: false,
      loginBrand: 'paypal',
    });
    expect(r.level).toBe('high');
    expect(r.findings[0]?.id).toBe('login-brand');
  });
});
