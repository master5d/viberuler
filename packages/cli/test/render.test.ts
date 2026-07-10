import { describe, it, expect } from 'vitest';
import { renderCard } from '../src/render.js';
import { computeScore } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

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
    expect(out).toContain('· bureau of vibe measurement');
    expect(out).toContain('THE BUREAU CERTIFIES: ');
    expect(out).toContain('— The Bureau · calibrated to ±0.001 vibes'); // sign-off boilerplate, mirrors the web certificate
    expect(out).not.toContain('RANK:');
    expect(out).not.toMatch(/\[/); // zero ANSI escapes in plain mode
  });

  it('certifies the uppercased rank via the Bureau line for a data-bearing report', () => {
    const stats = {
      ...emptyStats(),
      commits: 10, tokens: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
      costUsd: 3, sources: ['claude-code'],
    };
    const report = computeScore(stats);
    const out = renderCard(report, { colors: false, version: '0.1.0' });
    const rankDisplay = report.rank.toUpperCase();
    expect(out).toContain(`THE BUREAU CERTIFIES: ${rankDisplay}`);
  });

  it('keeps the NPC branch on the plain RANK line, no Bureau certification', () => {
    const out = renderCard(computeScore(emptyStats()), { colors: false, version: '0.1.0' });
    expect(out).toContain('RANK:');
    expect(out).not.toContain('THE BUREAU CERTIFIES:');
  });

  it('renders the ship-outcomes row (features, PRs, tok/feature) when present', () => {
    const stats = {
      ...emptyStats(),
      commits: 100, featsShipped: 12, prsMerged: 8,
      tokens: { input: 12_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 20,
      sources: ['git', 'claude-code'],
    };
    const out = stripAnsi(renderCard(computeScore(stats), { colors: false, version: '0.1.0' }));
    expect(out).toContain('12 features shipped');
    expect(out).toContain('8 PRs merged');
    expect(out).toContain('tok/feature'); // 12M / 12 = 1M tok/feature
  });

  it('omits the ship-outcomes row when no features or PRs were found', () => {
    const stats = { ...emptyStats(), commits: 50, tokens: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 3, sources: ['claude-code'] };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).not.toContain('features shipped');
    expect(out).not.toContain('PRs merged');
  });

  it('renders the per-agent token distribution strip with a legend when 2+ agents burned tokens', () => {
    const stats = {
      ...emptyStats(),
      commits: 10, tokens: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 3,
      tokensByAgent: { 'Claude Code': 600, Codex: 300, Antigravity: 100 }, sources: ['claude-code'],
    };
    const out = stripAnsi(renderCard(computeScore(stats), { colors: false, version: '0.1.0' }));
    expect(out).toContain('TOKENS BY AGENT');
    expect(out).toContain('Claude Code 60%');
    expect(out).toContain('Codex 30%');
    expect(out).toContain('Antigravity 10%');
    // legend is ordered largest share first
    expect(out.indexOf('Claude Code 60%')).toBeLessThan(out.indexOf('Codex 30%'));
  });

  it('shows <1% for a token-bearing agent below one percent, never 0%', () => {
    const stats = {
      ...emptyStats(),
      commits: 10, tokens: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 3,
      tokensByAgent: { 'Claude Code': 999_000, Codex: 1_000 }, sources: ['claude-code'],
    };
    const out = stripAnsi(renderCard(computeScore(stats), { colors: false, version: '0.1.0' }));
    expect(out).toContain('Codex <1%');
    expect(out).not.toContain('Codex 0%');
  });

  it('omits the strip when only one agent burned tokens', () => {
    const stats = {
      ...emptyStats(),
      commits: 10, tokens: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 3,
      tokensByAgent: { 'Claude Code': 1_000_000 }, sources: ['claude-code'],
    };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).not.toContain('TOKENS BY AGENT');
  });

  it('frames with a left rail and rounded caps, no right border (emoji-safe)', () => {
    const stats = {
      ...emptyStats(),
      projects: 47, commits: 8921, streakDays: 212, locTotal: 312_441,
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 4,
      sources: ['claude-code', 'git'], agents: ['Gemini CLI', 'Claude Code', 'Codex', 'Cursor'],
    };
    const lines = renderCard(computeScore(stats), { colors: false, version: '0.3.2' })
      .split('\n')
      .map(stripAnsi);
    expect(lines[0]).toBe('╭'); // top cap
    expect(lines[lines.length - 1]).toBe('╰'); // bottom cap
    // every interior line hangs off the rail; nothing carries a right border char
    for (const l of lines.slice(1, -1)) {
      expect(l.startsWith('│')).toBe(true);
      expect(l).not.toContain('╮');
      expect(l).not.toContain('╯');
    }
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
