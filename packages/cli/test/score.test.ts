import { describe, it, expect } from 'vitest';
import { computeScore, offlinePercentile, rankFor } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

describe('offlinePercentile', () => {
  it('clamps below and above the curve', () => {
    expect(offlinePercentile(1)).toBeCloseTo(0.05);
    expect(offlinePercentile(1e12)).toBeCloseTo(0.99);
  });
  it('hits anchor points exactly', () => {
    expect(offlinePercentile(1e6)).toBeCloseTo(0.5);
  });
  it('interpolates between anchors', () => {
    const mid = offlinePercentile(10 ** 5.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.5);
  });
  it('returns 0 for non-positive input', () => {
    expect(offlinePercentile(0)).toBe(0);
  });
});

describe('rankFor', () => {
  it('maps thresholds', () => {
    expect(rankFor(0, false)).toBe('NPC (no vibes detected)');
    expect(rankFor(100, true)).toBe('Prompt Peasant');
    expect(rankFor(800, true)).toBe('Vibe Apprentice');
    expect(rankFor(2000, true)).toBe('Token Burner');
    expect(rankFor(3500, true)).toBe('Context Goblin');
    expect(rankFor(5000, true)).toBe('Ship Machine');
    expect(rankFor(6500, true)).toBe('GIGACHAD SHIPPER');
    expect(rankFor(8000, true)).toBe('Singularity Adjacent');
  });
});

describe('computeScore', () => {
  it('zero stats -> NPC with vibe 0', () => {
    const r = computeScore(emptyStats());
    expect(r.vibe).toBe(0);
    expect(r.rank).toBe('NPC (no vibes detected)');
    expect(r.tokPerUsd).toBeNull();
  });

  it('computes each component per the published formula', () => {
    const stats = {
      ...emptyStats(),
      locTotal: 9_000,                 // volume = 1000*log10(10) = 1000
      projects: 0,
      commits: 1,
      sources: ['git'],
      tokens: { input: 999_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, // leverage = 500*log10(1000) = 1500
      costUsd: 999,                    // tok/$ ≈ 1e6 -> percentile ~0.5 -> efficiency ~400
    };
    const r = computeScore(stats);
    expect(r.breakdown.volume).toBeCloseTo(1000, 0);
    expect(r.breakdown.leverage).toBeCloseTo(1500, 0);
    expect(r.breakdown.efficiency).toBeCloseTo(400, 0);
    expect(r.breakdown.breadth).toBe(0);
    expect(r.vibe).toBe(Math.round(
      r.breakdown.volume + r.breakdown.leverage + r.breakdown.efficiency +
      r.breakdown.breadth + r.breakdown.streak + r.breakdown.achievements,
    ));
  });

  it('caps streak bonus at 365 and honors percentile override', () => {
    const stats = { ...emptyStats(), streakDays: 500, commits: 1, sources: ['git'], costUsd: 1,
      tokens: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 } };
    const r = computeScore(stats, 1.0);
    expect(r.breakdown.streak).toBe(365);
    expect(r.breakdown.efficiency).toBeCloseTo(800);
    expect(r.effPercentile).toBe(1.0);
  });

  it('efficiency is 0 when cost is 0 (no division by zero)', () => {
    const stats = { ...emptyStats(), commits: 1, sources: ['git'],
      tokens: { input: 1e6, output: 0, cacheWrite: 0, cacheRead: 0 } };
    const r = computeScore(stats);
    expect(r.breakdown.efficiency).toBe(0);
    expect(r.tokPerUsd).toBeNull();
  });

  it('derives tokPerLoc = tokens / locTotal', () => {
    const stats = {
      ...emptyStats(), commits: 1, sources: ['git'], locTotal: 1000,
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
    };
    // 2,000,000 tokens / 1000 LoC = 2000 tok per line
    expect(computeScore(stats).tokPerLoc).toBeCloseTo(2000, 6);
  });

  it('tokPerLoc is null when locTotal is 0 (no division by zero)', () => {
    const stats = {
      ...emptyStats(), commits: 1, sources: ['git'], locTotal: 0,
      tokens: { input: 5_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
    };
    expect(computeScore(stats).tokPerLoc).toBeNull();
  });

  it('tokPerLoc does NOT change the VIBE score (display-only)', () => {
    const base = { ...emptyStats(), commits: 1, sources: ['git'], locTotal: 0,
      tokens: { input: 4_000_000, output: 0, cacheWrite: 0, cacheRead: 0 } };
    const withLoc = { ...base, locTotal: 500 };
    // adding LoC changes volume (that's expected), so isolate: same locTotal, the
    // tokPerLoc field itself must not feed the formula — compare vibe computed from
    // breakdown only.
    const r = computeScore(withLoc);
    expect(r.vibe).toBe(Math.round(
      r.breakdown.volume + r.breakdown.leverage + r.breakdown.efficiency +
      r.breakdown.breadth + r.breakdown.streak + r.breakdown.achievements,
    ));
  });
});
