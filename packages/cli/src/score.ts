import type { RawStats } from './types.js';
import { totalTokens } from './merge.js';
import { evalAchievements, type Achievement } from './achievements.js';

export interface ScoreBreakdown {
  volume: number;
  leverage: number;
  efficiency: number;
  breadth: number;
  streak: number;
  achievements: number;
}

export interface ScoreReport {
  vibe: number;
  rank: string;
  breakdown: ScoreBreakdown;
  tokPerUsd: number | null;
  effPercentile: number;
  achievements: Achievement[];
  stats: RawStats;
}

const CURVE: Array<[number, number]> = [
  [4, 0.05], [5, 0.2], [6, 0.5], [6.7, 0.8], [7.3, 0.95], [8, 0.99],
];

export function offlinePercentile(tokPerUsd: number): number {
  if (tokPerUsd <= 0) return 0;
  const x = Math.log10(tokPerUsd);
  const first = CURVE[0]!;
  const last = CURVE[CURVE.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i - 1]!;
    const [x2, y2] = CURVE[i]!;
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return last[1];
}

const RANK_TABLE: Array<[number, string]> = [
  [8000, 'Singularity Adjacent'],
  [6500, 'GIGACHAD SHIPPER'],
  [5000, 'Ship Machine'],
  [3500, 'Context Goblin'],
  [2000, 'Token Burner'],
  [800, 'Vibe Apprentice'],
];

export function rankFor(vibe: number, hasData: boolean): string {
  if (!hasData) return 'NPC (no vibes detected)';
  for (const [min, name] of RANK_TABLE) if (vibe >= min) return name;
  return 'Prompt Peasant';
}

export function computeScore(stats: RawStats, effPercentile?: number): ScoreReport {
  const tokens = totalTokens(stats.tokens);
  const tokPerUsd = stats.costUsd > 0 ? tokens / stats.costUsd : null;
  const pct = effPercentile ?? (tokPerUsd !== null ? offlinePercentile(tokPerUsd) : 0);
  const earned = evalAchievements(stats);

  const breakdown: ScoreBreakdown = {
    volume: 1000 * Math.log10(1 + stats.locTotal / 1000),
    leverage: 500 * Math.log10(1 + tokens / 1_000_000),
    efficiency: tokPerUsd !== null ? 800 * pct : 0,
    breadth: 300 * Math.log10(1 + stats.projects * 10),
    streak: Math.min(stats.streakDays, 365),
    achievements: 50 * earned.length,
  };
  const vibe = Math.round(
    breakdown.volume + breakdown.leverage + breakdown.efficiency +
    breakdown.breadth + breakdown.streak + breakdown.achievements,
  );
  const hasData = stats.sources.length > 0 && (tokens > 0 || stats.commits > 0);

  return { vibe, rank: rankFor(vibe, hasData), breakdown, tokPerUsd, effPercentile: pct, achievements: earned, stats };
}
