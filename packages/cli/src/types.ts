export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface RawStats {
  projects: number;
  commits: number;
  featsShipped: number;       // commits with a conventional `feat:` subject (outcomes, not volume)
  prsMerged: number;          // merge commits + squash-merged PRs (`… (#123)`)
  streakDays: number;
  lateNightCommits: number;   // commits at 00:00-04:59 local
  historyRewrites: number;    // reflog rebase/reset entries
  locTotal: number;
  locByLang: Record<string, number>;
  maxRepoLoc: number;
  /**
   * Lines of machine output you committed (generated types, bundles, lockfiles).
   * Deliberately NOT part of locTotal — it isn't code you wrote. Reported so you
   * can see, and shrink, the share of your diff no human ever read.
   */
  locGenerated: number;
  /** Distinct days you committed on — the union across repos, never a sum. */
  activeDays: number;
  /** Calendar days from your first commit to your last, inclusive. */
  spanDays: number;
  tokens: TokenUsage;
  tokensByAgent: Record<string, number>; // total tokens attributed per agent (distribution strip)
  costUsd: number;
  ghStars: number;
  agents: string[];           // coding agents detected on this rig (display names)
  sources: string[];
  warnings: string[];
  busiestDay: string | null;   // YYYY-MM-DD with the most commits (windowed)
  busiestDayCount: number;
}

export interface ScanContext {
  home: string;
  /**
   * Extra agent homes (--agent-home, repeatable). Multi-agent rigs relocate
   * their agents out of the OS home entirely; collectors must look in these too.
   * Resolve them through `resolveRoots` rather than joining ctx.home by hand.
   */
  agentHomes?: string[];
  scanDirs: string[];
  since?: Date;
  until?: Date; // exclusive upper bound for time-windowed recaps (wrapped)
  githubHandle?: string;
  authorEmail?: string; // test seam / override — real runs read `git config --get user.email`
  env?: Record<string, string | undefined>; // test seam — real runs pass process.env
}

export interface Collector {
  id: string;
  detect(ctx: ScanContext): Promise<boolean>;
  collect(ctx: ScanContext): Promise<Partial<RawStats>>;
}
