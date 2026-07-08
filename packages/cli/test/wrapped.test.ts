import { describe, it, expect } from 'vitest';
import { renderWrapped } from '../src/wrapped.js';
import { computeScore } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

describe('renderWrapped', () => {
  it('renders the month, commits, busiest day, streak, and tokens', () => {
    const stats = {
      ...emptyStats(), commits: 132, streakDays: 16, lateNightCommits: 9,
      busiestDay: '2026-06-14', busiestDayCount: 22,
      locByLang: { TypeScript: 9000, Rust: 1000 },
      tokens: { input: 5_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 }, costUsd: 12,
      sources: ['claude-code', 'git'],
    };
    const out = renderWrapped(computeScore(stats), '2026-06', { colors: false, version: '0.3.0' });
    expect(out).toContain('VIBE WRAPPED');
    expect(out).toContain('2026-06');
    expect(out).toContain('132'); // commits
    expect(out).toContain('2026-06-14'); // busiest day
    expect(out).toContain('16'); // streak
    expect(out).toContain('TypeScript'); // top language
    expect(out).not.toMatch(/\[/); // no ANSI in plain mode
  });

  it('handles an empty month gracefully', () => {
    const out = renderWrapped(computeScore(emptyStats()), '2026-01', { colors: false, version: '0.3.0' });
    expect(out).toContain('2026-01');
    expect(out).toMatch(/quiet month|no vibes|nothing/i);
  });
});
