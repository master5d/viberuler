import type { ScoreReport } from './score.js';
import { totalTokens } from './merge.js';

export interface SubmitPayload {
  client_version: string;
  vibe_score: number;
  loc: number;
  projects: number;
  tokens: number;
  cost_usd: number;
  tok_per_usd: number | null;
  tok_per_loc: number | null;
  achievements: string[];
  breakdown: Record<string, number>;
}

export function buildPayload(report: ScoreReport, clientVersion: string): SubmitPayload {
  const s = report.stats;
  return {
    client_version: clientVersion,
    vibe_score: report.vibe,
    loc: s.locTotal,
    projects: s.projects,
    tokens: totalTokens(s.tokens),
    cost_usd: Math.round(s.costUsd * 100) / 100,
    tok_per_usd: report.tokPerUsd === null ? null : Math.round(report.tokPerUsd),
    tok_per_loc: report.tokPerLoc === null ? null : Math.round(report.tokPerLoc),
    achievements: report.achievements.map((a) => a.id),
    breakdown: Object.fromEntries(
      Object.entries(report.breakdown).map(([k, v]) => [k, Math.round(v)]),
    ),
  };
}
