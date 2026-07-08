import { describe, it, expect } from 'vitest';
import { emptyStats, mergeStats, totalTokens } from '../src/merge.js';

describe('emptyStats', () => {
  it('starts at zero everywhere', () => {
    const s = emptyStats();
    expect(s.projects).toBe(0);
    expect(s.tokens).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(s.locByLang).toEqual({});
    expect(s.sources).toEqual([]);
  });
});

describe('totalTokens', () => {
  it('sums all four buckets', () => {
    expect(totalTokens({ input: 1, output: 2, cacheWrite: 3, cacheRead: 4 })).toBe(10);
  });
});

describe('mergeStats', () => {
  it('sums numerics, maxes streak/maxRepoLoc, merges maps, concats arrays', () => {
    const a = mergeStats(emptyStats(), {
      projects: 2, commits: 10, streakDays: 5, locTotal: 100,
      locByLang: { TypeScript: 100 }, maxRepoLoc: 100,
      tokens: { input: 10, output: 20, cacheWrite: 0, cacheRead: 0 },
      costUsd: 1.5, sources: ['git'],
    });
    const b = mergeStats(a, {
      projects: 1, commits: 5, streakDays: 3, locTotal: 50,
      locByLang: { TypeScript: 30, Rust: 20 }, maxRepoLoc: 50,
      tokens: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 },
      costUsd: 0.5, sources: ['claude-code'], warnings: ['w1'],
    });
    expect(b.projects).toBe(3);
    expect(b.commits).toBe(15);
    expect(b.streakDays).toBe(5);           // max, not sum
    expect(b.maxRepoLoc).toBe(100);          // max, not sum
    expect(b.locTotal).toBe(150);
    expect(b.locByLang).toEqual({ TypeScript: 130, Rust: 20 });
    expect(b.tokens).toEqual({ input: 11, output: 22, cacheWrite: 3, cacheRead: 4 });
    expect(b.costUsd).toBeCloseTo(2.0);
    expect(b.sources).toEqual(['git', 'claude-code']);
    expect(b.warnings).toEqual(['w1']);
  });

  it('unions agents without duplicates', () => {
    const a = mergeStats(emptyStats(), { agents: ['Claude Code', 'Codex'] });
    const b = mergeStats(a, { agents: ['Codex', 'Cursor'] });
    expect(b.agents).toEqual(['Claude Code', 'Codex', 'Cursor']);
  });

  it('does not mutate the base', () => {
    const base = emptyStats();
    mergeStats(base, { projects: 5 });
    expect(base.projects).toBe(0);
  });
});
