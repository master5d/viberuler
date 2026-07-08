# S5 Verified Tier + Server-Side Plausibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VibeRuler's leaderboard the most trustworthy in the category — add stateful server-side plausibility scoring (beyond static caps) with persisted, documented reasons — and, in the SAME coordinated schema bump, land the deferred S4 `tok_per_loc` field end-to-end (payload → D1 → share/OG) (epic S5, issue #16; carries the S4 board deferral).

**Architecture:** One D1 migration (`0002`) adds `tok_per_loc REAL` and `sus_reason TEXT` to `scores`. The CLI payload grows a tenth field, `tok_per_loc` (worker accepts it as **optional** so already-published 0.2 clients keep validating). A new pure `plausibilityReason(payload, ctx)` runs after the existing static `susReason`, using GitHub account age, the user's previous submission, and cross-field consistency to flag hand-crafted payloads; the reason string is persisted. Share/OG pages surface `tok_per_loc` (respecting the sus-hidden invariant). METHODOLOGY documents every heuristic verbatim — transparency is the integrity feature.

**Tech Stack:** Cloudflare Workers + D1, zod, vitest `@cloudflare/vitest-pool-workers`; TypeScript ESM. No new dependencies.

## Global Constraints

- **This is the sanctioned payload evolution: 9 keys → 10.** `tok_per_loc` is added deliberately. It stays aggregates-only. PRIVACY.md's "nine fields" copy MUST be updated to ten in this slice (Task 4). No OTHER key may be added.
- **Backwards compatibility is mandatory:** the published `viberuler@0.2.0` client sends 9 keys (no `tok_per_loc`). The worker schema must accept BOTH 9-key (0.2) and 10-key (0.3) payloads — `tok_per_loc` is `.nullable().optional()` in zod. A 0.2 submit must still succeed and store `tok_per_loc = NULL`.
- D1 migrations are additive and applied **remote-first** in prod (`npx wrangler d1 migrations apply viberuler --remote`) per DEPLOY.md; tests auto-apply via `readD1Migrations` (adding `0002_*.sql` to `migrations/` is picked up automatically).
- The **sus invariant holds everywhere**: a sus row is stored but excluded from the board, the rank, and public share/OG numbers. `tok_per_loc` display must obey it exactly like `tok_per_usd`.
- Plausibility thresholds are **named constants** and **documented verbatim in METHODOLOGY** — the anti-cheat is transparent by design (client-side caps are bypassable; the durable move is server-side scoring + honesty about it).
- `insertScore` keeps a backwards-compatible signature for its existing test callers (additive optional param), so unrelated worker tests don't churn.
- `packages/cli` keeps exactly ONE runtime dependency (`picocolors`); the worker adds no new dependency.

---

### Task 1: Schema bump — migration 0002 + payload/validation/db plumbing for `tok_per_loc`

**Files:**
- Create: `packages/worker/migrations/0002_tok_per_loc_and_sus_reason.sql`
- Modify: `packages/cli/src/payload.ts`
- Modify: `packages/worker/src/validation.ts:8-22`
- Modify: `packages/worker/src/db.ts` (`ScoreInput`, `insertScore`)
- Test: `packages/cli/test/payload.test.ts`, `packages/worker/test/validation.test.ts`

**Interfaces:**
- Consumes: `ScoreReport.tokPerLoc` (shipped in S4).
- Produces: CLI `SubmitPayload.tok_per_loc: number | null`; worker schema key `tok_per_loc` (optional/nullable); `ScoreInput.tok_per_loc: number | null`; `insertScore(db, userId, s, sus, reason?)` — a 5th optional `reason: string | null = null` param (Task 2 uses it). DB column `tok_per_loc REAL`, `sus_reason TEXT`.

- [ ] **Step 1: Write the migration** — create `packages/worker/migrations/0002_tok_per_loc_and_sus_reason.sql`:

```sql
ALTER TABLE scores ADD COLUMN tok_per_loc REAL;
ALTER TABLE scores ADD COLUMN sus_reason TEXT;
```

- [ ] **Step 2: Write the failing CLI payload test** — append to `packages/cli/test/payload.test.ts` inside its top-level `describe`:

```ts
  it('includes tok_per_loc (rounded, null-safe) as the tenth field', () => {
    const stats = { ...emptyStats(), locTotal: 1000, commits: 1, sources: ['git'],
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 4 };
    const p = buildPayload(computeScore(stats), '0.3.0');
    expect(p.tok_per_loc).toBe(2000); // 2,000,000 / 1000
    expect(Object.keys(p)).toHaveLength(10);
  });

  it('sends tok_per_loc: null when there is no LoC', () => {
    const stats = { ...emptyStats(), locTotal: 0, commits: 1, sources: ['git'],
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 4 };
    expect(buildPayload(computeScore(stats), '0.3.0').tok_per_loc).toBeNull();
  });
```

(The test file already imports `buildPayload`, `computeScore`, `emptyStats`.)

Also UPDATE the existing "leaks nothing beyond the fixed key set (privacy contract)" test in the SAME file — its `expect(Object.keys(p).sort()).toEqual([...])` currently lists 9 keys and WILL break when `buildPayload` emits the tenth. Add `'tok_per_loc'` to that array in sorted position (it sorts before `'tok_per_usd'`), making the expected array:

```ts
    expect(Object.keys(p).sort()).toEqual([
      'achievements', 'breakdown', 'client_version', 'cost_usd',
      'loc', 'projects', 'tok_per_loc', 'tok_per_usd', 'tokens', 'vibe_score',
    ]);
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/payload.test.ts` (cwd `packages/cli`)
Expected: FAIL — the two new tests fail (`tok_per_loc` undefined; key count 9), and the updated privacy-contract test now expects `tok_per_loc` but `buildPayload` doesn't emit it yet.

- [ ] **Step 4: Implement CLI payload** — in `packages/cli/src/payload.ts`, add the field to the interface (after `tok_per_usd`):

```ts
  tok_per_usd: number | null;
  tok_per_loc: number | null;
```

and to `buildPayload`'s returned object (after the `tok_per_usd` line):

```ts
    tok_per_usd: report.tokPerUsd === null ? null : Math.round(report.tokPerUsd),
    tok_per_loc: report.tokPerLoc === null ? null : Math.round(report.tokPerLoc),
```

- [ ] **Step 5: Write the failing worker validation tests** — append to `packages/worker/test/validation.test.ts` inside `describe('submitPayloadSchema', …)`:

```ts
  it('accepts a 0.3 payload carrying tok_per_loc', () => {
    expect(submitPayloadSchema.parse({ ...VALID, tok_per_loc: 8400 }).tok_per_loc).toBe(8400);
  });
  it('accepts a 0.2 payload with tok_per_loc absent (backwards compat)', () => {
    const parsed = submitPayloadSchema.parse(VALID); // VALID has no tok_per_loc
    expect(parsed.tok_per_loc).toBeUndefined();
  });
  it('accepts null tok_per_loc and rejects a negative one', () => {
    expect(submitPayloadSchema.parse({ ...VALID, tok_per_loc: null }).tok_per_loc).toBeNull();
    expect(() => submitPayloadSchema.parse({ ...VALID, tok_per_loc: -1 })).toThrow();
  });
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run test/validation.test.ts` (cwd `packages/worker`)
Expected: FAIL — `.strict()` rejects the unknown `tok_per_loc` key.

- [ ] **Step 7: Implement worker validation** — in `packages/worker/src/validation.ts`, add to the schema object (after the `tok_per_usd` line, before `achievements`):

```ts
    tok_per_usd: z.number().nonnegative().nullable(),
    tok_per_loc: z.number().nonnegative().nullable().optional(),
```

- [ ] **Step 8: Extend db.ts.** In `packages/worker/src/db.ts`, add to `ScoreInput` (after `tok_per_usd`):

```ts
  tok_per_usd: number | null;
  tok_per_loc?: number | null;
```

Replace `insertScore` with a backwards-compatible signature (adds `tok_per_loc` column, keeps `sus: boolean`, adds optional `reason`):

```ts
export async function insertScore(
  db: D1Database,
  userId: number,
  s: ScoreInput,
  sus: boolean,
  reason: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO scores (user_id, vibe_score, loc, projects, tokens, cost_usd, tok_per_usd, tok_per_loc, achievements, breakdown, sus, sus_reason, client_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId, s.vibe_score, s.loc, s.projects, s.tokens, s.cost_usd, s.tok_per_usd, s.tok_per_loc ?? null,
      JSON.stringify(s.achievements), JSON.stringify(s.breakdown), sus ? 1 : 0, reason, s.client_version,
    )
    .run();
}
```

- [ ] **Step 9: Run both suites**

Run: `npx vitest run` (cwd `packages/cli`) then `npx vitest run` (cwd `packages/worker`)
Expected: ALL PASS. Worker tests auto-apply migration 0002; existing `insertScore(db, id, s, false)` callers still compile (4th arg boolean, 5th defaulted).

- [ ] **Step 10: Commit**

```bash
git add packages/worker/migrations/0002_tok_per_loc_and_sus_reason.sql packages/cli/src/payload.ts packages/worker/src/validation.ts packages/worker/src/db.ts packages/cli/test/payload.test.ts packages/worker/test/validation.test.ts
git commit -m "feat(schema): tok_per_loc tenth payload field + sus_reason column, migration 0002 (S5, #16)"
```

### Task 2: Server-side plausibility scoring

**Files:**
- Modify: `packages/worker/src/validation.ts` (add `plausibilityReason` + constants)
- Modify: `packages/worker/src/db.ts` (add `previousScore`, `susRows` helpers)
- Modify: `packages/worker/src/routes/submit.ts`
- Test: `packages/worker/test/validation.test.ts`, `packages/worker/test/submit.test.ts`

**Interfaces:**
- Consumes: `SubmitPayload` (Task 1); `insertScore(…, reason)` (Task 1).
- Produces: `plausibilityReason(p: SubmitPayload, ctx: PlausibilityContext): string | null`; `interface PlausibilityContext { accountAgeDays: number | null; previous: { tokens: number; submittedAt: string } | null; now: string }`; `previousScore(db, userId)`; `susRows(db, limit)`.

- [ ] **Step 1: Write the failing plausibility unit tests** — append to `packages/worker/test/validation.test.ts`:

```ts
import { plausibilityReason } from '../src/validation.js';

const CTX = { accountAgeDays: 400, previous: null, now: '2026-07-08T00:00:00Z' };

describe('plausibilityReason', () => {
  it('passes an honest, self-consistent payload', () => {
    // breakdown sums to vibe_score, tok_per_usd ≈ tokens/cost
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 1_000_000, cost_usd: 1, tok_per_usd: 1_000_000 };
    expect(plausibilityReason(p, CTX)).toBeNull();
  });
  it('flags a breakdown that does not sum to vibe_score (hand-edited)', () => {
    const p = { ...VALID, vibe_score: 9000, breakdown: { volume: 10, leverage: 10 } };
    expect(plausibilityReason(p, CTX)).toBe('inconsistent-breakdown');
  });
  it('flags tok_per_usd that does not match tokens/cost', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 1_000_000, cost_usd: 1, tok_per_usd: 99_000_000 };
    expect(plausibilityReason(p, CTX)).toBe('inconsistent-efficiency');
  });
  it('flags a brand-new account claiming billions of tokens', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 2_000_000_000, cost_usd: 1000, tok_per_usd: 2_000_000 };
    expect(plausibilityReason(p, { ...CTX, accountAgeDays: 2 })).toBe('new-account-volume');
  });
  it('flags a superhuman token accumulation rate for the account age', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 30_000_000_000, cost_usd: 10_000, tok_per_usd: 3_000_000 };
    expect(plausibilityReason(p, { ...CTX, accountAgeDays: 10 })).toBe('token-rate');
  });
  it('flags an implausible token jump since the last submit', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 8_000_000_000, cost_usd: 4000, tok_per_usd: 2_000_000 };
    const ctx = { accountAgeDays: 400, now: '2026-07-08T00:00:00Z',
      previous: { tokens: 1_000_000, submittedAt: '2026-07-07T23:00:00Z' } };
    expect(plausibilityReason(p, ctx)).toBe('velocity');
  });
  it('skips account-age checks when age is unknown', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 2_000_000_000, cost_usd: 1000, tok_per_usd: 2_000_000 };
    expect(plausibilityReason(p, { accountAgeDays: null, previous: null, now: CTX.now })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/validation.test.ts` (cwd `packages/worker`)
Expected: FAIL — `plausibilityReason` not exported.

- [ ] **Step 3: Implement `plausibilityReason`** — append to `packages/worker/src/validation.ts`:

```ts
// Server-side plausibility scoring — stateful checks the static caps in susReason
// can't make. Thresholds are intentionally generous (flag the blatant, not the
// merely impressive) and are documented verbatim in METHODOLOGY §6.
export const PLAUSIBILITY = {
  newAccountDays: 7,          // "brand new" GitHub account
  newAccountTokenCeil: 1_000_000_000,
  tokenRatePerDayCeil: 2_000_000_000, // tokens per day of account age
  velocityWindowHours: 24,
  velocityTokenJump: 5_000_000_000,   // token increase vs previous submit in-window
} as const;

export interface PlausibilityContext {
  accountAgeDays: number | null;                          // null when gh_created_at unknown
  previous: { tokens: number; submittedAt: string } | null;
  now: string;                                            // ISO timestamp (server-supplied)
}

export function plausibilityReason(p: SubmitPayload, ctx: PlausibilityContext): string | null {
  // 1. breakdown must sum to ~vibe_score (catches a hand-bumped vibe_score)
  const bsum = Object.values(p.breakdown).reduce((a, b) => a + b, 0);
  if (p.vibe_score > 0 && Math.abs(bsum - p.vibe_score) > Math.max(50, p.vibe_score * 0.05)) {
    return 'inconsistent-breakdown';
  }
  // 2. tok_per_usd must match tokens/cost when both are present
  if (p.tok_per_usd !== null && p.cost_usd > 0) {
    const derived = p.tokens / p.cost_usd;
    if (Math.abs(derived - p.tok_per_usd) > derived * 0.1 + 1) return 'inconsistent-efficiency';
  }
  // 3. brand-new account claiming enormous volume
  if (ctx.accountAgeDays !== null && ctx.accountAgeDays < PLAUSIBILITY.newAccountDays &&
      p.tokens > PLAUSIBILITY.newAccountTokenCeil) {
    return 'new-account-volume';
  }
  // 4. superhuman token accumulation rate for the account's age
  if (ctx.accountAgeDays !== null && ctx.accountAgeDays >= 1 &&
      p.tokens / ctx.accountAgeDays > PLAUSIBILITY.tokenRatePerDayCeil) {
    return 'token-rate';
  }
  // 5. implausible token jump since the previous submit within a short window
  if (ctx.previous) {
    const dHours = (Date.parse(ctx.now) - Date.parse(ctx.previous.submittedAt)) / 3_600_000;
    if (dHours >= 0 && dHours < PLAUSIBILITY.velocityWindowHours &&
        p.tokens - ctx.previous.tokens > PLAUSIBILITY.velocityTokenJump) {
      return 'velocity';
    }
  }
  return null;
}
```

- [ ] **Step 4: Add db helpers** — in `packages/worker/src/db.ts`, append:

```ts
export async function previousScore(
  db: D1Database,
  userId: number,
): Promise<{ tokens: number; submittedAt: string } | null> {
  const row = await db
    .prepare(`SELECT tokens, submitted_at AS submittedAt FROM scores WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(userId)
    .first<{ tokens: number; submittedAt: string }>();
  return row ?? null;
}

export async function susRows(
  db: D1Database,
  limit = 50,
): Promise<Array<{ gh_login: string; sus_reason: string | null; vibe_score: number; submitted_at: string }>> {
  const { results } = await db
    .prepare(
      `SELECT u.gh_login, s.sus_reason, s.vibe_score, s.submitted_at
       FROM scores s JOIN users u ON u.id = s.user_id
       WHERE s.sus = 1 ORDER BY s.id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ gh_login: string; sus_reason: string | null; vibe_score: number; submitted_at: string }>();
  return results;
}
```

- [ ] **Step 5: Make the shared `VALID` fixture self-consistent (REQUIRED — plausibility now runs on every route submit).** In `packages/worker/test/submit.test.ts`, the module-level `VALID` currently has `vibe_score: 3101` but `breakdown: { volume: 1000 }` (sum 1000) and `tokens: 1_200_000_000, cost_usd: 184.2, tok_per_usd: 6_500_000`. Once plausibility is wired (Step 7), route submits of this fixture would trip `inconsistent-breakdown`, breaking the existing "200 stores score", "429 rate limit", and "caps trip sus" tests. Update `VALID`'s breakdown to sum to its `vibe_score`:

```ts
const VALID = {
  client_version: '0.1.0', vibe_score: 3101, loc: 312441, projects: 47,
  tokens: 1_200_000_000, cost_usd: 184.2, tok_per_usd: 6_500_000,
  achievements: ['token-billionaire'], breakdown: { volume: 1000, leverage: 1500, efficiency: 400, breadth: 201 },
};
```

(Sum = 3101 = vibe_score ✓. `tok_per_usd` 6.5M vs `tokens/cost` ≈ 6.51M is within the 10% efficiency tolerance ✓. `GH_USER.created_at` 2020 → old account, token-rate 1.2B/~2380d ≈ 504k/day ✓. First submit → no previous → velocity skipped ✓. So VALID stays `sus:false`.) Do NOT change `validation.test.ts`'s `VALID` — those tests exercise `susReason`/schema only, never `plausibilityReason`.

- [ ] **Step 6: Write the failing submit integration tests** — append to `packages/worker/test/submit.test.ts` inside `describe('POST /api/submit', …)`:

```ts
  it('server-side plausibility flags an inconsistent breakdown as sus with a reason', async () => {
    mockGithub();
    const res = await post({ ...VALID, vibe_score: 9000, breakdown: { volume: 1, leverage: 1 } });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.sus).toBe(true);
    const row = await env.DB.prepare('SELECT sus_reason FROM scores ORDER BY id DESC LIMIT 1')
      .first<{ sus_reason: string }>();
    expect(row?.sus_reason).toBe('inconsistent-breakdown');
  });

  it('stores tok_per_loc from a 0.3 payload', async () => {
    mockGithub();
    await post({ ...VALID, tok_per_loc: 8400 });
    const row = await env.DB.prepare('SELECT tok_per_loc FROM scores ORDER BY id DESC LIMIT 1')
      .first<{ tok_per_loc: number }>();
    expect(row?.tok_per_loc).toBe(8400);
  });
```

- [ ] **Step 7: Run to verify failure**

Run: `npx vitest run test/submit.test.ts` (cwd `packages/worker`)
Expected: FAIL — plausibility not wired; `tok_per_loc` not persisted (route ignores it).

- [ ] **Step 8: Wire into submit.ts** — replace the body of `packages/worker/src/routes/submit.ts` from the `const userId = …` line through the `insertScore` call with:

```ts
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
```

Update the imports at the top of the file:

```ts
import { submitPayloadSchema, susReason, plausibilityReason } from '../validation.js';
import { upsertUser, insertScore, submitsInLastHour, rankFor, percentileFor, previousScore } from '../db.js';
```

(The subsequent `rank`/`pct`/response block is unchanged — it already keys off `sus`.)

- [ ] **Step 9: Run the worker suite**

Run: `npx vitest run` (cwd `packages/worker`)
Expected: ALL PASS. Note: the "200 stores score" test now uses the self-consistent VALID (Step 5); confirm it stays `sus:false`.

- [ ] **Step 10: Commit**

```bash
git add packages/worker/src/validation.ts packages/worker/src/db.ts packages/worker/src/routes/submit.ts packages/worker/test/validation.test.ts packages/worker/test/submit.test.ts
git commit -m "feat(worker): server-side plausibility scoring with persisted reasons (S5, #16)"
```

### Task 3: Surface tok_per_loc + verified framing on public pages

**Files:**
- Modify: `packages/worker/src/db.ts` (`BoardRow`, `leaderboard`, `latestForLogin` SELECTs)
- Modify: `packages/worker/src/routes/share.ts`
- Modify: `packages/worker/src/routes/og.ts`
- Modify: `packages/worker/src/routes/home.ts`
- Test: `packages/worker/test/share.test.ts`, `packages/worker/test/home.test.ts`

**Interfaces:**
- Consumes: `scores.tok_per_loc` column (Task 1); `BoardRow`.
- Produces: `BoardRow.tok_per_loc: number | null`; a "tok/line shipped" line on the share page + OG image (sus-gated); a "GitHub-verified" line on the homepage.

- [ ] **Step 1: Write failing tests** — append to `packages/worker/test/share.test.ts` inside `describe('GET /u/:login', …)`. First extend the `beforeEach` seed to include `tok_per_loc` (the `insertScore` call there passes a `ScoreInput` — add `tok_per_loc: 8400` to it). Then:

```ts
  it('shows tok/line shipped for a clean row', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/u/master5d');
    const html = await res.text();
    expect(html).toContain('8,400');
    expect(html).toContain('per line');
  });
```

Append to `packages/worker/test/home.test.ts`:

```ts
  it('states that every entry is GitHub-verified', async () => {
    await seed('master5d', 1, 6065);
    const html = await (await exports.default.fetch('https://viberuler.dev/')).text();
    expect(html).toMatch(/GitHub-verified/i);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/share.test.ts test/home.test.ts` (cwd `packages/worker`)
Expected: FAIL — column not selected / lines not rendered.

- [ ] **Step 3: Select the column** — in `packages/worker/src/db.ts`, add `tok_per_loc: number | null;` to the `BoardRow` interface (after `tok_per_usd`), and add `s.tok_per_loc` to BOTH SELECT column lists — in `leaderboard` (the `SELECT u.gh_login, u.avatar_url, s.vibe_score, s.tok_per_usd, …`) and in `latestForLogin` (the same column set). Example for `latestForLogin`:

```ts
      `SELECT u.gh_login, u.avatar_url, s.vibe_score, s.tok_per_usd, s.tok_per_loc, s.achievements, s.submitted_at, s.sus
       FROM scores s JOIN users u ON u.id = s.user_id
       WHERE u.gh_login = ? AND s.id = (SELECT MAX(id) FROM scores WHERE user_id = u.id)`,
```

Apply the identical `s.tok_per_loc` addition to the `leaderboard` SELECT.

- [ ] **Step 4: Render on the share page** — in `packages/worker/src/routes/share.ts`, after the existing `tok_per_usd` line in the `body` template, add a sus-gated tok/line line:

```ts
    ${!row.sus && row.tok_per_loc !== null ? `<div>${fmtInt(row.tok_per_loc)} tokens per line shipped</div>` : ''}
```

(Place it immediately after the existing `${!row.sus && row.tok_per_usd !== null ? … tokens per dollar …}` line.)

- [ ] **Step 5: Render on the OG image** — in `packages/worker/src/routes/og.ts`, after the tok_per_usd `<div>`, add:

```ts
      ${!row.sus && row.tok_per_loc !== null
        ? `<div style="display:flex;font-size:26px;color:#8c9eff;margin-top:8px">${fmtInt(row.tok_per_loc)} tokens / line shipped</div>`
        : ''}
```

- [ ] **Step 6: Add the verified line to the homepage** — in `packages/worker/src/routes/home.ts`, add one line to the `.hint` or `.totals` area of the hero (after the `totals` div):

```ts
      <div class="sub" style="margin-top:8px">Every entry is GitHub-verified — submits go through GitHub device-flow OAuth.</div>
```

- [ ] **Step 7: Run the worker suite**

Run: `npx vitest run` (cwd `packages/worker`)
Expected: ALL PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/worker/src/db.ts packages/worker/src/routes/share.ts packages/worker/src/routes/og.ts packages/worker/src/routes/home.ts packages/worker/test/share.test.ts packages/worker/test/home.test.ts
git commit -m "feat(worker): surface tok/line on share+OG, GitHub-verified copy on home (S5, #16)"
```

### Task 4: Documentation — anti-cheat transparency + ten-field payload

**Files:**
- Modify: `METHODOLOGY.md` (§6 «Anti-cheat, honestly»)
- Modify: `PRIVACY.md` (nine → ten fields + example JSON)
- Modify: `packages/worker/DEPLOY.md` (migration-apply note)

**Interfaces:**
- Consumes: the exact thresholds in `PLAUSIBILITY` and the reason strings from Task 2; the tenth payload field from Task 1.
- Produces: nothing downstream; closes the slice.

- [ ] **Step 1: Upgrade METHODOLOGY §6.** In `METHODOLOGY.md`, in the «## 6. Anti-cheat, honestly» section, after the existing "Sanity caps" bullet, add:

```markdown
- **Server-side plausibility scoring.** Beyond the static caps, each submit is checked against your GitHub account and history; tripping any of these stores the row as `sus` with a reason (hidden from the board until reviewed). Source: [`packages/worker/src/validation.ts`](packages/worker/src/validation.ts).
  - `inconsistent-breakdown` — the score components don't sum to the claimed VIBE (±max(50, 5%)).
  - `inconsistent-efficiency` — `tok_per_usd` doesn't match `tokens ÷ cost` (±10%).
  - `new-account-volume` — a GitHub account younger than 7 days claiming over 1B tokens.
  - `token-rate` — more than 2B tokens per day of account age (superhuman accumulation).
  - `velocity` — a jump of over 5B tokens versus your previous submit less than 24h earlier.
```

Then adjust the closing "We catch the blatant" paragraph to acknowledge the new layer (replace "We catch the blatant. We can't catch the clever" sentence with):

```markdown
We catch the blatant — client-side and now server-side, cross-checked against your GitHub account. We still can't catch the truly clever: a determined liar can hand-craft internally-consistent aggregates, and no benchmark can prevent that without shipping spyware, which we will not do. It's a meme benchmark: cheat and you're only lying to the group chat. Every leaderboard entry is GitHub-verified (device-flow OAuth), so at least the name attached to a lie is real.
```

- [ ] **Step 2: Update PRIVACY.md to ten fields.** In `PRIVACY.md`, change the "## What `--submit` sends" intro from "Exactly nine fields" to "Exactly ten fields", and add `"tok_per_loc": 8400,` to the example JSON immediately after the `"tok_per_usd"` line. Also update the trailing note if it counts fields.

- [ ] **Step 3: Add the migration note to DEPLOY.md.** In `packages/worker/DEPLOY.md`, under the redeploy/ritual section, add:

```markdown
- **Migrations (remote-first):** `npx wrangler d1 migrations apply viberuler --remote` BEFORE `npx wrangler deploy`. Migration `0002` adds `tok_per_loc` + `sus_reason` (additive, nullable — safe on the live table). Verify with `npx wrangler d1 execute viberuler --remote --command "PRAGMA table_info(scores)"`.
- **Sus queue (moderation):** `npx wrangler d1 execute viberuler --remote --command "SELECT u.gh_login, s.sus_reason, s.vibe_score, s.submitted_at FROM scores s JOIN users u ON u.id=s.user_id WHERE s.sus=1 ORDER BY s.id DESC LIMIT 50"` (or the `susRows` helper in db.ts).
```

- [ ] **Step 4: Fact-check the docs against the code.**

Run: `npx vitest run` (cwd `packages/worker`)
Expected: PASS — and manually confirm every threshold in METHODOLOGY §6 matches the `PLAUSIBILITY` constants and the reason strings in `validation.ts` verbatim, and that PRIVACY's field count/example matches `payload.ts`.

- [ ] **Step 5: Commit**

```bash
git add METHODOLOGY.md PRIVACY.md packages/worker/DEPLOY.md
git commit -m "docs: document server-side plausibility + ten-field payload (S5, closes #16)"
```

---

## Deployment (post-merge, not part of a task)

After the branch merges to master and CI is green, deploy remote-first:

```bash
cd packages/worker
npx wrangler d1 migrations apply viberuler --remote   # applies 0002
npx wrangler deploy
```

Then verify: submit a real score (`tok_per_loc` populates), load `viberuler.dev/u/<login>` (tok/line shows), and confirm the homepage shows the GitHub-verified line.

## Self-review notes

- Spec coverage: server-side plausibility with reasons ✓ (Task 2, 5 heuristics + persisted `sus_reason`); verified tier surfacing ✓ (Task 3 homepage copy + existing mandatory device-flow); METHODOLOGY anti-cheat upgrade ✓ (Task 4, thresholds verbatim); tok_per_loc end-to-end (the S4 deferral) ✓ (Task 1 payload+migration+db, Task 3 share/OG). Moderation query ✓ (`susRows` + DEPLOY note).
- Backwards compatibility: `tok_per_loc` is `.optional().nullable()` in zod; a 0.2 client's 9-key payload still validates and stores NULL — explicit test in Task 1. `insertScore` gains only an optional 5th param, so existing test callers are untouched.
- Sus invariant: tok_per_loc display in share.ts/og.ts is gated on `!row.sus` exactly like tok_per_usd.
- Migration safety: additive nullable columns, remote-first, verified via PRAGMA — safe on the live table with existing rows.
- Type consistency: `tok_per_loc` naming identical across CLI payload, zod schema, ScoreInput, BoardRow, and all SQL; `PlausibilityContext` fields (`accountAgeDays`/`previous`/`now`) identical between the pure function (Task 2) and the route's construction of it.
- Deliberately NOT done (YAGNI/scope): per-agent token ceilings (payload carries no per-agent split — reinterpreted as the global `token-rate` check, documented); an admin moderation ROUTE (a documented D1 query + `susRows` helper is enough for now); homepage tok/line board column (share+OG carry the differentiator; homepage stays focused on rank/vibe/tok$).
