import { createColors } from 'picocolors';
import type { ScoreReport } from './score.js';
import { totalTokens } from './merge.js';
import { fmtCompact, fmtInt, fmtUsd } from './format.js';

const WIDTH = 46; // inner width of the card

function bar(vibe: number): string {
  const cells = 16;
  const filled = Math.max(0, Math.min(cells, Math.round((vibe / 8000) * cells)));
  return '▓'.repeat(filled) + '░'.repeat(cells - filled);
}

export function renderCard(report: ScoreReport, opts: { colors: boolean; version: string }): string {
  const c = createColors(opts.colors);
  const s = report.stats;
  const tokens = totalTokens(s.tokens);
  const lines: string[] = [];

  lines.push(c.bold(c.magenta(`VIBERULER v${opts.version}`)));
  lines.push(c.dim('· bureau of vibe measurement'));
  lines.push('');

  if (report.rank === 'NPC (no vibes detected)') {
    lines.push(c.dim('No vibes detected on this rig.'));
    lines.push(c.dim('Try: viberuler --scan-dir <path-to-your-code>'));
    lines.push(c.dim('     (and make sure git user.email is set)'));
  } else {
    lines.push(`⚡ ${c.bold(fmtInt(s.projects))} projects · ${c.bold(fmtInt(s.locTotal))} LoC shipped`);
    lines.push(`🧠 ${c.bold(fmtCompact(tokens))} tokens · ${c.bold(fmtUsd(s.costUsd))} burned`);
    if (report.tokPerUsd !== null) {
      const pct = Math.round((1 - report.effPercentile) * 100);
      lines.push(`💸 ${c.bold(fmtCompact(report.tokPerUsd))} tok/$ · TOP ${c.bold(String(Math.max(1, pct)))}% (est.)`);
    }
    if (report.tokPerLoc !== null) {
      lines.push(`🎯 ${c.bold(fmtCompact(report.tokPerLoc))} tok / line shipped`);
    }
    if (s.commits > 0) lines.push(`🔥 ${c.bold(String(s.streakDays))}-day streak · ${c.bold(fmtInt(s.commits))} commits`);
    if (s.ghStars > 0) lines.push(`⭐ ${c.bold(fmtInt(s.ghStars))} GitHub stars`);
    if (s.agents.length > 0) {
      const shown = s.agents.slice(0, 3).join(' · ');
      const extra = s.agents.length > 3 ? ` +${s.agents.length - 3} more` : '';
      lines.push(`🤖 ${c.bold(String(s.agents.length))} agents in the stable · ${shown}${extra}`);
    }
  }

  lines.push('');
  lines.push(`VIBE SCORE ${c.magenta(bar(report.vibe))}  ${c.bold(fmtInt(report.vibe))}`);
  const rankDisplay = report.rank === 'NPC (no vibes detected)' ? report.rank : report.rank.toUpperCase();
  if (report.rank === 'NPC (no vibes detected)') {
    lines.push(`RANK: ${c.bold(c.cyan(rankDisplay))}`);
  } else {
    lines.push(`THE BUREAU CERTIFIES: ${c.bold(c.cyan(rankDisplay))}`);
  }

  if (report.achievements.length > 0) {
    lines.push('');
    lines.push(report.achievements.map((a) => `${a.emoji} ${a.title}`).join(' · '));
  }

  const top = `┌${'─'.repeat(WIDTH)}┐`;
  const bottom = `└${'─'.repeat(WIDTH)}┘`;
  return [top, ...lines.map((l) => `│ ${l}`), bottom].join('\n');
}
