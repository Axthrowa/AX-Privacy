import { describe, expect, it } from 'vitest';
import { govClaim, officialGov } from '../engines/security/official.ts';
import { analyzeUrl, assessRisk, loginBlockers } from '../engines/security/heuristics.ts';

const page = { insecurePassword: false, bypassed: false };

describe('official government sites', () => {
  it('knows government zones of every country', () => {
    expect(officialGov('www.turkiye.gov.tr')).toBe('gov.tr');
    expect(officialGov('ankara.bel.tr')).toBe('bel.tr');
    expect(officialGov('www.egm.pol.tr')).toBe('pol.tr');
    expect(officialGov('www.gov.uk')).toBe('gov.uk');
    expect(officialGov('www.usa.gov')).toBe('gov');
    expect(officialGov('service-public.gouv.fr')).toBe('gouv.fr');
    expect(officialGov('www.gob.mx')).toBe('gob.mx');
    expect(officialGov('www.digital.go.jp')).toBe('go.jp');
    expect(officialGov('www.govt.nz')).toBe('govt.nz');
    expect(officialGov('www.admin.ch')).toBe('admin.ch');
    expect(officialGov('commission.europa.eu')).toBe('europa.eu');
  });

  it('does not take look-alike addresses for official ones', () => {
    expect(officialGov('www.turkiye.gov.tr.giris-yap.com')).toBeNull();
    expect(officialGov('turkiye-gov-tr.com')).toBeNull();
    expect(officialGov('x.go.co')).toBeNull();
    expect(officialGov('example.com')).toBeNull();
  });

  it('finds government words in other addresses', () => {
    expect(govClaim('turkiye-gov-tr.com')).toBe('gov');
    expect(govClaim('www.turkiye.gov.tr.giris-yap.com')).toBe('gov');
    expect(govClaim('edevletgiris.net')).toBe('edevlet');
    expect(govClaim('e-devlet-iade.com')).toBe('devlet');
    expect(govClaim('hmrc-government-refund.co')).toBe('government');
    // Ordinary words that only contain the letters stay alone.
    expect(govClaim('govee.com')).toBeNull();
    expect(govClaim('gouvernance-conseil.fr')).toBeNull();
    expect(govClaim('example.com')).toBeNull();
  });
});

describe('fake government addresses', () => {
  it('warns high on a non-government address claiming to be one', () => {
    const f = analyzeUrl('https://turkiye-gov-tr.com/giris');
    expect(f.map((x) => x.id)).toContain('fake-gov');
    expect(f.find((x) => x.id === 'fake-gov')?.severity).toBe('high');
    expect(analyzeUrl('https://www.turkiye.gov.tr.odeme-iade.net/').map((x) => x.id)).toContain(
      'fake-gov',
    );
  });

  it('reports the official zone and finds nothing on a real government site', () => {
    const r = assessRisk('https://www.turkiye.gov.tr/', page);
    expect(r).toEqual({ level: 'none', findings: [], official: 'gov.tr' });
    // Over http the page is not known to come from the official server.
    expect(assessRisk('http://www.turkiye.gov.tr/', page).official).toBeNull();
    expect(assessRisk('https://example.com/', page).official).toBeNull();
  });
});

describe('sign-in blocking', () => {
  it('stops sign-in on fake addresses and pages dressed as a brand', () => {
    const ids = (url: string, loginBrand: string | null = null) =>
      loginBlockers(assessRisk(url, { ...page, loginBrand })).map((f) => f.id);
    expect(ids('https://turkiye-gov-tr.com/')).toContain('fake-gov');
    expect(ids('https://paypa1.com/')).toContain('lookalike');
    expect(ids('https://paypal-help.example/', 'paypal')).toContain('login-brand');
  });

  it('leaves real sites and weak signs alone', () => {
    const blockers = (url: string) => loginBlockers(assessRisk(url, page));
    expect(blockers('https://www.turkiye.gov.tr/')).toEqual([]);
    expect(blockers('https://accounts.google.com/')).toEqual([]);
    expect(blockers('https://shop.example/login')).toEqual([]);
    // A password form posting elsewhere is single sign-on as often as phishing.
    expect(
      loginBlockers(
        assessRisk('https://shop.example/', { ...page, passwordTarget: 'sso.example' }),
      ),
    ).toEqual([]);
  });
});
