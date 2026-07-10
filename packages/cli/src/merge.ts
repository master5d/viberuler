import type { RawStats, TokenUsage } from './types.js';

export function emptyStats(): RawStats {
  return {
    projects: 0, commits: 0, featsShipped: 0, prsMerged: 0, streakDays: 0, lateNightCommits: 0, historyRewrites: 0,
    locTotal: 0, locByLang: {}, maxRepoLoc: 0,
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    tokensByAgent: {},
    costUsd: 0, ghStars: 0, agents: [], sources: [], warnings: [],
    busiestDay: null, busiestDayCount: 0,
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
  const tokensByAgent = { ...base.tokensByAgent };
  for (const [agent, n] of Object.entries(add.tokensByAgent ?? {})) {
    tokensByAgent[agent] = (tokensByAgent[agent] ?? 0) + n;
  }
  const t = add.tokens;
  return {
    projects: base.projects + (add.projects ?? 0),
    commits: base.commits + (add.commits ?? 0),
    featsShipped: base.featsShipped + (add.featsShipped ?? 0),
    prsMerged: base.prsMerged + (add.prsMerged ?? 0),
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
    tokensByAgent,
    costUsd: base.costUsd + (add.costUsd ?? 0),
    ghStars: base.ghStars + (add.ghStars ?? 0),
    agents: [...new Set([...base.agents, ...(add.agents ?? [])])],
    sources: [...base.sources, ...(add.sources ?? [])],
    warnings: [...base.warnings, ...(add.warnings ?? [])],
    busiestDay: (add.busiestDayCount ?? 0) > base.busiestDayCount ? (add.busiestDay ?? null) : base.busiestDay,
    busiestDayCount: Math.max(base.busiestDayCount, add.busiestDayCount ?? 0),
  };
}
