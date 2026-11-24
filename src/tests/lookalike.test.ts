import { describe, expect, it } from 'vitest';
import {
  analyzeUrl,
  editDistanceWithin,
  popularLookalike,
} from '../engines/security/heuristics.ts';
import POPULAR from '../engines/security/brands.json' with { type: 'json' };

describe('lookalike domains of popular sites', () => {
  it('measures edit distance up to a bound', () => {
    expect(editDistanceWithin('booking', 'booking', 2)).toBe(0);
    expect(editDistanceWithin('booking', 'bokking', 2)).toBe(1);
    expect(editDistanceWithin('booking', 'boikinq', 2)).toBe(2);
    expect(editDistanceWithin('booking', 'xx', 2)).toBe(3);
  });

  it('ships about 5,000 names, each with its real domains', () => {
    expect(POPULAR.length).toBeGreaterThan(4500);
    expect(POPULAR.length).toBeLessThanOrEqual(5000);
    for (const [label, domains] of POPULAR as [string, string[]][]) {
      expect(label.length).toBeGreaterThanOrEqual(6);
      expect(domains.length).toBeGreaterThan(0);
    }
  });

  it('flags one edit on short names and two on long ones, never the real site', () => {
    expect(popularLookalike('bokking', 'bokking.com')).toBe('booking');
    expect(popularLookalike('booking', 'booking.com')).toBeNull();
    // Two edits on a 7-letter name is too loose.
    expect(popularLookalike('boikinq', 'boikinq.com')).toBeNull();
    const long = (POPULAR as [string, string[]][]).find(([l]) => l.length >= 10)?.[0] ?? '';
    const twoOff = `${long.slice(0, 2)}${long.slice(3, -1)}zz`;
    if (editDistanceWithin(twoOff, long, 2) <= 2) {
      expect(popularLookalike(twoOff, `${twoOff}.com`)).not.toBeNull();
    }
  });

  it('reports a near miss as a low finding on the address', () => {
    const f = analyzeUrl('https://www.bokking.com/login');
    expect(f.find((x) => x.id === 'lookalike-popular')?.severity).toBe('low');
    expect(analyzeUrl('https://www.booking.com/').some((x) => x.id === 'lookalike-popular')).toBe(
      false,
    );
  });
});
