import { createColors } from 'picocolors';
import type { ScoreReport } from './score.js';
import { totalTokens } from './merge.js';
import { fmtCompact, fmtInt, fmtUsd } from './format.js';

const WIDTH = 46;

function topLanguage(byLang: Record<string, number>): string | null {
  let top: string | null = null;
  let max = -1;
  for (const [lang, n] of Object.entries(byLang)) if (n > max) { max = n; top = lang; }
  return top;
}

export function renderWrapped(
  report: ScoreReport,
  month: string,
  opts: { colors: boolean; version: string },
): string {
  const c = createColors(opts.colors);
  const s = report.stats;
  const tokens = totalTokens(s.tokens);
  const lines: string[] = [];

  lines.push(c.bold(c.magenta(`🎁 VIBE WRAPPED · ${month}`)));
  lines.push('');

  const quiet = s.commits === 0 && tokens === 0;
  if (quiet) {
    lines.push(c.dim('A quiet month — no commits or tokens in this window.'));
    lines.push(c.dim('Try another --month, or go ship something.'));
  } else {
    lines.push(`🔥 ${c.bold(fmtInt(s.commits))} commits · ${c.bold(String(s.streakDays))}-day streak`);
    if (s.busiestDay) lines.push(`📅 busiest day ${c.bold(s.busiestDay)} (${c.bold(fmtInt(s.busiestDayCount))} commits)`);
    if (s.lateNightCommits > 0) lines.push(`🌙 ${c.bold(fmtInt(s.lateNightCommits))} late-night commits`);
    const lang = topLanguage(s.locByLang);
    if (lang) lines.push(`🏆 top language: ${c.bold(lang)}`);
    if (tokens > 0) {
      lines.push(`🧠 ${c.bold(fmtCompact(tokens))} tokens · ${c.bold(fmtUsd(s.costUsd))} (Claude Code)`);
      if (report.tokPerUsd !== null) lines.push(`💸 ${c.bold(fmtCompact(report.tokPerUsd))} tok/$`);
    }
    if (report.achievements.length > 0) {
      lines.push('');
      lines.push(`unlocked: ${report.achievements.map((a) => `${a.emoji} ${a.title}`).join(' · ')}`);
    }
  }

  lines.push('');
  lines.push(c.dim('recap: Claude Code tokens + git activity for the month · npx viberuler wrapped'));

  const top = `┌${'─'.repeat(WIDTH)}┐`;
  const bottom = `└${'─'.repeat(WIDTH)}┘`;
  return [top, ...lines.map((l) => `│ ${l}`), bottom].join('\n');
}
