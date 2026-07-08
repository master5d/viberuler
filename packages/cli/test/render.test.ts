import { describe, it, expect } from 'vitest';
import { renderCard } from '../src/render.js';
import { computeScore } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

describe('renderCard', () => {
  it('renders a stable plain card (golden)', () => {
    const stats = {
      ...emptyStats(),
      projects: 47, commits: 8921, streakDays: 212,
      locTotal: 312_441, locByLang: { TypeScript: 300_000, Rust: 12_441 }, maxRepoLoc: 200_000,
      tokens: { input: 200_000_000, output: 100_000_000, cacheWrite: 300_000_000, cacheRead: 600_000_000 },
      costUsd: 184.2, sources: ['claude-code', 'git'],
    };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).toContain('VIBERULER v0.1.0');
    expect(out).toContain('47 projects');
    expect(out).toContain('312,441 LoC');
    expect(out).toContain('1.2B tokens');
    expect(out).toContain('$184.20 burned');
    expect(out).toContain('tok/$');
    expect(out).toContain('VIBE SCORE');
    expect(out).toContain('RANK:');
    expect(out).not.toMatch(/\[/); // zero ANSI escapes in plain mode
  });

  it('renders the agents stable line, truncated past three', () => {
    const stats = {
      ...emptyStats(),
      commits: 10, tokens: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
      costUsd: 3, sources: ['claude-code'],
      agents: ['Claude Code', 'Codex', 'Antigravity', 'Cursor', 'Aider'],
    };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).toContain('🤖 5 agents in the stable · Claude Code · Codex · Antigravity +2 more');
  });

  it('omits the agents line when none are detected', () => {
    const stats = { ...emptyStats(), commits: 10, sources: ['git'] };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).not.toContain('agents in the stable');
  });

  it('renders NPC guidance when no data was found', () => {
    const out = renderCard(computeScore(emptyStats()), { colors: false, version: '0.1.0' });
    expect(out).toContain('NPC (no vibes detected)');
    expect(out).toContain('viberuler --scan-dir');
  });

  it('emits ANSI colors when enabled', () => {
    const out = renderCard(computeScore(emptyStats()), { colors: true, version: '0.1.0' });
    expect(out).toMatch(/\[/);
  });

  it('renders the shipped-efficiency line when LoC is present', () => {
    const stats = {
      ...emptyStats(), commits: 10, locTotal: 1000, sources: ['claude-code', 'git'],
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 4,
    };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).toContain('🎯 2K tok / line shipped');
  });

  it('omits the shipped-efficiency line when there is no LoC', () => {
    const stats = {
      ...emptyStats(), commits: 10, locTotal: 0, sources: ['claude-code'],
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 4,
    };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).not.toContain('line shipped');
  });
});
