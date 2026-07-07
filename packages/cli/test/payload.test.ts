import { describe, it, expect } from 'vitest';
import { buildPayload } from '../src/payload.js';
import { computeScore } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

describe('buildPayload', () => {
  const stats = {
    ...emptyStats(),
    projects: 3, commits: 50, streakDays: 10, locTotal: 5000,
    locByLang: { TypeScript: 5000 }, maxRepoLoc: 5000,
    tokens: { input: 1e6, output: 5e5, cacheWrite: 0, cacheRead: 0 },
    costUsd: 10, sources: ['git', 'claude-code'],
  };

  it('carries aggregates and rounded numbers only', () => {
    const p = buildPayload(computeScore(stats), '0.1.0');
    expect(p.client_version).toBe('0.1.0');
    expect(p.loc).toBe(5000);
    expect(p.projects).toBe(3);
    expect(p.tokens).toBe(1_500_000);
    expect(p.cost_usd).toBe(10);
    expect(p.tok_per_usd).toBe(150_000);
    expect(Array.isArray(p.achievements)).toBe(true);
    expect(typeof p.vibe_score).toBe('number');
  });

  it('leaks nothing beyond the fixed key set (privacy contract)', () => {
    const p = buildPayload(computeScore(stats), '0.1.0');
    expect(Object.keys(p).sort()).toEqual([
      'achievements', 'breakdown', 'client_version', 'cost_usd',
      'loc', 'projects', 'tok_per_usd', 'tokens', 'vibe_score',
    ]);
    // no locByLang, no paths, no repo names anywhere in the JSON
    const json = JSON.stringify(p);
    expect(json).not.toContain('TypeScript');
    expect(json).not.toContain('\\\\');
    expect(json).not.toContain('/home/');
  });

  it('serializes null tok_per_usd for zero-cost stats', () => {
    const p = buildPayload(computeScore({ ...emptyStats(), commits: 1, sources: ['git'] }), '0.1.0');
    expect(p.tok_per_usd).toBeNull();
  });
});
