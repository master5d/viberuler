import { describe, it, expect } from 'vitest';
import { evalAchievements } from '../src/achievements.js';
import { emptyStats } from '../src/merge.js';

const withStats = (over: object) => ({ ...emptyStats(), ...over });

describe('evalAchievements', () => {
  it('earns nothing on empty stats', () => {
    expect(evalAchievements(emptyStats())).toEqual([]);
  });

  it('token-billionaire at 1e9 total tokens', () => {
    const s = withStats({ tokens: { input: 1e9, output: 0, cacheWrite: 0, cacheRead: 0 } });
    expect(evalAchievements(s).map((a) => a.id)).toContain('token-billionaire');
  });

  it('free-tier-martyr needs >=1M tokens AND <$1', () => {
    const yes = withStats({ costUsd: 0.5, tokens: { input: 2e6, output: 0, cacheWrite: 0, cacheRead: 0 } });
    const noTokens = withStats({ costUsd: 0.5, tokens: { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 } });
    expect(evalAchievements(yes).map((a) => a.id)).toContain('free-tier-martyr');
    expect(evalAchievements(noTokens).map((a) => a.id)).not.toContain('free-tier-martyr');
  });

  it('cache-whisperer above 90% cache-read ratio', () => {
    const s = withStats({ tokens: { input: 5, output: 4, cacheWrite: 0, cacheRead: 91 } });
    expect(evalAchievements(s).map((a) => a.id)).toContain('cache-whisperer');
  });

  it('polyglot, monorepo-menace, streak-freak, 3am, yolo', () => {
    const s = withStats({
      locByLang: { a: 1, b: 1, c: 1, d: 1, e: 1 },
      maxRepoLoc: 100_001,
      streakDays: 100,
      lateNightCommits: 10,
      historyRewrites: 20,
    });
    const ids = evalAchievements(s).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      'polyglot', 'monorepo-menace', 'streak-freak', '3am-committer', 'yolo-force-pusher',
    ]));
  });
});
