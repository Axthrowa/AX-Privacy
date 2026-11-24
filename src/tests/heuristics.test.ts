import { describe, expect, it } from 'vitest';
import {
  analyzeUrl,
  assessRisk,
  isSupportScam,
  passwordTarget,
  punycodeDecode,
} from '../engines/security/heuristics.ts';

const ids = (url: string) => analyzeUrl(url).map((f) => f.id);

describe('punycodeDecode', () => {
  it('decodes RFC 3492 labels', () => {
    expect(punycodeDecode('pple-43d')).toBe('аpple');
    expect(punycodeDecode('mnchen-3ya')).toBe('münchen');
    expect(punycodeDecode('80ak6aa92e')).toBe('аррӏе');
  });

  it('rejects malformed input', () => {
    expect(punycodeDecode('abc-!!')).toBeNull();
  });
});

describe('analyzeUrl', () => {
  it('reports nothing for official and unrelated sites', () => {
    expect(ids('https://www.paypal.com/signin')).toEqual([]);
    expect(ids('https://accounts.google.com/')).toEqual([]);
    expect(ids('https://google.de/')).toEqual([]);
    expect(ids('https://finance.yahoo.com/')).toEqual([]);
    expect(ids('https://münchen.de/')).toEqual([]);
    expect(ids('http://192.168.1.1/')).toEqual([]);
    expect(ids('chrome://settings')).toEqual([]);
    expect(ids('not a url')).toEqual([]);
  });

  it('flags homographs', () => {
    expect(ids('https://xn--pple-43d.com/')).toEqual(['homograph', 'lookalike']);
    expect(ids('https://xn--80ak6aa92e.com/')).toContain('homograph');
  });

  it('flags typos and digit swaps of brands', () => {
    expect(ids('https://paypa1.com/')).toEqual(['lookalike']);
    expect(ids('https://amaz0n.net/')).toEqual(['lookalike']);
    expect(ids('https://gooogle.com/')).toEqual(['lookalike']);
  });

  it('flags brands outside the official domain', () => {
    expect(ids('https://paypal-login.example/')).toEqual(['brand-in-name']);
    expect(ids('https://paypal.com.secure-check.example/')).toEqual(['brand-subdomain']);
  });

  it('flags userinfo tricks and raw public IPs', () => {
    expect(ids('https://www.paypal.com@evil.example/')).toEqual(['userinfo']);
    expect(ids('http://203.0.113.9/login')).toEqual(['ip-host']);
  });
});

describe('assessRisk', () => {
  it('never claims safety when nothing is found', () => {
    expect(
      assessRisk('https://example.com/', { insecurePassword: false, bypassed: false }),
    ).toEqual({
      level: 'none',
      findings: [],
      official: null,
    });
  });

  it('takes the worst finding', () => {
    expect(
      assessRisk('https://paypal-login.example/', { insecurePassword: true, bypassed: false })
        .level,
    ).toBe('medium');
    const r = assessRisk(null, { insecurePassword: false, bypassed: true });
    expect(r.level).toBe('high');
    expect(r.findings[0]?.id).toBe('warning-bypassed');
  });
});

describe('passwordTarget', () => {
  it('names the host only when the form posts to another site', () => {
    expect(passwordTarget('https://www.bank.example/login', 'https://evil.test/collect.php')).toBe(
      'evil.test',
    );
    expect(passwordTarget('https://www.bank.example/login', '/session')).toBeNull();
    expect(
      passwordTarget('https://www.bank.example/login', 'https://auth.bank.example/'),
    ).toBeNull();
    expect(passwordTarget('https://shop.co.uk/login', 'https://other.co.uk/x')).toBe('other.co.uk');
    expect(passwordTarget('https://a.example/', 'javascript:void 0')).toBeNull();
    expect(passwordTarget('https://a.example/', 'mailto:x@y.z')).toBeNull();
  });

  it('adds a low-severity finding naming the target', () => {
    const r = assessRisk('https://a.example/', {
      insecurePassword: false,
      bypassed: false,
      passwordTarget: 'evil.test',
    });
    expect(r.level).toBe('low');
    expect(r.findings.map((f) => f.id)).toEqual(['password-elsewhere']);
    expect(r.findings[0]?.text).toContain('evil.test');
  });
});

describe('isSupportScam', () => {
  it('flags fake infection alerts that push a phone number', () => {
    expect(
      isSupportScam(
        'Windows Defender Security Center. Your computer has been blocked. Error code: 0x80070424. Call toll free +1 (888) 555-0199. Do not close this page.',
      ),
    ).toBe(true);
    expect(
      isSupportScam(
        'Bilgisayarınız kilitlendi! Virüs tespit edildi. Hemen arayın: 0850 123 45 67. Bu sayfayı kapatmayın.',
      ),
    ).toBe(true);
  });

  it('leaves real support pages and news alone', () => {
    // A phone number with one scary word is not enough.
    expect(isSupportScam('Microsoft Support: call 0850 222 00 00 for your licence.')).toBe(false);
    expect(
      isSupportScam('A new virus variant spreads in Europe, health officials said on Monday.'),
    ).toBe(false);
    expect(
      isSupportScam('Antivirus review: Windows Defender catches malware well. Score 9.1/10.'),
    ).toBe(false);
  });
});
