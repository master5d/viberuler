import { createColors } from 'picocolors';
import type { ScoreReport } from './score.js';
import { totalTokens } from './merge.js';
import { fmtCompact, fmtInt, fmtUsd } from './format.js';

const MIN_WIDTH = 44;
const MAX_WIDTH = 74;
const BAR_CELLS = 16;

const ESC = '';
// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// Terminal cell width: emoji and CJK occupy two columns; VS16/ZWJ/combining
// marks occupy zero. Needed so the framed box aligns its right border.
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2300 && cp <= 0x23ff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff)
  );
}
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfe0f || cp === 0x200d || (cp >= 0x0300 && cp <= 0x036f)) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

const VIOLET: [number, number, number] = [179, 136, 255];
const GREEN: [number, number, number] = [105, 240, 174];
const RESET = `${ESC}[0m`;
const supportsTruecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '');

function lerp(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `${ESC}[38;2;${r};${g};${bl}m`;
}

// violet→green gradient across the characters; null when the terminal can't do
// 24-bit color (caller falls back to a flat color).
function gradient(text: string, colors: boolean): string | null {
  if (!colors || !supportsTruecolor) return null;
  const chars = [...text];
  const n = chars.length;
  return chars.map((ch, i) => lerp(VIOLET, GREEN, n <= 1 ? 0 : i / (n - 1)) + ch).join('') + RESET;
}

function bar(vibe: number, colors: boolean, c: ReturnType<typeof createColors>): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((vibe / 8000) * BAR_CELLS)));
  const empty = BAR_CELLS - filled;
  if (colors && supportsTruecolor) {
    let out = '';
    for (let i = 0; i < filled; i++) out += lerp(VIOLET, GREEN, filled <= 1 ? 0 : i / (BAR_CELLS - 1)) + '▓';
    return out + RESET + c.dim('░'.repeat(empty));
  }
  return c.magenta('▓'.repeat(filled)) + c.dim('░'.repeat(empty));
}

type Row = { rule: true } | { text: string };

export function renderCard(report: ScoreReport, opts: { colors: boolean; version: string }): string {
  const c = createColors(opts.colors);
  const s = report.stats;
  const tokens = totalTokens(s.tokens);
  const isNpc = report.rank === 'NPC (no vibes detected)';
  const rows: Row[] = [];

  const title = `VIBERULER v${opts.version}`;
  rows.push({ text: gradient(title, opts.colors) ?? c.bold(c.magenta(title)) });
  rows.push({ text: c.dim('· bureau of vibe measurement') });
  rows.push({ rule: true });

  if (isNpc) {
    rows.push({ text: c.dim('No vibes detected on this rig.') });
    rows.push({ text: c.dim('Try: viberuler --scan-dir <path-to-your-code>') });
    rows.push({ text: c.dim('     (and make sure git user.email is set)') });
  } else {
    rows.push({ text: `⚡️ ${c.bold(fmtInt(s.projects))} projects · ${c.bold(fmtInt(s.locTotal))} LoC shipped` });
    rows.push({ text: `🧠 ${c.bold(fmtCompact(tokens))} tokens · ${c.bold(fmtUsd(s.costUsd))} burned` });
    if (report.tokPerUsd !== null) {
      const pct = Math.round((1 - report.effPercentile) * 100);
      rows.push({ text: `💸 ${c.bold(fmtCompact(report.tokPerUsd))} tok/$ · TOP ${c.bold(String(Math.max(1, pct)))}% (est.)` });
    }
    if (report.tokPerLoc !== null) rows.push({ text: `🎯 ${c.bold(fmtCompact(report.tokPerLoc))} tok / line shipped` });
    if (s.commits > 0) rows.push({ text: `🔥 ${c.bold(String(s.streakDays))}-day streak · ${c.bold(fmtInt(s.commits))} commits` });
    if (s.ghStars > 0) rows.push({ text: `⭐️ ${c.bold(fmtInt(s.ghStars))} GitHub stars` });
    if (s.agents.length > 0) {
      const shown = s.agents.slice(0, 3).join(' · ');
      const extra = s.agents.length > 3 ? ` +${s.agents.length - 3} more` : '';
      rows.push({ text: `🤖 ${c.bold(String(s.agents.length))} agents in the stable · ${shown}${extra}` });
    }
  }

  rows.push({ rule: true });
  rows.push({ text: `VIBE SCORE  ${bar(report.vibe, opts.colors, c)}  ${c.bold(fmtInt(report.vibe))}` });
  const rankDisplay = isNpc ? report.rank : report.rank.toUpperCase();
  rows.push({ text: isNpc ? `RANK: ${c.bold(c.cyan(rankDisplay))}` : `THE BUREAU CERTIFIES: ${c.bold(c.cyan(rankDisplay))}` });

  if (report.achievements.length > 0) {
    rows.push({ rule: true });
    rows.push({ text: report.achievements.map((a) => `${a.emoji} ${a.title}`).join(' · ') });
  }

  const contentWidth = Math.max(MIN_WIDTH, ...rows.map((r) => ('text' in r ? displayWidth(r.text) : 0)));
  const width = Math.min(MAX_WIDTH, contentWidth);

  const line = (r: Row): string => {
    if ('rule' in r) return c.dim(`├${'─'.repeat(width + 2)}┤`);
    const pad = ' '.repeat(Math.max(0, width - displayWidth(r.text)));
    return `${c.dim('│')} ${r.text}${pad} ${c.dim('│')}`;
  };
  const top = c.dim(`╭${'─'.repeat(width + 2)}╮`);
  const bottom = c.dim(`╰${'─'.repeat(width + 2)}╯`);
  return [top, ...rows.map(line), bottom].join('\n');
}
