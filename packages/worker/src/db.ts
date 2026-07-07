export interface GhUser {
  gh_id: number;
  gh_login: string;
  avatar_url: string | null;
  gh_created_at: string | null;
}

export interface ScoreInput {
  vibe_score: number;
  loc: number;
  projects: number;
  tokens: number;
  cost_usd: number;
  tok_per_usd: number | null;
  achievements: string[];
  breakdown: Record<string, number>;
  client_version: string;
}

export interface BoardRow {
  gh_login: string;
  avatar_url: string | null;
  vibe_score: number;
  tok_per_usd: number | null;
  achievements: string;
  submitted_at: string;
}

// Latest score row per user (by max id), non-sus only.
const LATEST = `
  SELECT s.* FROM scores s
  WHERE s.sus = 0 AND s.id IN (SELECT MAX(id) FROM scores GROUP BY user_id)
`;

export async function upsertUser(db: D1Database, u: GhUser): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO users (gh_id, gh_login, avatar_url, gh_created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(gh_id) DO UPDATE SET gh_login = excluded.gh_login, avatar_url = excluded.avatar_url
       RETURNING id`,
    )
    .bind(u.gh_id, u.gh_login, u.avatar_url, u.gh_created_at)
    .first<{ id: number }>();
  if (!row) throw new Error('upsertUser returned no row');
  return row.id;
}

export async function insertScore(db: D1Database, userId: number, s: ScoreInput, sus: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO scores (user_id, vibe_score, loc, projects, tokens, cost_usd, tok_per_usd, achievements, breakdown, sus, client_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId, s.vibe_score, s.loc, s.projects, s.tokens, s.cost_usd, s.tok_per_usd,
      JSON.stringify(s.achievements), JSON.stringify(s.breakdown), sus ? 1 : 0, s.client_version,
    )
    .run();
}

export async function submitsInLastHour(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM scores WHERE user_id = ? AND submitted_at > datetime('now', '-1 hour')`)
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function leaderboard(
  db: D1Database,
  page: number,
  perPage = 25,
): Promise<{ rows: BoardRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * perPage;
  const { results } = await db
    .prepare(
      `SELECT u.gh_login, u.avatar_url, s.vibe_score, s.tok_per_usd, s.achievements, s.submitted_at
       FROM (${LATEST}) s JOIN users u ON u.id = s.user_id
       ORDER BY s.vibe_score DESC LIMIT ? OFFSET ?`,
    )
    .bind(perPage, offset)
    .all<BoardRow>();
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM (${LATEST})`).first<{ n: number }>();
  return { rows: results, total: totalRow?.n ?? 0 };
}

export async function rankFor(db: D1Database, vibeScore: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM (${LATEST}) WHERE vibe_score > ?`)
    .bind(vibeScore)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

export async function latestForLogin(
  db: D1Database,
  login: string,
): Promise<(BoardRow & { rank: number; sus: number }) | null> {
  const row = await db
    .prepare(
      `SELECT u.gh_login, u.avatar_url, s.vibe_score, s.tok_per_usd, s.achievements, s.submitted_at, s.sus
       FROM scores s JOIN users u ON u.id = s.user_id
       WHERE u.gh_login = ? AND s.id = (SELECT MAX(id) FROM scores WHERE user_id = u.id)`,
    )
    .bind(login)
    .first<BoardRow & { sus: number }>();
  if (!row) return null;
  const rank = row.sus ? 0 : await rankFor(db, row.vibe_score);
  return { ...row, rank };
}

export async function percentileFor(
  db: D1Database,
  tokPerUsd: number,
): Promise<{ percentile: number; sample: number }> {
  const sampleRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM (${LATEST}) WHERE tok_per_usd IS NOT NULL`)
    .first<{ n: number }>();
  const sample = sampleRow?.n ?? 0;
  if (sample === 0) return { percentile: 0.5, sample: 0 };
  const belowRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM (${LATEST}) WHERE tok_per_usd IS NOT NULL AND tok_per_usd < ?`)
    .bind(tokPerUsd)
    .first<{ n: number }>();
  return { percentile: (belowRow?.n ?? 0) / sample, sample };
}

export async function totals(db: D1Database): Promise<{ users: number; tokens: number }> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS users, COALESCE(SUM(tokens), 0) AS tokens FROM (${LATEST})`)
    .first<{ users: number; tokens: number }>();
  return { users: row?.users ?? 0, tokens: row?.tokens ?? 0 };
}
