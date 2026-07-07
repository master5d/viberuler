import { describe, it, expect } from 'vitest';
import { longestStreak } from '../src/streak.js';

describe('longestStreak', () => {
  it('returns 0 for no days', () => {
    expect(longestStreak([])).toBe(0);
  });
  it('returns 1 for a single day', () => {
    expect(longestStreak(['2026-01-15'])).toBe(1);
  });
  it('counts consecutive runs and ignores duplicates/order', () => {
    expect(longestStreak(['2026-01-03', '2026-01-01', '2026-01-02', '2026-01-02'])).toBe(3);
  });
  it('picks the longest of several runs', () => {
    expect(longestStreak(['2026-01-01', '2026-01-02', '2026-02-10', '2026-02-11', '2026-02-12'])).toBe(3);
  });
  it('handles month and year boundaries', () => {
    expect(longestStreak(['2025-12-31', '2026-01-01'])).toBe(2);
  });
});
