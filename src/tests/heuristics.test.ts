import { describe, expect, it } from 'vitest';
import { analyzeUrl, assessRisk, punycodeDecode } from '../engines/security/heuristics.ts';

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
