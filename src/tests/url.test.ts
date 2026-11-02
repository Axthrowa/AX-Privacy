import { describe, expect, it } from 'vitest';
import { hostMatches, isValidSite } from '../shared/site.ts';
import { siteKey } from '../shared/url.ts';

describe('siteKey', () => {
  it('returns eTLD+1 for normal hosts', () => {
    expect(siteKey('https://www.news.bbc.co.uk/path')).toBe('bbc.co.uk');
    expect(siteKey('http://sub.example.com:8080/')).toBe('example.com');
  });
  it('keeps private-suffix sites separate', () => {
    expect(siteKey('https://alice.github.io/')).toBe('alice.github.io');
  });
  it('returns IPs and single-label hosts as-is', () => {
    expect(siteKey('http://127.0.0.1:3000/')).toBe('127.0.0.1');
    expect(siteKey('http://localhost/')).toBe('localhost');
  });
  it('rejects non-web URLs', () => {
    expect(siteKey('chrome://extensions')).toBeNull();
    expect(siteKey('file:///C:/x.html')).toBeNull();
    expect(siteKey('not a url')).toBeNull();
    expect(siteKey(undefined)).toBeNull();
  });
});

describe('isValidSite', () => {
  it('accepts hostnames and IPv4', () => {
    expect(isValidSite('example.com')).toBe(true);
    expect(isValidSite('xn--bcher-kva.example')).toBe(true);
    expect(isValidSite('10.0.0.1')).toBe(true);
  });
  it('rejects patterns, URLs and injection attempts', () => {
    for (const bad of [
      '*.example.com',
      'https://a.com',
      'a.com/x',
      'A.COM',
      '',
      'a..com',
      '-a.com',
      42,
    ]) {
      expect(isValidSite(bad)).toBe(false);
    }
  });
});

describe('hostMatches', () => {
  it('matches the domain and its subdomains only', () => {
    expect(hostMatches('example.com', 'example.com')).toBe(true);
    expect(hostMatches('a.example.com', 'example.com')).toBe(true);
    expect(hostMatches('badexample.com', 'example.com')).toBe(false);
  });
});
