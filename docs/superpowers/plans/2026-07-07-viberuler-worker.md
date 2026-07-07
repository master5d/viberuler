# VibeRuler Worker + Submit (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/worker` (CF Worker + D1: submit API, leaderboard, share pages, OG images, stats badge) and wire `--submit` (GitHub device flow + live percentile) into the CLI.

**Architecture:** Single Worker `viberuler-api` with a hand-rolled router (no framework). D1 for users/scores. Pure modules (`validation`, `db`, `github`) + thin route handlers. CLI gets `src/submit.ts` (device flow, share links, live percentile) — network ONLY inside the explicit `--submit`/`--github` paths. Integration tests run in workerd via `@cloudflare/vitest-pool-workers` (vitest 4.1 `cloudflareTest` plugin, `readD1Migrations`/`applyD1Migrations`, `fetchMock` for GitHub API).

**Tech Stack:** TypeScript strict ESM; Worker runtime deps: `zod@^3`, `workers-og` (satori-based OG PNGs, vendored JetBrains Mono TTF); dev: `wrangler@latest`, `@cloudflare/vitest-pool-workers@latest`, `vitest@^4.1.0`, `@cloudflare/workers-types`.

## Global Constraints

- CLI default run stays **zero network**: live percentile + device flow + submit run ONLY under `--submit` (or `--github` for stars). Payload printed to the user before anything is sent; sending requires `--yes` or interactive confirm.
- Payload contract is FROZEN (Plan 1 Task 12): keys `client_version, vibe_score, loc, projects, tokens, cost_usd, tok_per_usd, achievements, breakdown`. Worker validates with zod `.strict()`.
- Sanity caps (spec §3): `loc > 50_000_000`, `tokens > 100_000_000_000`, `tokens > 1_000_000 && cost_usd < 0.01`, `tok_per_usd > 100_000_000`, `vibe_score > 50_000`, unknown achievement id → `sus = 1`, excluded from board/rank until manual review (row still stored, HTTP 200 with `sus: true`).
- Rate limit: max 5 submits per hour per user → HTTP 429.
- GitHub device flow needs NO client secret (client_id only, public). Client ID placeholder `GITHUB_CLIENT_ID_PLACEHOLDER` — env override `VIBERULER_GITHUB_CLIENT_ID` (CLI); real OAuth App created at launch (Plan 3 checklist).
- No secrets in repo or wrangler.jsonc. `database_id` stays the zero-UUID placeholder until launch (`wrangler d1 create viberuler` at deploy).
- Worker code follows CF best practices: `nodejs_compat` flag, `observability.enabled: true`, no `Math.random()` for anything security-ish, every promise awaited, no hand-drift `Env` (generated via `wrangler types`, committed).
- Tests: workerd-native via `cloudflareTest` plugin; D1 migrations applied in `test/apply-migrations.ts` setup file; outbound GitHub API mocked with `fetchMock` from `cloudflare:test` (`disableNetConnect`); CLI tests keep the existing fetchImpl-seam style. NEVER hit real network in tests.
- Monorepo: cli package's vitest is BUMPED to `^4.1.0` (one vitest major across workspaces); all 60 existing CLI tests must still pass after the bump.
- Root scripts run both workspaces: `npm test` = cli + worker.

---

### Task 1: Worker scaffold + vitest-pool-workers wiring (+ cli vitest bump)

**Files:**
- Create: `packages/worker/package.json`
- Create: `packages/worker/wrangler.jsonc`
- Create: `packages/worker/tsconfig.json`
- Create: `packages/worker/vitest.config.ts`
- Create: `packages/worker/src/index.ts`
- Create: `packages/worker/test/apply-migrations.ts`
- Create: `packages/worker/test/env.d.ts`
- Create: `packages/worker/test/index.test.ts`
- Create: `packages/worker/migrations/.gitkeep` (real schema lands in Task 2; readD1Migrations needs the dir to exist)
- Modify: `packages/cli/package.json` (vitest `^2.0.0` → `^4.1.0`)
- Modify: `package.json` (root scripts run both workspaces)

**Interfaces:**
- Consumes: nothing new.
- Produces: `npm test -w viberuler-api` runs workerd-native vitest; `exports.default.fetch(url)` integration pattern available to all later tasks; `GET /api/health` → `{ ok: true }`.

- [ ] **Step 1: Write packages/worker/package.json**

```json
{
  "name": "viberuler-api",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "types": "wrangler types",
    "check": "wrangler deploy --dry-run"
  }
}
```

Then install deps (from repo root; lockfile pins exact versions):

```bash
npm i -w viberuler-api zod@^3
npm i -D -w viberuler-api wrangler@latest @cloudflare/vitest-pool-workers@latest vitest@^4.1.0 @cloudflare/workers-types@latest typescript@^5.5.0
```

- [ ] **Step 2: Write packages/worker/wrangler.jsonc**

```jsonc
{
  "name": "viberuler-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "viberuler",
      // placeholder — replaced by `wrangler d1 create viberuler` output at launch
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "vars": { "GITHUB_CLIENT_ID": "GITHUB_CLIENT_ID_PLACEHOLDER" },
  "rules": [{ "type": "Data", "globs": ["**/*.ttf"], "fallthrough": true }]
}
```

- [ ] **Step 3: Write packages/worker/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types"]
  },
  "include": ["src", "test", "worker-configuration.d.ts"]
}
```

- [ ] **Step 4: Write packages/worker/vitest.config.ts** (pattern retrieved 2026-07-07 from workers-sdk d1 fixture)

```ts
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'], include: ['test/**/*.test.ts'] },
  };
});
```

- [ ] **Step 5: Write test setup + env typing**

`packages/worker/test/apply-migrations.ts`:

```ts
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Setup files run outside per-test isolation and may run multiple times;
// applyD1Migrations only applies migrations that haven't been applied yet.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`packages/worker/test/env.d.ts`:

```ts
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GITHUB_CLIENT_ID: string;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
```

- [ ] **Step 6: Write src/index.ts (router skeleton + health route)**

```ts
export interface Env {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
}

export type RouteHandler = (req: Request, env: Env, url: URL) => Promise<Response>;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.log(JSON.stringify({ level: 'error', msg: String(err), path: pathname }));
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: Write the failing test**

`packages/worker/test/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

describe('router', () => {
  it('GET /api/health returns ok', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown route returns 404 json', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/nope');
    expect(res.status).toBe(404);
  });
});
```

Create `packages/worker/migrations/.gitkeep` (readD1Migrations needs the dir to exist).

- [ ] **Step 8: Generate Env types, run tests, bump cli vitest**

Run in `packages/worker`: `npx wrangler types` (commits `worker-configuration.d.ts`), then `npx vitest run` — expected 2 tests pass.
Modify `packages/cli/package.json` devDependencies: `"vitest": "^4.1.0"`; run `npm install` at root, then `npm test -w viberuler` — all 60 CLI tests must pass (if vitest 4 breaks the minimal config, fix config only, not tests).

- [ ] **Step 9: Update root scripts**

Root `package.json` scripts:

```json
{
  "scripts": {
    "test": "npm test -w viberuler && npm test -w viberuler-api",
    "build": "npm run build -w viberuler",
    "typecheck": "npm run typecheck -w viberuler && npm run typecheck -w viberuler-api"
  }
}
```

Run from root: `npm run typecheck && npm test` — all green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(worker): scaffold viberuler-api — wrangler, vitest-pool-workers, health route"
```

---

### Task 2: D1 schema + db helpers

**Files:**
- Create: `packages/worker/migrations/0001_init.sql`
- Create: `packages/worker/src/db.ts`
- Test: `packages/worker/test/db.test.ts`

**Interfaces:**
- Consumes: `env.DB` (D1Database).
- Produces (route tasks import from `../src/db.js`):
  - `interface GhUser { gh_id: number; gh_login: string; avatar_url: string | null; gh_created_at: string | null }`
  - `interface ScoreInput { vibe_score: number; loc: number; projects: number; tokens: number; cost_usd: number; tok_per_usd: number | null; achievements: string[]; breakdown: Record<string, number>; client_version: string }`
  - `upsertUser(db, u: GhUser): Promise<number>` (user id; updates login/avatar on conflict)
  - `insertScore(db, userId, s: ScoreInput, sus: boolean): Promise<void>`
  - `submitsInLastHour(db, userId): Promise<number>`
  - `interface BoardRow { gh_login: string; avatar_url: string | null; vibe_score: number; tok_per_usd: number | null; achievements: string; submitted_at: string }`
  - `leaderboard(db, page: number, perPage?: number): Promise<{ rows: BoardRow[]; total: number }>` — latest non-sus score per user, ordered by vibe_score DESC
  - `latestForLogin(db, login: string): Promise<(BoardRow & { rank: number; sus: number }) | null>`
  - `rankFor(db, vibeScore: number): Promise<number>` — 1 + count of latest non-sus rows with higher score
  - `percentileFor(db, tokPerUsd: number): Promise<{ percentile: number; sample: number }>` — fraction of latest non-sus rows with lower tok_per_usd; `percentile: 0.5, sample: 0` when board empty
  - `totals(db): Promise<{ users: number; tokens: number }>`

- [ ] **Step 1: Write the migration**

`packages/worker/migrations/0001_init.sql` (delete `.gitkeep`):

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gh_id INTEGER UNIQUE NOT NULL,
  gh_login TEXT NOT NULL,
  avatar_url TEXT,
  gh_created_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  vibe_score REAL NOT NULL,
  loc INTEGER NOT NULL DEFAULT 0,
  projects INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  tok_per_usd REAL,
  achievements TEXT NOT NULL DEFAULT '[]',
  breakdown TEXT NOT NULL DEFAULT '{}',
  sus INTEGER NOT NULL DEFAULT 0,
  client_version TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_scores_user_time ON scores(user_id, submitted_at DESC);
CREATE INDEX idx_scores_user_id ON scores(user_id, id DESC);
```

- [ ] **Step 2: Write the failing test**

`packages/worker/test/db.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/db.test.ts` (from `packages/worker`)
Expected: FAIL — cannot resolve `../src/db.js`.

- [ ] **Step 4: Write the implementation**

`packages/worker/src/db.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/db.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/worker/migrations packages/worker/src/db.ts packages/worker/test/db.test.ts
git commit -m "feat(worker): D1 schema + db helpers (leaderboard, rank, percentile, rate window)"
```

---

### Task 3: Payload validation + sanity caps

**Files:**
- Create: `packages/worker/src/validation.ts`
- Test: `packages/worker/test/validation.test.ts`

**Interfaces:**
- Consumes: zod.
- Produces:
  - `const submitPayloadSchema` — zod strict schema; `type SubmitPayload = z.infer<...>` matching the frozen 9-key CLI contract
  - `function susReason(p: SubmitPayload): string | null` — first tripped cap name, or null
  - `const KNOWN_ACHIEVEMENTS: readonly string[]` — the 8 ids from Plan 1 Task 9

- [ ] **Step 1: Write the failing test**

`packages/worker/test/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { submitPayloadSchema, susReason } from '../src/validation.js';

const VALID = {
  client_version: '0.1.0',
  vibe_score: 3101,
  loc: 312_441,
  projects: 47,
  tokens: 1_200_000_000,
  cost_usd: 184.2,
  tok_per_usd: 6_500_000,
  achievements: ['token-billionaire', 'cache-whisperer'],
  breakdown: { volume: 1000, leverage: 1500 },
};

describe('submitPayloadSchema', () => {
  it('accepts the canonical CLI payload', () => {
    expect(submitPayloadSchema.parse(VALID)).toEqual(VALID);
  });
  it('accepts null tok_per_usd', () => {
    expect(submitPayloadSchema.parse({ ...VALID, tok_per_usd: null }).tok_per_usd).toBeNull();
  });
  it('rejects extra keys (strict)', () => {
    expect(() => submitPayloadSchema.parse({ ...VALID, evil: 1 })).toThrow();
  });
  it('rejects negative numbers and non-string achievements', () => {
    expect(() => submitPayloadSchema.parse({ ...VALID, loc: -1 })).toThrow();
    expect(() => submitPayloadSchema.parse({ ...VALID, achievements: [1] })).toThrow();
  });
});

describe('susReason', () => {
  it('null for sane payloads', () => {
    expect(susReason(VALID)).toBeNull();
  });
  it('trips each cap', () => {
    expect(susReason({ ...VALID, loc: 50_000_001 })).toBe('loc');
    expect(susReason({ ...VALID, tokens: 100_000_000_001 })).toBe('tokens');
    expect(susReason({ ...VALID, tokens: 2_000_000, cost_usd: 0 })).toBe('cost');
    expect(susReason({ ...VALID, tok_per_usd: 100_000_001 })).toBe('efficiency');
    expect(susReason({ ...VALID, vibe_score: 50_001 })).toBe('vibe');
    expect(susReason({ ...VALID, achievements: ['fake-badge'] })).toBe('achievements');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/validation.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`packages/worker/src/validation.ts`:

```ts
import { z } from 'zod';

export const KNOWN_ACHIEVEMENTS = [
  'token-billionaire', 'free-tier-martyr', 'cache-whisperer', 'polyglot',
  'monorepo-menace', 'streak-freak', '3am-committer', 'yolo-force-pusher',
] as const;

export const submitPayloadSchema = z
  .object({
    client_version: z.string().max(20),
    vibe_score: z.number().nonnegative(),
    loc: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    cost_usd: z.number().nonnegative(),
    tok_per_usd: z.number().nonnegative().nullable(),
    achievements: z.array(z.string().max(40)).max(32),
    breakdown: z.record(z.string().max(40), z.number()),
  })
  .strict();

export type SubmitPayload = z.infer<typeof submitPayloadSchema>;

const KNOWN = new Set<string>(KNOWN_ACHIEVEMENTS);

export function susReason(p: SubmitPayload): string | null {
  if (p.loc > 50_000_000) return 'loc';
  if (p.tokens > 100_000_000_000) return 'tokens';
  if (p.tokens > 1_000_000 && p.cost_usd < 0.01) return 'cost';
  if (p.tok_per_usd !== null && p.tok_per_usd > 100_000_000) return 'efficiency';
  if (p.vibe_score > 50_000) return 'vibe';
  if (p.achievements.some((a) => !KNOWN.has(a))) return 'achievements';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/validation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/validation.ts packages/worker/test/validation.test.ts
git commit -m "feat(worker): zod payload schema + sanity caps (sus detection)"
```

---

### Task 4: GitHub token verification

**Files:**
- Create: `packages/worker/src/github.ts`
- Test: `packages/worker/test/github.test.ts`

**Interfaces:**
- Consumes: `GhUser` shape (Task 2).
- Produces: `verifyGithubToken(token: string, fetchImpl?: typeof fetch): Promise<GhUser | null>` — GET `https://api.github.com/user` with `Authorization: Bearer <token>`; null on non-200/malformed; 5s timeout; maps `{ id→gh_id, login→gh_login, avatar_url, created_at→gh_created_at }`.

- [ ] **Step 1: Write the failing test**

`packages/worker/test/github.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verifyGithubToken } from '../src/github.js';

const okFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  expect(String(url)).toBe('https://api.github.com/user');
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok_1');
  return new Response(
    JSON.stringify({ id: 42, login: 'master5d', avatar_url: 'https://a.png', created_at: '2020-01-01T00:00:00Z' }),
    { status: 200 },
  );
}) as typeof fetch;

describe('verifyGithubToken', () => {
  it('maps a valid /user response to GhUser', async () => {
    const u = await verifyGithubToken('tok_1', okFetch);
    expect(u).toEqual({ gh_id: 42, gh_login: 'master5d', avatar_url: 'https://a.png', gh_created_at: '2020-01-01T00:00:00Z' });
  });
  it('returns null on 401', async () => {
    const bad = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    expect(await verifyGithubToken('nope', bad)).toBeNull();
  });
  it('returns null on thrown fetch', async () => {
    const boom = (async () => { throw new Error('net'); }) as typeof fetch;
    expect(await verifyGithubToken('tok', boom)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/github.test.ts` — FAIL (module missing).

- [ ] **Step 3: Write the implementation**

`packages/worker/src/github.ts`:

```ts
import type { GhUser } from './db.js';

export async function verifyGithubToken(token: string, fetchImpl: typeof fetch = fetch): Promise<GhUser | null> {
  try {
    const res = await fetchImpl('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'viberuler-api',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: number; login?: string; avatar_url?: string; created_at?: string };
    if (typeof body.id !== 'number' || typeof body.login !== 'string') return null;
    return {
      gh_id: body.id,
      gh_login: body.login,
      avatar_url: body.avatar_url ?? null,
      gh_created_at: body.created_at ?? null,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/github.test.ts` — PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/github.ts packages/worker/test/github.test.ts
git commit -m "feat(worker): github token verification"
```

---

### Task 5: POST /api/submit

**Files:**
- Create: `packages/worker/src/routes/submit.ts`
- Modify: `packages/worker/src/index.ts` (wire route)
- Test: `packages/worker/test/submit.test.ts`

**Interfaces:**
- Consumes: `verifyGithubToken` (T4), `submitPayloadSchema`/`susReason` (T3), `upsertUser`/`insertScore`/`submitsInLastHour`/`rankFor`/`percentileFor` (T2), `json` helper (T1).
- Produces: `handleSubmit(req, env, url): Promise<Response>`. Statuses: 401 (bad/missing token), 400 (invalid payload, zod message in `{ error }`), 429 (rate limit), 200 `{ ok: true, url, login, rank, percentile, sus }` (rank/percentile null when sus).
- Integration tests use `fetchMock` from `cloudflare:test` to stub `api.github.com` (pattern: `fetchMock.activate(); fetchMock.disableNetConnect(); fetchMock.get('https://api.github.com').intercept({ path: '/user' }).reply(200, {...})`).

- [ ] **Step 1: Write the failing test**

`packages/worker/test/submit.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { fetchMock } from 'cloudflare:test';

const VALID = {
  client_version: '0.1.0', vibe_score: 3101, loc: 312441, projects: 47,
  tokens: 1_200_000_000, cost_usd: 184.2, tok_per_usd: 6_500_000,
  achievements: ['token-billionaire'], breakdown: { volume: 1000 },
};

const GH_USER = { id: 42, login: 'master5d', avatar_url: 'https://a.png', created_at: '2020-01-01T00:00:00Z' };

function mockGithub(status = 200, body: object = GH_USER) {
  fetchMock.get('https://api.github.com').intercept({ path: '/user' }).reply(status, JSON.stringify(body));
}

function post(payload: unknown, token = 'tok_1') {
  return exports.default.fetch('https://viberuler.dev/api/submit', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('POST /api/submit', () => {
  it('401 without a token', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/api/submit', {
      method: 'POST', body: JSON.stringify(VALID), headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('401 when github rejects the token', async () => {
    mockGithub(401, {});
    expect((await post(VALID)).status).toBe(401);
  });

  it('400 on invalid payload', async () => {
    mockGithub();
    expect((await post({ ...VALID, evil: 1 })).status).toBe(400);
  });

  it('200 stores score and returns url + rank + percentile', async () => {
    mockGithub();
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.login).toBe('master5d');
    expect(body.url).toBe('https://viberuler.dev/u/master5d');
    expect(body.rank).toBe(1);
    expect(body.sus).toBe(false);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('caps trip sus: stored but rank null', async () => {
    mockGithub();
    const res = await post({ ...VALID, loc: 50_000_001 });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.sus).toBe(true);
    expect(body.rank).toBeNull();
  });

  it('429 on the 6th submit within an hour', async () => {
    for (let i = 0; i < 5; i++) {
      mockGithub();
      expect((await post(VALID)).status).toBe(200);
    }
    mockGithub();
    expect((await post(VALID)).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/submit.test.ts` — FAIL (route returns 404).

- [ ] **Step 3: Write the route + wire it**

`packages/worker/src/routes/submit.ts`:

```ts
import type { Env } from '../index.js';
import { json } from '../index.js';
import { verifyGithubToken } from '../github.js';
import { submitPayloadSchema, susReason } from '../validation.js';
import { upsertUser, insertScore, submitsInLastHour, rankFor, percentileFor } from '../db.js';

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

  const reason = susReason(payload);
  await insertScore(env.DB, userId, payload, reason !== null);

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
```

In `src/index.ts`, add import and route (inside the try block, before the 404):

```ts
import { handleSubmit } from './routes/submit.js';
// ...
if (request.method === 'POST' && pathname === '/api/submit') {
  return handleSubmit(request, env, url);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/submit.test.ts` — PASS (6 tests). Then full worker suite: `npx vitest run` — all green.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/routes/submit.ts packages/worker/src/index.ts packages/worker/test/submit.test.ts
git commit -m "feat(worker): POST /api/submit — auth, validation, caps, rate limit"
```

---

### Task 6: Leaderboard + percentile endpoints

**Files:**
- Create: `packages/worker/src/routes/leaderboard.ts`
- Modify: `packages/worker/src/index.ts`
- Test: `packages/worker/test/leaderboard.test.ts`

**Interfaces:**
- Consumes: `leaderboard`/`percentileFor` (T2), `json` (T1).
- Produces:
  - `GET /api/leaderboard?page=1` → `{ page, total, rows: [{ rank, login, avatar_url, vibe_score, tok_per_usd, achievements: string[], submitted_at }] }`, header `Cache-Control: public, max-age=60`; rank is global (offset-aware); page clamped ≥1.
  - `GET /api/percentile?tok_per_usd=<num>` → `{ percentile, sample }`; 400 on missing/NaN param.

- [ ] **Step 1: Write the failing test**

`packages/worker/test/leaderboard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/leaderboard.test.ts` — FAIL (404s).

- [ ] **Step 3: Write the routes + wire**

`packages/worker/src/routes/leaderboard.ts`:

```ts
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
```

Wire in `src/index.ts` (GET branch):

```ts
import { handleLeaderboard, handlePercentile } from './routes/leaderboard.js';
// ...
if (request.method === 'GET' && pathname === '/api/leaderboard') return handleLeaderboard(request, env, url);
if (request.method === 'GET' && pathname === '/api/percentile') return handlePercentile(request, env, url);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/leaderboard.test.ts` — PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/routes/leaderboard.ts packages/worker/src/index.ts packages/worker/test/leaderboard.test.ts
git commit -m "feat(worker): leaderboard + percentile endpoints (edge-cached 60s)"
```

---

### Task 7: Share page /u/:login + stats badge

**Files:**
- Create: `packages/worker/src/routes/share.ts`
- Create: `packages/worker/src/routes/badge.ts`
- Modify: `packages/worker/src/index.ts`
- Test: `packages/worker/test/share.test.ts`

**Interfaces:**
- Consumes: `latestForLogin`/`totals` (T2), `json` (T1).
- Produces:
  - `GET /u/:login` → full HTML page (content-type `text/html; charset=utf-8`): dark terminal aesthetic, monospace, the user's vibe score/rank/achievements, a `<button>`+`<code>npx viberuler</code>` copy block, OG meta tags (`og:image` → `/og/:login.png`, `twitter:card` = `summary_large_image`). Unknown login → 404 HTML page with NPC joke + the same `npx viberuler` CTA. Sus rows render the page WITHOUT rank (shows score, marked `unranked`).
  - `GET /api/stats-badge` → shields.io endpoint JSON `{ schemaVersion: 1, label: 'tokens benchmarked', message: <compact>, color: 'blueviolet' }`, cache 300s. `fmtCompact` duplicated locally (8 lines — do NOT import across packages).
  - `escapeHtml(s: string): string` exported from share.ts — login goes into HTML.

- [ ] **Step 1: Write the failing test**

`packages/worker/test/share.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { upsertUser, insertScore } from '../src/db.js';
import { escapeHtml } from '../src/routes/share.js';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
  const a = await upsertUser(env.DB, { gh_id: 1, gh_login: 'master5d', avatar_url: null, gh_created_at: null });
  await insertScore(env.DB, a, {
    vibe_score: 3101, loc: 312441, projects: 47, tokens: 1_200_000_000, cost_usd: 184.2,
    tok_per_usd: 6_500_000, achievements: ['token-billionaire'], breakdown: {}, client_version: '0.1.0',
  }, false);
});

describe('GET /u/:login', () => {
  it('renders the share page with score, rank, og meta and CTA', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/u/master5d');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('master5d');
    expect(html).toContain('3,101');
    expect(html).toContain('npx viberuler');
    expect(html).toContain('og:image');
    expect(html).toContain('/og/master5d.png');
    expect(html).toContain('summary_large_image');
  });

  it('404 page for unknown login still sells the CTA', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/u/ghost');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('npx viberuler');
  });
});

describe('escapeHtml', () => {
  it('escapes the dangerous five', () => {
    expect(escapeHtml(`<img src=x onerror="a&'b">`)).toBe('&lt;img src=x onerror=&quot;a&amp;&#39;b&quot;&gt;');
  });
});

describe('GET /api/stats-badge', () => {
  it('returns shields endpoint schema', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/api/stats-badge');
    const body = (await res.json()) as any;
    expect(body.schemaVersion).toBe(1);
    expect(body.label).toBe('tokens benchmarked');
    expect(body.message).toBe('1.2B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/share.test.ts` — FAIL.

- [ ] **Step 3: Write the routes + wire**

`packages/worker/src/routes/share.ts`:

```ts
import type { Env } from '../index.js';
import { latestForLogin } from '../db.js';

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

const PAGE_CSS = `
  body{background:#0b0e14;color:#e6e6e6;font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;
       display:flex;flex-direction:column;align-items:center;padding:48px 16px;margin:0}
  .card{border:1px solid #2a2f3a;border-radius:12px;padding:32px;max-width:560px;width:100%;
        background:#11151f;box-shadow:0 0 40px rgba(140,82,255,.25)}
  h1{color:#b388ff;font-size:20px;margin:0 0 16px}
  .vibe{font-size:42px;color:#69f0ae;margin:8px 0}
  .rank{color:#ff80ab;letter-spacing:1px}
  .badges{color:#ffd54f;margin-top:12px}
  .cta{margin-top:28px;text-align:center}
  code{background:#1a1f2b;border:1px solid #2a2f3a;border-radius:8px;padding:12px 20px;
       font-size:18px;color:#69f0ae;display:inline-block;cursor:pointer}
  .hint{color:#666;font-size:12px;margin-top:8px}
`;

function page(title: string, ogLogin: string | null, body: string, origin: string): string {
  const og = ogLogin
    ? `<meta property="og:image" content="${origin}/og/${encodeURIComponent(ogLogin)}.png">
       <meta name="twitter:card" content="summary_large_image">
       <meta name="twitter:image" content="${origin}/og/${encodeURIComponent(ogLogin)}.png">`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}">${og}
    <style>${PAGE_CSS}</style></head>
    <body>${body}
    <div class="cta"><code onclick="navigator.clipboard.writeText('npx viberuler')">npx viberuler</code>
    <div class="hint">click to copy — get YOUR vibe score</div></div>
    </body></html>`;
}

export async function handleShare(_req: Request, env: Env, url: URL): Promise<Response> {
  const login = decodeURIComponent(url.pathname.slice('/u/'.length));
  const row = await latestForLogin(env.DB, login);
  const headers = { 'content-type': 'text/html; charset=utf-8' };

  if (!row) {
    const body = `<div class="card"><h1>404 — NPC detected</h1>
      <p>No vibes found for <b>${escapeHtml(login)}</b>. This player hasn't entered the arena.</p></div>`;
    return new Response(page('viberuler — NPC', null, body, url.origin), { status: 404, headers });
  }

  const safe = escapeHtml(row.gh_login);
  const achievements = (JSON.parse(row.achievements) as string[]).join(' · ');
  const rankLine = row.sus ? '<div class="rank">UNRANKED (under review)</div>'
    : `<div class="rank">GLOBAL RANK #${row.rank}</div>`;
  const body = `<div class="card"><h1>@${safe} on VIBERULER</h1>
    <div class="vibe">${fmtInt(row.vibe_score)}</div>
    ${rankLine}
    ${row.tok_per_usd !== null ? `<div>${fmtInt(row.tok_per_usd)} tokens per dollar</div>` : ''}
    <div class="badges">${escapeHtml(achievements)}</div></div>`;
  return new Response(page(`@${row.gh_login} — VIBE ${fmtInt(row.vibe_score)}`, row.gh_login, body, url.origin), {
    status: 200, headers,
  });
}
```

`packages/worker/src/routes/badge.ts`:

```ts
import type { Env } from '../index.js';
import { json } from '../index.js';
import { totals } from '../db.js';

function fmtCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

export async function handleBadge(_req: Request, env: Env): Promise<Response> {
  const t = await totals(env.DB);
  return json(
    { schemaVersion: 1, label: 'tokens benchmarked', message: fmtCompact(t.tokens), color: 'blueviolet' },
    200,
    { 'cache-control': 'public, max-age=300' },
  );
}
```

Wire in `src/index.ts`:

```ts
import { handleShare } from './routes/share.js';
import { handleBadge } from './routes/badge.js';
// ...
if (request.method === 'GET' && pathname.startsWith('/u/')) return handleShare(request, env, url);
if (request.method === 'GET' && pathname === '/api/stats-badge') return handleBadge(request, env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/share.test.ts` — PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/routes/share.ts packages/worker/src/routes/badge.ts packages/worker/src/index.ts packages/worker/test/share.test.ts
git commit -m "feat(worker): share page /u/:login + shields stats badge"
```

---

### Task 8: OG image /og/:login.png

**Files:**
- Create: `packages/worker/src/routes/og.ts`
- Create: `packages/worker/src/assets/JetBrainsMono-Regular.ttf` (vendored binary)
- Modify: `packages/worker/src/index.ts`
- Modify: `packages/worker/package.json` (add `workers-og` dep)
- Test: `packages/worker/test/og.test.ts`

**Interfaces:**
- Consumes: `latestForLogin` (T2); `workers-og` `ImageResponse(html, { width, height, fonts })`.
- Produces: `GET /og/:login.png` → 1200×630 PNG, dark neon card (login, VIBE score, rank, tok/$); 404 JSON for unknown login; `Cache-Control: public, max-age=3600`.

- [ ] **Step 1: Vendor the font + install workers-og**

```bash
# from packages/worker
mkdir -p src/assets
curl -L -o src/assets/JetBrainsMono-Regular.ttf https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf
cd ../.. && npm i -w viberuler-api workers-og@latest
```

(JetBrains Mono is OFL-licensed — vendoring is fine; note it in Plan 3's README credits.)

- [ ] **Step 2: Write the failing test**

`packages/worker/test/og.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { upsertUser, insertScore } from '../src/db.js';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
  const a = await upsertUser(env.DB, { gh_id: 1, gh_login: 'master5d', avatar_url: null, gh_created_at: null });
  await insertScore(env.DB, a, {
    vibe_score: 3101, loc: 1, projects: 1, tokens: 1000, cost_usd: 1,
    tok_per_usd: 1000, achievements: [], breakdown: {}, client_version: '0.1.0',
  }, false);
});

describe('GET /og/:login.png', () => {
  it('renders a PNG for a known login', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/og/master5d.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const buf = new Uint8Array(await res.arrayBuffer());
    // PNG magic bytes
    expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('404 for unknown login', async () => {
    expect((await exports.default.fetch('https://viberuler.dev/og/ghost.png')).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/og.test.ts` — FAIL (404 route).

- [ ] **Step 4: Write the route + wire**

`packages/worker/src/routes/og.ts`:

```ts
import { ImageResponse } from 'workers-og';
import type { Env } from '../index.js';
import { json } from '../index.js';
import { latestForLogin } from '../db.js';
import { escapeHtml } from './share.js';
// wrangler Data rule (wrangler.jsonc "rules") imports .ttf as ArrayBuffer
import font from '../assets/JetBrainsMono-Regular.ttf';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export async function handleOg(_req: Request, env: Env, url: URL): Promise<Response> {
  const m = url.pathname.match(/^\/og\/(.+)\.png$/);
  const login = m?.[1] ? decodeURIComponent(m[1]) : null;
  const row = login ? await latestForLogin(env.DB, login) : null;
  if (!row) return json({ error: 'not found' }, 404);

  const rankLine = row.sus ? 'UNRANKED' : `GLOBAL RANK #${row.rank}`;
  const html = `
    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;
                width:100%;height:100%;background:#0b0e14;color:#e6e6e6;
                font-family:'JetBrains Mono';padding:60px">
      <div style="display:flex;font-size:36px;color:#b388ff">@${escapeHtml(row.gh_login)} · VIBERULER</div>
      <div style="display:flex;font-size:120px;color:#69f0ae;margin:20px 0">${fmtInt(row.vibe_score)}</div>
      <div style="display:flex;font-size:40px;color:#ff80ab">${rankLine}</div>
      ${row.tok_per_usd !== null
        ? `<div style="display:flex;font-size:30px;color:#ffd54f;margin-top:16px">${fmtInt(row.tok_per_usd)} tokens per dollar</div>`
        : ''}
      <div style="display:flex;font-size:26px;color:#666;margin-top:30px">npx viberuler</div>
    </div>`;

  const img = new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: [{ name: 'JetBrains Mono', data: font as unknown as ArrayBuffer, weight: 400, style: 'normal' }],
  });
  const headers = new Headers(img.headers);
  headers.set('cache-control', 'public, max-age=3600');
  return new Response(img.body, { status: img.status, headers });
}
```

Add a module declaration so TS accepts the binary import — append to `packages/worker/test/env.d.ts` or create `packages/worker/src/assets.d.ts`:

```ts
declare module '*.ttf' {
  const data: ArrayBuffer;
  export default data;
}
```

Wire in `src/index.ts`:

```ts
import { handleOg } from './routes/og.js';
// ...
if (request.method === 'GET' && pathname.startsWith('/og/')) return handleOg(request, env, url);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/og.test.ts` — PASS (2 tests). If satori/resvg WASM fails to load inside the vitest pool, report DONE_WITH_CONCERNS with the exact error — do NOT delete the route; the controller will decide (fallback: mark the og test `it.skip` with a `// TODO(launch): verify via wrangler dev` note and verify in `npm run check` dry-run bundling instead).

- [ ] **Step 6: Full worker suite + dry-run bundle check**

Run: `npx vitest run` — all green. Run: `npm run check` (wrangler deploy --dry-run) — bundle builds with wasm + ttf.

- [ ] **Step 7: Commit**

```bash
git add packages/worker/src packages/worker/test packages/worker/package.json package-lock.json
git commit -m "feat(worker): OG image endpoint via workers-og + vendored JetBrains Mono"
```

---

### Task 9: CLI submit module — device flow, share links

**Files:**
- Create: `packages/cli/src/submit.ts`
- Test: `packages/cli/test/submit.test.ts`

**Interfaces:**
- Consumes: `SubmitPayload` (Plan 1 payload.ts).
- Produces (cli.ts wires these in Task 10):
  - `const DEFAULT_API = 'https://viberuler.dev'` (override env `VIBERULER_API`)
  - `const DEFAULT_CLIENT_ID = 'GITHUB_CLIENT_ID_PLACEHOLDER'` (override env `VIBERULER_GITHUB_CLIENT_ID`)
  - `interface SubmitDeps { fetchImpl?: typeof fetch; out: (s: string) => void; pollIntervalMs?: number }`
  - `githubDeviceFlow(clientId: string, deps: SubmitDeps): Promise<string>` — POST `https://github.com/login/device/code` (JSON accept, body `{ client_id, scope: '' }`), print `user_code` + `verification_uri`, poll `https://github.com/login/oauth/access_token` (`grant_type: 'urn:ietf:params:oauth:grant-type:device_code'`) honoring `authorization_pending`/`slow_down` (+5s)/`expired_token` (throw); returns access token. No client secret — device flow doesn't need one.
  - `fetchPercentile(apiBase: string, tokPerUsd: number, fetchImpl?): Promise<number | null>` — GET `/api/percentile?tok_per_usd=`, 3s timeout, null on any failure (offline fallback stays).
  - `submitScore(apiBase: string, token: string, payload: SubmitPayload, fetchImpl?): Promise<{ ok: boolean; status: number; url?: string; rank?: number | null; percentile?: number | null; sus?: boolean; error?: string }>`
  - `shareLinks(shareUrl: string, payload: SubmitPayload): { x: string; linkedin: string; bluesky: string }` — pre-filled intent URLs, text like `I burned <tokens> tokens for $<cost>. VIBE score <score>. What's yours? npx viberuler` (URL-encoded).

- [ ] **Step 1: Write the failing test**

`packages/cli/test/submit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { githubDeviceFlow, fetchPercentile, submitScore, shareLinks } from '../src/submit.js';

const PAYLOAD = {
  client_version: '0.1.0', vibe_score: 3101, loc: 100, projects: 1, tokens: 1_200_000_000,
  cost_usd: 184.2, tok_per_usd: 6_500_000, achievements: [], breakdown: {},
};

function seqFetch(responses: Array<() => Response>): typeof fetch {
  let i = 0;
  return (async () => responses[Math.min(i++, responses.length - 1)]!()) as typeof fetch;
}

describe('githubDeviceFlow', () => {
  it('prints the user code and polls until token', async () => {
    const lines: string[] = [];
    const fetchImpl = seqFetch([
      () => new Response(JSON.stringify({
        device_code: 'dev1', user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device', interval: 0,
      }), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 200 }),
      () => new Response(JSON.stringify({ access_token: 'gho_tok' }), { status: 200 }),
    ]);
    const token = await githubDeviceFlow('cid', { fetchImpl, out: (s) => lines.push(s), pollIntervalMs: 1 });
    expect(token).toBe('gho_tok');
    expect(lines.join('\n')).toContain('ABCD-1234');
    expect(lines.join('\n')).toContain('github.com/login/device');
  });

  it('throws on expired_token', async () => {
    const fetchImpl = seqFetch([
      () => new Response(JSON.stringify({ device_code: 'd', user_code: 'X', verification_uri: 'u', interval: 0 }), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'expired_token' }), { status: 200 }),
    ]);
    await expect(githubDeviceFlow('cid', { fetchImpl, out: () => {}, pollIntervalMs: 1 })).rejects.toThrow(/expired/);
  });
});

describe('fetchPercentile', () => {
  it('returns percentile from the API', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ percentile: 0.87, sample: 10 }))) as typeof fetch;
    expect(await fetchPercentile('https://api.test', 100, fetchImpl)).toBe(0.87);
  });
  it('null on failure (offline fallback)', async () => {
    const fetchImpl = (async () => { throw new Error('offline'); }) as typeof fetch;
    expect(await fetchPercentile('https://api.test', 100, fetchImpl)).toBeNull();
  });
});

describe('submitScore', () => {
  it('POSTs payload with bearer and returns server body', async () => {
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.test/api/submit');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
      expect(JSON.parse(String(init?.body)).vibe_score).toBe(3101);
      return new Response(JSON.stringify({ ok: true, url: 'https://api.test/u/x', rank: 3, sus: false }), { status: 200 });
    }) as typeof fetch;
    const r = await submitScore('https://api.test', 'tok', PAYLOAD, fetchImpl);
    expect(r.ok).toBe(true);
    expect(r.rank).toBe(3);
  });
  it('surfaces 429 as error', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'rate limit' }), { status: 429 })) as typeof fetch;
    const r = await submitScore('https://api.test', 'tok', PAYLOAD, fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });
});

describe('shareLinks', () => {
  it('builds encoded intents for x/linkedin/bluesky', () => {
    const links = shareLinks('https://viberuler.dev/u/master5d', PAYLOAD);
    expect(links.x).toContain('https://twitter.com/intent/tweet?text=');
    expect(links.x).toContain(encodeURIComponent('npx viberuler'));
    expect(links.x).toContain(encodeURIComponent('https://viberuler.dev/u/master5d'));
    expect(links.linkedin).toContain('linkedin.com');
    expect(links.bluesky).toContain('bsky.app');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/submit.test.ts` (from `packages/cli`) — FAIL.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/submit.ts`:

```ts
import type { SubmitPayload } from './payload.js';
import { fmtCompact, fmtUsd } from './format.js';

export const DEFAULT_API = 'https://viberuler.dev';
export const DEFAULT_CLIENT_ID = 'GITHUB_CLIENT_ID_PLACEHOLDER';

export interface SubmitDeps {
  fetchImpl?: typeof fetch;
  out: (s: string) => void;
  pollIntervalMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function githubDeviceFlow(clientId: string, deps: SubmitDeps): Promise<string> {
  const doFetch = deps.fetchImpl ?? fetch;
  const codeRes = await doFetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: '' }),
  });
  if (!codeRes.ok) throw new Error(`device code request failed: ${codeRes.status}`);
  const code = (await codeRes.json()) as {
    device_code: string; user_code: string; verification_uri: string; interval?: number;
  };

  deps.out('');
  deps.out(`  Open ${code.verification_uri} and enter code: ${code.user_code}`);
  deps.out('  Waiting for authorization...');

  let interval = deps.pollIntervalMs ?? Math.max(1, code.interval ?? 5) * 1000;
  for (;;) {
    await sleep(interval);
    const tokenRes = await doFetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: code.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const body = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (body.access_token) return body.access_token;
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') { interval += 5000; continue; }
    throw new Error(`device flow ${body.error ?? 'failed'}${body.error === 'expired_token' ? ' — code expired, run again' : ''}`);
  }
}

export async function fetchPercentile(
  apiBase: string,
  tokPerUsd: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const res = await fetchImpl(`${apiBase}/api/percentile?tok_per_usd=${encodeURIComponent(tokPerUsd)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { percentile?: number };
    return typeof body.percentile === 'number' ? body.percentile : null;
  } catch {
    return null;
  }
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  url?: string;
  rank?: number | null;
  percentile?: number | null;
  sus?: boolean;
  error?: string;
}

export async function submitScore(
  apiBase: string,
  token: string,
  payload: SubmitPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitResult> {
  try {
    const res = await fetchImpl(`${apiBase}/api/submit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: String(body.error ?? res.status) };
    return { ok: true, status: res.status, ...body } as SubmitResult;
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export function shareLinks(shareUrl: string, payload: SubmitPayload): { x: string; linkedin: string; bluesky: string } {
  const text = `I burned ${fmtCompact(payload.tokens)} tokens for ${fmtUsd(payload.cost_usd)}. VIBE score ${payload.vibe_score}. What's yours? npx viberuler ${shareUrl}`;
  const enc = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${enc}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    bluesky: `https://bsky.app/intent/compose?text=${enc}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/submit.test.ts` — PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/submit.ts packages/cli/test/submit.test.ts
git commit -m "feat(cli): submit module — device flow, live percentile, share links"
```

---

### Task 10: Wire --submit into cli.ts

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/cli-submit.test.ts`

**Interfaces:**
- Consumes: everything from Task 9; existing `main()` structure, `buildPayload`, `computeScore`, `renderCard`.
- Produces: `--submit` and `--yes` flags. Flow after stats collection:
  1. live percentile: `fetchPercentile(apiBase, tokPerUsd)` → recompute score with override when non-null (only in submit mode — default run stays offline)
  2. render card
  3. print exact payload JSON + banner `This is EVERYTHING that leaves your machine:`
  4. without `--yes` and non-TTY stdin → abort with exit 1 and message `refusing to submit without --yes in non-interactive mode`; with TTY → readline y/N confirm
  5. device flow → submitScore → print share URL + shareLinks (x/linkedin/bluesky)
  6. submit failure → stderr message, exit 1
- Seam for tests: `main` accepts optional third param `deps?: { fetchImpl?: typeof fetch }` threaded into fetchPercentile/deviceFlow/submitScore.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/cli-submit.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

const fixture = fileURLToPath(new URL('./fixtures/claude/session-a.jsonl', import.meta.url));
let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'vibe-submit-'));
  const proj = join(home, '.claude', 'projects', 'p1');
  await mkdir(proj, { recursive: true });
  await copyFile(fixture, join(proj, 's.jsonl'));
  process.env.VIBERULER_HOME = home;
  process.env.VIBERULER_API = 'https://api.test';
});

afterAll(() => {
  delete process.env.VIBERULER_HOME;
  delete process.env.VIBERULER_API;
});

function mockNet(): { calls: string[]; fetchImpl: typeof fetch } {
  const calls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/percentile')) return new Response(JSON.stringify({ percentile: 0.9, sample: 5 }));
    if (u.includes('login/device/code'))
      return new Response(JSON.stringify({ device_code: 'd', user_code: 'AB-12', verification_uri: 'https://gh/dev', interval: 0 }));
    if (u.includes('login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'tok' }));
    if (u.includes('/api/submit'))
      return new Response(JSON.stringify({ ok: true, url: 'https://api.test/u/me', rank: 2, percentile: 0.9, sus: false }));
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('main --submit', () => {
  it('runs the full flow with --yes: percentile → payload print → device flow → submit → share links', async () => {
    const lines: string[] = [];
    const { calls, fetchImpl } = mockNet();
    const code = await main(['--submit', '--yes', '--scan-dir', home], (l) => lines.push(l), { fetchImpl });
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('EVERYTHING that leaves your machine');
    expect(text).toContain('AB-12');
    expect(text).toContain('https://api.test/u/me');
    expect(text).toContain('twitter.com/intent/tweet');
    expect(calls.some((c) => c.includes('/api/percentile'))).toBe(true);
    expect(calls.some((c) => c.includes('/api/submit'))).toBe(true);
  });

  it('refuses without --yes when stdin is not a TTY', async () => {
    const { fetchImpl } = mockNet();
    const code = await main(['--submit', '--scan-dir', home], () => {}, { fetchImpl });
    expect(code).toBe(1);
  });

  it('default run makes zero network calls', async () => {
    const { calls, fetchImpl } = mockNet();
    const code = await main(['--no-color', '--scan-dir', home], () => {}, { fetchImpl });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli-submit.test.ts` — FAIL (unknown --submit flag → exit 1 on first test).

- [ ] **Step 3: Modify cli.ts**

Add to `parseArgs` options: `submit: { type: 'boolean' }, yes: { type: 'boolean' }`.
Extend `main` signature: `export async function main(argv: string[], out: (line: string) => void = console.log, deps: { fetchImpl?: typeof fetch } = {}): Promise<number>`.
After `const stats = await collectAll(...)` and warnings, replace the report computation with:

```ts
import { DEFAULT_API, DEFAULT_CLIENT_ID, githubDeviceFlow, fetchPercentile, submitScore, shareLinks } from './submit.js';
import { totalTokens } from './merge.js';
import { createInterface } from 'node:readline/promises';
// ...
let report = computeScore(stats);

if (values.submit) {
  const apiBase = process.env.VIBERULER_API ?? DEFAULT_API;
  const clientId = process.env.VIBERULER_GITHUB_CLIENT_ID ?? DEFAULT_CLIENT_ID;

  if (report.tokPerUsd !== null) {
    const live = await fetchPercentile(apiBase, report.tokPerUsd, deps.fetchImpl);
    if (live !== null) report = computeScore(stats, live);
  }

  const colors = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !values['no-color'];
  out(renderCard(report, { colors, version: version() }));

  const payload = buildPayload(report, version());
  out('');
  out('This is EVERYTHING that leaves your machine:');
  out(JSON.stringify(payload, null, 2));

  if (!values.yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write('refusing to submit without --yes in non-interactive mode\n');
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = (await rl.question('Submit to the global leaderboard? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') { out('aborted.'); return 1; }
  }

  try {
    const token = await githubDeviceFlow(clientId, { fetchImpl: deps.fetchImpl, out });
    const result = await submitScore(apiBase, token, payload, deps.fetchImpl);
    if (!result.ok) {
      process.stderr.write(`submit failed (${result.status}): ${result.error ?? 'unknown'}\n`);
      return 1;
    }
    out('');
    out(`  LIVE: ${result.url}${result.rank ? `  ·  GLOBAL RANK #${result.rank}` : ''}${result.sus ? '  (under review)' : ''}`);
    const links = shareLinks(result.url ?? apiBase, payload);
    out('');
    out('  Flex it:');
    out(`    X:        ${links.x}`);
    out(`    LinkedIn: ${links.linkedin}`);
    out(`    Bluesky:  ${links.bluesky}`);
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
```

The existing payload/json/card branches stay unchanged below (they run only when `!values.submit`).

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/cli-submit.test.ts` — PASS (3 tests). Then FULL cli suite: `npx vitest run` — all green (67+). Typecheck + build: `npm run typecheck && npm run build` — clean; smoke `node dist/bin.js --help` shows `--submit`.

- [ ] **Step 5: Update USAGE text**

Add to the USAGE constant: `  --submit             push your score to the global leaderboard (GitHub device flow)` and `  --yes                skip the submit confirmation`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/test/cli-submit.test.ts
git commit -m "feat(cli): --submit flow — live percentile, payload transparency, device flow, share links"
```

---

### Task 11: CI + deploy docs

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `packages/worker/DEPLOY.md`

**Interfaces:**
- Consumes: root scripts (already run both workspaces after Task 1).
- Produces: CI covers worker tests + dry-run bundle; DEPLOY.md documents the launch-day sequence (Plan 3 references it).

- [ ] **Step 1: Extend CI**

In `.github/workflows/ci.yml`, after the build step add:

```yaml
      - run: npm run check -w viberuler-api
```

(`npm test` at root already runs worker tests after Task 1's script change — verify the file's test step is just `npm test`.)

- [ ] **Step 2: Write DEPLOY.md**

`packages/worker/DEPLOY.md`:

```markdown
# Deploying viberuler-api

One-time (launch day):

1. `npx wrangler d1 create viberuler` → paste `database_id` into wrangler.jsonc
2. `npx wrangler d1 migrations apply viberuler --remote`
3. Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps):
   - Device flow: ENABLED; callback URL not needed for device flow
   - Put the Client ID into wrangler.jsonc `vars.GITHUB_CLIENT_ID` and ship the same
     value as `DEFAULT_CLIENT_ID` in packages/cli/src/submit.ts (it is public)
4. `npx wrangler deploy`
5. Custom domain: Workers → viberuler-api → Domains → add viberuler.dev
6. Smoke: `curl https://viberuler.dev/api/health` → `{"ok":true}`
7. Seed the board: `npx viberuler --submit` from the owner machine

No secrets exist in this worker. `GITHUB_CLIENT_ID` is public by design.
```

- [ ] **Step 3: Verify locally**

Run from root: `npm run typecheck && npm test && npm run build && npm run check -w viberuler-api` — all green.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml packages/worker/DEPLOY.md
git commit -m "ci: worker tests + dry-run bundle; docs: DEPLOY.md launch sequence"
```

---

## Plan-level Definition of Done

- `npm test` at root runs BOTH workspaces green (cli ≥67 tests incl. submit flow; worker ≥25 tests incl. D1 integration).
- `npm run check -w viberuler-api` bundles the worker (wasm + ttf) without deploy.
- CLI default run: still zero network (regression-tested).
- `--submit --yes` against mocked network exercises: live percentile → card → payload print → device flow → submit → share links.
- Real deploy intentionally deferred to launch day (DEPLOY.md); no CF account state is touched by this plan.

## Deferred to Plan 3 (Release)

README + animated SVG terminal, METHODOLOGY.md, PRIVACY.md, vhs demo, npm publish (`prepublishOnly`, `npm ci` in CI, repository metadata), cursor/gemini collector `good first issue` stubs, github pagination fix, real OAuth App + D1 + domain + first deploy + Show HN.
