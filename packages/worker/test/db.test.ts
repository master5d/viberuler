import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  upsertUser, insertScore, submitsInLastHour, leaderboard,
  latestForLogin, rankFor, percentileFor, totals,
} from '../src/db.js';

const U = (n: number) => ({ gh_id: n, gh_login: `user${n}`, avatar_url: null, gh_created_at: null });
const S = (vibe: number, tpd: number | null = 1_000_000) => ({
  vibe_score: vibe, loc: 1000, projects: 2, tokens: 5_000_000, cost_usd: 5,
  tok_per_usd: tpd, achievements: ['polyglot'], breakdown: { volume: 100 }, client_version: '0.1.0',
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
});

describe('upsertUser', () => {
  it('inserts then updates on gh_id conflict', async () => {
    const id1 = await upsertUser(env.DB, U(1));
    const id2 = await upsertUser(env.DB, { ...U(1), gh_login: 'renamed' });
    expect(id2).toBe(id1);
    const row = await env.DB.prepare('SELECT gh_login FROM users WHERE id = ?').bind(id1).first();
    expect(row?.gh_login).toBe('renamed');
  });
});

describe('scores', () => {
  it('leaderboard shows latest non-sus score per user, ranked', async () => {
    const a = await upsertUser(env.DB, U(1));
    const b = await upsertUser(env.DB, U(2));
    await insertScore(env.DB, a, S(1000), false);
    await insertScore(env.DB, a, S(3000), false); // latest for a
    await insertScore(env.DB, b, S(2000), false);
    const { rows, total } = await leaderboard(env.DB, 1);
    expect(total).toBe(2);
    expect(rows.map((r) => r.gh_login)).toEqual(['user1', 'user2']);
    expect(rows[0]!.vibe_score).toBe(3000);
  });

  it('sus scores are stored but excluded from board and rank', async () => {
    const a = await upsertUser(env.DB, U(1));
    await insertScore(env.DB, a, S(99999), true);
    const { total } = await leaderboard(env.DB, 1);
    expect(total).toBe(0);
    expect(await rankFor(env.DB, 100)).toBe(1);
  });

  it('rankFor counts strictly-higher latest scores', async () => {
    const a = await upsertUser(env.DB, U(1));
    const b = await upsertUser(env.DB, U(2));
    await insertScore(env.DB, a, S(3000), false);
    await insertScore(env.DB, b, S(1000), false);
    expect(await rankFor(env.DB, 2000)).toBe(2);
    expect(await rankFor(env.DB, 4000)).toBe(1);
  });

  it('submitsInLastHour counts recent rows only', async () => {
    const a = await upsertUser(env.DB, U(1));
    await insertScore(env.DB, a, S(1000), false);
    await insertScore(env.DB, a, S(1100), false);
    expect(await submitsInLastHour(env.DB, a)).toBe(2);
  });

  it('latestForLogin returns row with rank; null for unknown', async () => {
    const a = await upsertUser(env.DB, U(1));
    await insertScore(env.DB, a, S(3000), false);
    const row = await latestForLogin(env.DB, 'user1');
    expect(row?.vibe_score).toBe(3000);
    expect(row?.rank).toBe(1);
    expect(await latestForLogin(env.DB, 'ghost')).toBeNull();
  });

  it('percentileFor computes fraction below; 0.5 on empty board', async () => {
    expect(await percentileFor(env.DB, 5)).toEqual({ percentile: 0.5, sample: 0 });
    const a = await upsertUser(env.DB, U(1));
    const b = await upsertUser(env.DB, U(2));
    await insertScore(env.DB, a, S(1000, 100), false);
    await insertScore(env.DB, b, S(1000, 300), false);
    const r = await percentileFor(env.DB, 200);
    expect(r.sample).toBe(2);
    expect(r.percentile).toBeCloseTo(0.5);
  });

  it('totals sums latest tokens across users', async () => {
    const a = await upsertUser(env.DB, U(1));
    await insertScore(env.DB, a, S(1000), false);
    const t = await totals(env.DB);
    expect(t.users).toBe(1);
    expect(t.tokens).toBe(5_000_000);
  });
});
