import { describe, it, expect, beforeEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { upsertUser, insertScore } from '../src/db.js';

const S = (vibe: number, tpd: number) => ({
  vibe_score: vibe, loc: 1, projects: 1, tokens: 1000, cost_usd: 1,
  tok_per_usd: tpd, achievements: ['polyglot'], breakdown: {}, client_version: '0.1.0',
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
  const a = await upsertUser(env.DB, { gh_id: 1, gh_login: 'alpha', avatar_url: null, gh_created_at: null });
  const b = await upsertUser(env.DB, { gh_id: 2, gh_login: 'beta', avatar_url: null, gh_created_at: null });
  await insertScore(env.DB, a, S(3000, 500), false);
  await insertScore(env.DB, b, S(1000, 100), false);
});

describe('GET /api/leaderboard', () => {
  it('returns ranked rows with parsed achievements and cache header', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/api/leaderboard');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await res.json()) as any;
    expect(body.total).toBe(2);
    expect(body.rows[0]).toMatchObject({ rank: 1, login: 'alpha', vibe_score: 3000, achievements: ['polyglot'] });
    expect(body.rows[1].rank).toBe(2);
  });
});

describe('GET /api/percentile', () => {
  it('computes percentile for a given tok_per_usd', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/api/percentile?tok_per_usd=300');
    const body = (await res.json()) as any;
    expect(body.sample).toBe(2);
    expect(body.percentile).toBeCloseTo(0.5);
  });
  it('400 on missing param', async () => {
    expect((await exports.default.fetch('https://viberuler.dev/api/percentile')).status).toBe(400);
  });
});
