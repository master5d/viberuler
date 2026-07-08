import type { Env } from '../index.js';
import { json } from '../index.js';
import { verifyGithubToken } from '../github.js';
import { submitPayloadSchema, susReason, plausibilityReason } from '../validation.js';
import { upsertUser, insertScore, submitsInLastHour, rankFor, percentileFor, previousScore } from '../db.js';

export async function handleSubmit(req: Request, env: Env, url: URL): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return json({ error: 'missing bearer token' }, 401);

  const ghUser = await verifyGithubToken(token);
  if (!ghUser) return json({ error: 'github token rejected' }, 401);

  let payload;
  try {
    payload = submitPayloadSchema.parse(await req.json());
  } catch (err) {
    return json({ error: `invalid payload: ${err instanceof Error ? err.message : 'parse error'}` }, 400);
  }

  const userId = await upsertUser(env.DB, ghUser);
  if ((await submitsInLastHour(env.DB, userId)) >= 5) {
    return json({ error: 'rate limit: 5 submits per hour' }, 429);
  }

  const accountAgeDays = ghUser.gh_created_at
    ? Math.max(0, (Date.now() - Date.parse(ghUser.gh_created_at)) / 86_400_000)
    : null;
  const previous = await previousScore(env.DB, userId);
  const reason =
    susReason(payload) ??
    plausibilityReason(payload, { accountAgeDays, previous, now: new Date().toISOString() });

  await insertScore(env.DB, userId, payload, reason !== null, reason);
  const sus = reason !== null;
  const rank = sus ? null : await rankFor(env.DB, payload.vibe_score);
  const pct = sus || payload.tok_per_usd === null ? null : (await percentileFor(env.DB, payload.tok_per_usd)).percentile;

  return json({
    ok: true,
    login: ghUser.gh_login,
    url: `${url.origin}/u/${ghUser.gh_login}`,
    rank,
    percentile: pct,
    sus,
  });
}
