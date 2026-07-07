import type { RawStats, TokenUsage } from './types.js';

export function emptyStats(): RawStats {
  return {
    projects: 0, commits: 0, streakDays: 0, lateNightCommits: 0, historyRewrites: 0,
    locTotal: 0, locByLang: {}, maxRepoLoc: 0,
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    costUsd: 0, ghStars: 0, sources: [], warnings: [],
  };
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheWrite + u.cacheRead;
}

export function mergeStats(base: RawStats, add: Partial<RawStats>): RawStats {
  const locByLang = { ...base.locByLang };
  for (const [lang, n] of Object.entries(add.locByLang ?? {})) {
    locByLang[lang] = (locByLang[lang] ?? 0) + n;
  }
  const t = add.tokens;
  return {
    projects: base.projects + (add.projects ?? 0),
    commits: base.commits + (add.commits ?? 0),
    streakDays: Math.max(base.streakDays, add.streakDays ?? 0),
    lateNightCommits: base.lateNightCommits + (add.lateNightCommits ?? 0),
    historyRewrites: base.historyRewrites + (add.historyRewrites ?? 0),
    locTotal: base.locTotal + (add.locTotal ?? 0),
    locByLang,
    maxRepoLoc: Math.max(base.maxRepoLoc, add.maxRepoLoc ?? 0),
    tokens: {
      input: base.tokens.input + (t?.input ?? 0),
      output: base.tokens.output + (t?.output ?? 0),
      cacheWrite: base.tokens.cacheWrite + (t?.cacheWrite ?? 0),
      cacheRead: base.tokens.cacheRead + (t?.cacheRead ?? 0),
    },
    costUsd: base.costUsd + (add.costUsd ?? 0),
    ghStars: base.ghStars + (add.ghStars ?? 0),
    sources: [...base.sources, ...(add.sources ?? [])],
    warnings: [...base.warnings, ...(add.warnings ?? [])],
  };
}
