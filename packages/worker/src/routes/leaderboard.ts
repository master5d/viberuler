import type { Env } from '../index.js';
import { json } from '../index.js';
import { leaderboard, percentileFor } from '../db.js';

export async function handleLeaderboard(_req: Request, env: Env, url: URL): Promise<Response> {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = 25;
  const { rows, total } = await leaderboard(env.DB, page, perPage);
  return json(
    {
      page,
      total,
      rows: rows.map((r, i) => ({
        rank: (page - 1) * perPage + i + 1,
        login: r.gh_login,
        avatar_url: r.avatar_url,
        vibe_score: r.vibe_score,
        tok_per_usd: r.tok_per_usd,
        achievements: JSON.parse(r.achievements) as string[],
        submitted_at: r.submitted_at,
      })),
    },
    200,
    { 'cache-control': 'public, max-age=60' },
  );
}

export async function handlePercentile(_req: Request, env: Env, url: URL): Promise<Response> {
  const raw = url.searchParams.get('tok_per_usd');
  const value = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) return json({ error: 'tok_per_usd query param required' }, 400);
  return json(await percentileFor(env.DB, value));
}
