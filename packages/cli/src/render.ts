import { createColors } from 'picocolors';
import type { ScoreReport } from './score.js';
import { totalTokens } from './merge.js';
import { fmtCompact, fmtInt, fmtUsd } from './format.js';

const BAR_CELLS = 16;
const ESC = '';
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const VIOLET: [number, number, number] = [179, 136, 255];
const GREEN: [number, number, number] = [105, 240, 174];
const RESET = `${ESC}[0m`;
const supportsTruecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '');

function code(a: [number, number, number], b: [number, number, number], t: number): string {
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
  return chars.map((ch, i) => code(VIOLET, GREEN, n <= 1 ? 0 : i / (n - 1)) + ch).join('') + RESET;
}

function bar(vibe: number, colors: boolean, c: ReturnType<typeof createColors>): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((vibe / 8000) * BAR_CELLS)));
  const empty = BAR_CELLS - filled;
  if (colors && supportsTruecolor) {
    let out = '';
    for (let i = 0; i < filled; i++) out += code(VIOLET, GREEN, filled <= 1 ? 0 : i / (BAR_CELLS - 1)) + '▓';
    return out + RESET + c.dim('░'.repeat(empty));
  }
  return c.magenta('▓'.repeat(filled)) + c.dim('░'.repeat(empty));
}

// Distinct color per agent for the token-distribution strip: truecolor RGBs
// with a picocolors named-color fallback (paired index-for-index).
const AGENT_COLORS: Array<{ rgb: [number, number, number]; name: keyof ReturnType<typeof createColors> }> = [
  { rgb: [179, 136, 255], name: 'magenta' }, // violet
  { rgb: [105, 240, 174], name: 'green' },
  { rgb: [255, 213, 79], name: 'yellow' }, // amber
  { rgb: [77, 208, 225], name: 'cyan' },
  { rgb: [255, 82, 82], name: 'red' }, // stamp
  { rgb: [201, 194, 173], name: 'white' }, // ivory
];

function paint(
  text: string,
  idx: number,
  colors: boolean,
  c: ReturnType<typeof createColors>,
): string {
  if (!colors) return text;
  const col = AGENT_COLORS[idx % AGENT_COLORS.length]!;
  if (supportsTruecolor) return `${ESC}[38;2;${col.rgb[0]};${col.rgb[1]};${col.rgb[2]}m${text}${RESET}`;
  return (c[col.name] as (s: string) => string)(text);
}

// Builds the "TOKENS BY AGENT" rows: a 16-cell strip segmented by each agent's
// token share, plus a color-keyed legend. Returns [] when fewer than two
// agents burned tokens (a single-agent strip carries no information).
function tokenStrip(
  tokensByAgent: Record<string, number>,
  colors: boolean,
  c: ReturnType<typeof createColors>,
): string[] {
  const entries = Object.entries(tokensByAgent)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length < 2) return [];
  const total = entries.reduce((s, [, n]) => s + n, 0);

  // Assign each of the 16 cells to an agent by cumulative share (largest first).
  const cells: string[] = [];
  let cursor = 0; // agent index
  let acc = entries[0]![1];
  for (let i = 0; i < BAR_CELLS; i++) {
    const boundary = ((i + 1) / BAR_CELLS) * total;
    while (cursor < entries.length - 1 && boundary > acc) {
      cursor++;
      acc += entries[cursor]![1];
    }
    cells.push(paint('▓', cursor, colors, c));
  }

  const legend = entries
    .map(([name, n], i) => {
      const pct = (n / total) * 100;
      const label = pct < 1 ? '<1%' : `${Math.round(pct)}%`;
      return `${paint('▓', i, colors, c)} ${name} ${label}`;
    })
    .join('  ');

  return [c.dim('TOKENS BY AGENT'), cells.join(''), legend];
}

export function renderCard(report: ScoreReport, opts: { colors: boolean; version: string }): string {
  const c = createColors(opts.colors);
  const s = report.stats;
  const tokens = totalTokens(s.tokens);
  const isNpc = report.rank === 'NPC (no vibes detected)';
  const rows: string[] = [];

  const title = `VIBERULER v${opts.version}`;
  rows.push(gradient(title, opts.colors) ?? c.bold(c.magenta(title)));
  rows.push(c.dim('· bureau of vibe measurement'));
  rows.push('');

  if (isNpc) {
    rows.push(c.dim('No vibes detected on this rig.'));
    rows.push(c.dim('Try: viberuler --scan-dir <path-to-your-code>'));
    rows.push(c.dim('     (and make sure git user.email is set)'));
  } else {
    rows.push(`⚡ ${c.bold(fmtInt(s.projects))} projects · ${c.bold(fmtInt(s.locTotal))} LoC shipped`);
    rows.push(`🧠 ${c.bold(fmtCompact(tokens))} tokens · ${c.bold(fmtUsd(s.costUsd))} burned`);
    if (report.tokPerUsd !== null) {
      const pct = Math.round((1 - report.effPercentile) * 100);
      rows.push(`💸 ${c.bold(fmtCompact(report.tokPerUsd))} tok/$ · TOP ${c.bold(String(Math.max(1, pct)))}% (est.)`);
    }
    if (report.tokPerLoc !== null) rows.push(`🎯 ${c.bold(fmtCompact(report.tokPerLoc))} tok / line shipped`);
    if (s.commits > 0) rows.push(`🔥 ${c.bold(String(s.streakDays))}-day streak · ${c.bold(fmtInt(s.commits))} commits`);
    if (s.ghStars > 0) rows.push(`⭐ ${c.bold(fmtInt(s.ghStars))} GitHub stars`);
    if (s.agents.length > 0) {
      const shown = s.agents.slice(0, 3).join(' · ');
      const extra = s.agents.length > 3 ? ` +${s.agents.length - 3} more` : '';
      rows.push(`🤖 ${c.bold(String(s.agents.length))} agents in the stable · ${shown}${extra}`);
    }
  }

  rows.push('');
  rows.push(`VIBE SCORE  ${bar(report.vibe, opts.colors, c)}  ${c.bold(fmtInt(report.vibe))}`);
  const rankDisplay = isNpc ? report.rank : report.rank.toUpperCase();
  rows.push(isNpc ? `RANK: ${c.bold(c.cyan(rankDisplay))}` : `THE BUREAU CERTIFIES: ${c.bold(c.cyan(rankDisplay))}`);

  if (report.achievements.length > 0) {
    rows.push('');
    rows.push(report.achievements.map((a) => `${a.emoji} ${a.title}`).join(' · '));
  }

  // Per-agent token distribution strip (skipped for <2 token-bearing agents).
  const strip = tokenStrip(s.tokensByAgent, opts.colors, c);
  if (strip.length > 0) {
    rows.push('');
    for (const r of strip) rows.push(r);
  }

  // Bureau sign-off boilerplate — same string the web certificate closes with.
  rows.push('');
  rows.push(c.dim('— The Bureau · calibrated to ±0.001 vibes'));

  // Left gradient rail — no right border, so emoji cell-width (which varies by
  // terminal) can never misalign the card. Rounded caps top and bottom.
  const total = rows.length + 2;
  const rail = (i: number, ch: string): string => {
    if (!opts.colors) return ch;
    if (supportsTruecolor) return code(VIOLET, GREEN, total <= 1 ? 0 : i / (total - 1)) + ch + RESET;
    return c.magenta(ch);
  };
  const out = [rail(0, '╭')];
  rows.forEach((text, i) => out.push(text ? `${rail(i + 1, '│')} ${text}` : rail(i + 1, '│')));
  out.push(rail(total - 1, '╰'));
  return out.join('\n');
}
