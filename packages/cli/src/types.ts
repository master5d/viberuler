export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface RawStats {
  projects: number;
  commits: number;
  streakDays: number;
  lateNightCommits: number;   // commits at 00:00-04:59 local
  historyRewrites: number;    // reflog rebase/reset entries
  locTotal: number;
  locByLang: Record<string, number>;
  maxRepoLoc: number;
  tokens: TokenUsage;
  costUsd: number;
  ghStars: number;
  sources: string[];
  warnings: string[];
}

export interface ScanContext {
  home: string;
  scanDirs: string[];
  since?: Date;
  githubHandle?: string;
}

export interface Collector {
  id: string;
  detect(ctx: ScanContext): Promise<boolean>;
  collect(ctx: ScanContext): Promise<Partial<RawStats>>;
}
