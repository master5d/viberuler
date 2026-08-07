import type { RawStats } from './types.js';
import { totalTokens } from './merge.js';

export interface Achievement {
  id: string;
  title: string;
  emoji: string;
  test(s: RawStats): boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'token-billionaire', title: 'Token Billionaire', emoji: '💰', test: (s) => totalTokens(s.tokens) >= 1e9 },
  { id: 'free-tier-martyr', title: 'Free Tier Martyr', emoji: '🪦', test: (s) => s.costUsd < 1 && totalTokens(s.tokens) >= 1e6 },
  { id: 'cache-whisperer', title: 'Cache Whisperer', emoji: '🗄️', test: (s) => { const t = totalTokens(s.tokens); return t > 0 && s.tokens.cacheRead / t > 0.9; } },
  { id: 'polyglot', title: 'Polyglot', emoji: '🌐', test: (s) => Object.keys(s.locByLang).length >= 5 },
  { id: 'monorepo-menace', title: 'Monorepo Menace', emoji: '🐘', test: (s) => s.maxRepoLoc > 100_000 },
  { id: 'streak-freak', title: 'Streak Freak', emoji: '🔥', test: (s) => s.streakDays >= 100 },
  { id: '3am-committer', title: '3AM Committer', emoji: '🌙', test: (s) => s.lateNightCommits >= 10 },
  { id: 'yolo-force-pusher', title: 'YOLO Force Pusher', emoji: '💥', test: (s) => s.historyRewrites >= 20 },
  // The casino wing. Tokens are chips — denominated so you don't feel the money
  // leaving. These two turn the chips back into dollars.
  { id: 'high-roller', title: 'High Roller', emoji: '🎰', test: (s) => s.costUsd >= 1000 },
  { id: 'table-hopper', title: 'Table Hopper', emoji: '🎲', test: (s) => Object.values(s.costByAgent).filter((v) => v >= 1).length >= 3 },
];

export function evalAchievements(s: RawStats): Achievement[] {
  return ACHIEVEMENTS.filter((a) => a.test(s));
}
