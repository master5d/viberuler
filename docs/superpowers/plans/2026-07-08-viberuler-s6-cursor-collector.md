# S6 Cursor Collector (estimated) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count Cursor token usage from its local `state.vscdb`, honestly labeled as an **input-side lower bound** (output/cache aren't stored locally), so Cursor users get a real-but-conservative contribution and appear in the agents stable (epic S6, issue #17; closes #1).

**Architecture:** Cursor stores conversation state in a SQLite `state.vscdb` under its globalStorage, in a `cursorDiskKV` key/value table. Per-conversation input tokens live at `composerData.promptTokenBreakdown` (one `composerData:<id>` row per conversation). A pure `parseCursorValues` sums the numeric leaves of each row's `promptTokenBreakdown` (robust to unknown sub-field names) → input tokens. Output and cache are **not** locally available, so the collector counts input only (output=0), prices it at an API-equivalent default tier, and emits an `estimated` warning. Reuses the `node:sqlite` plumbing pattern from the litellm collector (Node 22.5+, graceful degrade).

**Tech Stack:** TypeScript ESM, vitest ^4.1, `node:sqlite` (built-in, Node 22.5+). No new dependencies.

## Verification caveat (read first)

There is **no Cursor install on the authoring machine**, so this collector is validated against fixtures + the codeburn reference schema (`state.vscdb` / `cursorDiskKV` / `composerData.promptTokenBreakdown`), NOT against a live Cursor DB. Deep research flagged Cursor parsing as error-prone (a real reference parser once collected zero from a populated DB). Mitigation baked into the design: (1) input-only lower bound — the failure direction is always **undercount, never inflate** tok/$; (2) sum-numeric-leaves is robust to exact field names; (3) the `estimated` warning sets user expectations; (4) METHODOLOGY documents the limitation. A real-Cursor-user smoke should confirm magnitudes before we trust them — note this in the issue/PR.

## Global Constraints

- `packages/cli` keeps exactly ONE runtime dependency (`picocolors`).
- `node:sqlite` is Node 22.5+; the collector MUST degrade gracefully (no crash, contribute nothing + a warning) when the module is unavailable — mirror `litellm.ts`'s `await import('node:sqlite')` catch. CLI `engines.node >= 18.17` stays; the Cursor collector is simply dormant on older Node.
- **Fairness / safe-failure:** count Cursor INPUT tokens only (output=0, cacheRead=0). Price at the `claude-sonnet` tier (Cursor's common backend) as API-equivalent value — so Cursor's `tokens/cost` sits at the input-only rate (~333K tok/$), which can only DRAG DOWN a mixed tok/$, never inflate it. Emit a warning that figures are an estimated lower bound.
- Test seam: `ctx.env.VIBERULER_CURSOR_STORAGE` overrides the globalStorage dir (a dir containing `state.vscdb`), so tests build a real temp DB and are OS-independent.
- `cursorDiskKV` values may be TEXT or BLOB — the collector decodes Buffer/Uint8Array to string before JSON-parsing.
- `RawStats.agents` is display-only; the collector adds `'Cursor'`.

---

### Task 1: `parseCursorValues` pure parser

**Files:**
- Create: `packages/cli/src/collectors/cursor.ts` (parser + helpers only in this task)
- Test: `packages/cli/test/cursor.test.ts`

**Interfaces:**
- Consumes: nothing external.
- Produces: `parseCursorValues(values: string[]): { inputTokens: number; conversations: number }`. Task 2's collector feeds it the decoded `cursorDiskKV` value strings.

- [ ] **Step 1: Write the failing tests** — create `packages/cli/test/cursor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCursorValues } from '../src/collectors/cursor.js';

describe('parseCursorValues', () => {
  it('sums the numeric leaves of promptTokenBreakdown per conversation', () => {
    const values = [
      JSON.stringify({ promptTokenBreakdown: { system: 1000, user: 2000, context: 500 }, other: 'ignored' }),
      JSON.stringify({ promptTokenBreakdown: { system: 300, fileContext: 700 } }),
    ];
    const r = parseCursorValues(values);
    expect(r.inputTokens).toBe(4500); // 3500 + 1000
    expect(r.conversations).toBe(2);
  });
  it('is robust to unknown sub-field names (sums whatever numbers are there)', () => {
    const values = [JSON.stringify({ promptTokenBreakdown: { futureFieldA: 10, nested: { deep: 5 }, label: 'x' } })];
    expect(parseCursorValues(values).inputTokens).toBe(15); // 10 + 5, string ignored
  });
  it('skips rows without a promptTokenBreakdown and malformed JSON', () => {
    const values = [
      JSON.stringify({ notABreakdown: { a: 1 } }),
      'not json at all',
      JSON.stringify({ promptTokenBreakdown: { a: 42 } }),
    ];
    const r = parseCursorValues(values);
    expect(r.inputTokens).toBe(42);
    expect(r.conversations).toBe(1);
  });
  it('returns zero for an empty input', () => {
    expect(parseCursorValues([])).toEqual({ inputTokens: 0, conversations: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/cursor.test.ts` (cwd `packages/cli`)
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement** — create `packages/cli/src/collectors/cursor.ts`:

```ts
// Recursively sum every finite number under an object (robust to unknown
// promptTokenBreakdown sub-field names across Cursor versions).
function sumNumericLeaves(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v && typeof v === 'object') {
    let total = 0;
    for (const val of Object.values(v as Record<string, unknown>)) total += sumNumericLeaves(val);
    return total;
  }
  return 0;
}

/**
 * Parse decoded cursorDiskKV `composerData:*` value strings. Cursor records
 * per-conversation INPUT tokens at `composerData.promptTokenBreakdown`; output
 * and cache are not stored locally. Returns the input-token lower bound and the
 * count of conversations that carried a breakdown.
 */
export function parseCursorValues(values: string[]): { inputTokens: number; conversations: number } {
  let inputTokens = 0;
  let conversations = 0;
  for (const raw of values) {
    let obj: unknown;
    try { obj = JSON.parse(raw); } catch { continue; }
    const breakdown = (obj as { promptTokenBreakdown?: unknown })?.promptTokenBreakdown;
    if (!breakdown || typeof breakdown !== 'object') continue;
    inputTokens += sumNumericLeaves(breakdown);
    conversations++;
  }
  return { inputTokens, conversations };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/cursor.test.ts` (cwd `packages/cli`)
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/collectors/cursor.ts packages/cli/test/cursor.test.ts
git commit -m "feat(cursor): parseCursorValues — input-token lower bound from promptTokenBreakdown (S6, #17)"
```

### Task 2: Cursor collector (node:sqlite) + wiring

**Files:**
- Modify: `packages/cli/src/collectors/cursor.ts` (append collector)
- Modify: `packages/cli/src/cli.ts` (import + COLLECTORS)
- Test: `packages/cli/test/cursor.test.ts` (append collector tests, skipped when node:sqlite absent)

**Interfaces:**
- Consumes: `parseCursorValues` (Task 1); `costForUsage`; `Collector, ScanContext, TokenUsage`.
- Produces: `export const cursorCollector: Collector`; env seam `VIBERULER_CURSOR_STORAGE`. Registered in `COLLECTORS` after `geminiCollector`.

- [ ] **Step 1: Write the failing collector tests** — append to `packages/cli/test/cursor.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cursorCollector } from '../src/collectors/cursor.js';

const hasNodeSqlite = await import('node:sqlite' as string).then(() => true, () => false);

describe('cursorCollector.detect', () => {
  it('is dormant when no storage dir is configured/found', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nocursor-'));
    expect(await cursorCollector.detect({ home, scanDirs: [], env: { VIBERULER_CURSOR_STORAGE: home } })).toBe(false);
  });
});

describe.skipIf(!hasNodeSqlite)('cursorCollector — real state.vscdb', () => {
  async function makeDb(rows: Array<[string, string]>): Promise<string> {
    const { DatabaseSync } = await import('node:sqlite' as string);
    const dir = await mkdtemp(join(tmpdir(), 'vibe-cursor-'));
    const db = new DatabaseSync(join(dir, 'state.vscdb'));
    db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)');
    const ins = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
    for (const [k, v] of rows) ins.run(k, v);
    db.close();
    return dir;
  }

  it('sums input tokens across composerData rows, prices API-equivalent, flags estimated', async () => {
    const dir = await makeDb([
      ['composerData:c1', JSON.stringify({ promptTokenBreakdown: { system: 1000, user: 2000 } })],
      ['composerData:c2', JSON.stringify({ promptTokenBreakdown: { system: 3000 } })],
      ['bubbleId:x', JSON.stringify({ irrelevant: 1 })], // not a composerData row — ignored
    ]);
    const ctx = { home: '/', scanDirs: [], env: { VIBERULER_CURSOR_STORAGE: dir } };
    expect(await cursorCollector.detect(ctx)).toBe(true);
    const r = await cursorCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 6000, output: 0, cacheWrite: 0, cacheRead: 0 });
    // sonnet input rate 3/MTok
    expect(r.costUsd).toBeCloseTo((6000 * 3) / 1e6, 12);
    expect(r.sources).toEqual(['cursor']);
    expect(r.agents).toEqual(['Cursor']);
    expect(r.warnings?.[0]).toMatch(/estimated|lower bound/i);
  });

  it('contributes nothing (but no crash) when the db has no composerData rows', async () => {
    const dir = await makeDb([['bubbleId:x', JSON.stringify({ a: 1 })]]);
    const r = await cursorCollector.collect({ home: '/', scanDirs: [], env: { VIBERULER_CURSOR_STORAGE: dir } });
    expect(r.tokens?.input ?? 0).toBe(0);
    expect(r.agents ?? []).not.toContain('Cursor');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/cursor.test.ts` (cwd `packages/cli`)
Expected: FAIL — `cursorCollector` not exported.

- [ ] **Step 3: Implement** — append the collector to `packages/cli/src/collectors/cursor.ts` (add imports at the top, merging with the file):

```ts
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';
```

Append at the bottom:

```ts
function storageDirs(ctx: ScanContext): string[] {
  const env = ctx.env ?? process.env;
  if (env.VIBERULER_CURSOR_STORAGE) return [env.VIBERULER_CURSOR_STORAGE];
  const base =
    process.platform === 'win32'
      ? (env.APPDATA ?? join(ctx.home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(ctx.home, 'Library', 'Application Support')
        : join(ctx.home, '.config');
  return [join(base, 'Cursor', 'User', 'globalStorage')];
}

async function findDb(ctx: ScanContext): Promise<string | null> {
  for (const dir of storageDirs(ctx)) {
    const db = join(dir, 'state.vscdb');
    try { if ((await stat(db)).isFile()) return db; } catch { /* not here */ }
  }
  return null;
}

async function readComposerValues(dbPath: string): Promise<string[] | null> {
  const modName = 'node:sqlite'; // non-literal specifier: don't let tsup/tsc resolve a 22.5+ builtin
  let sqlite: { DatabaseSync: new (p: string, o: object) => any };
  try { sqlite = await import(modName); } catch { return null; }
  let db: any;
  try { db = new sqlite.DatabaseSync(dbPath, { readOnly: true }); } catch { return null; }
  try {
    const rows = db
      .prepare("SELECT value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
      .all() as Array<{ value: unknown }>;
    return rows.map((r) =>
      typeof r.value === 'string' ? r.value
        : r.value instanceof Uint8Array ? new TextDecoder().decode(r.value)
          : String(r.value),
    );
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export const cursorCollector: Collector = {
  id: 'cursor',
  async detect(ctx) {
    return (await findDb(ctx)) !== null;
  },
  async collect(ctx) {
    const dbPath = await findDb(ctx);
    if (!dbPath) return {};
    const values = await readComposerValues(dbPath);
    if (values === null) {
      return { warnings: ['cursor: state.vscdb found but unreadable (node:sqlite needs Node 22.5+) — skipped'] };
    }
    const { inputTokens, conversations } = parseCursorValues(values);
    if (conversations === 0) return {};
    const tokens: TokenUsage = { input: inputTokens, output: 0, cacheWrite: 0, cacheRead: 0 };
    return {
      tokens,
      costUsd: costForUsage('claude-sonnet', tokens),
      sources: ['cursor'],
      agents: ['Cursor'],
      warnings: [
        `cursor: ${inputTokens.toLocaleString('en-US')} input tokens across ${conversations} conversation(s) — an ESTIMATED lower bound (output/cache tokens aren't stored locally)`,
      ],
    };
  },
};
```

- [ ] **Step 4: Wire into the pipeline** — in `packages/cli/src/cli.ts`, add after the `geminiCollector` import:

```ts
import { cursorCollector } from './collectors/cursor.js';
```

and add `cursorCollector` to `COLLECTORS` immediately after `geminiCollector`:

```ts
const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector, clineCollector, geminiCollector, cursorCollector, litellmCollector, agentsCollector, gitCollector, githubCollector];
```

- [ ] **Step 5: Run the full CLI suite + typecheck**

Run: `npx vitest run` then `npm run typecheck` (cwd `packages/cli`)
Expected: ALL PASS. (No existing test sets `VIBERULER_CURSOR_STORAGE`; `findDb` looks under a real Cursor path that CI runners won't have, so the collector is dormant there. `tsc` clean.)

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/collectors/cursor.ts packages/cli/src/cli.ts packages/cli/test/cursor.test.ts
git commit -m "feat(cursor): node:sqlite collector reading state.vscdb, estimated lower bound (S6, #17)"
```

### Task 3: Documentation

**Files:**
- Modify: `METHODOLOGY.md` (§1 data-sources table + §7 known limitations)
- Modify: `README.md` (roadmap checklist)

**Interfaces:**
- Consumes: shipped behavior of Tasks 1-2.
- Produces: nothing downstream; closes the slice.

- [ ] **Step 1: Add the METHODOLOGY source row** — in `METHODOLOGY.md` §1, after the **Gemini CLI** row:

```markdown
| **Cursor** (estimated) | `state.vscdb` (SQLite) in Cursor's globalStorage — `cursorDiskKV` rows keyed `composerData:*`, input tokens at `promptTokenBreakdown` | **Input-side lower bound only**: output and cache tokens aren't stored locally, so Cursor contributes input tokens (priced API-equivalent at the sonnet tier) with an `estimated` warning. Override the search dir with `VIBERULER_CURSOR_STORAGE`; needs Node 22.5+ (`node:sqlite`). Source: [`packages/cli/src/collectors/cursor.ts`](packages/cli/src/collectors/cursor.ts) |
```

- [ ] **Step 2: Add a §7 limitation bullet** — in `METHODOLOGY.md` §7 «Known limitations», add:

```markdown
- Cursor figures are an **estimated lower bound** — only per-conversation input tokens are stored locally (`state.vscdb`); output and server-side cache tokens are not, so a Cursor-heavy user is undercounted. This is deliberate: the collector never inflates tokens-per-dollar.
```

- [ ] **Step 3: Tick the README roadmap** — in `README.md`, replace `- [ ] Cursor collector — \`good first issue\`` with:

```markdown
- [x] Cursor collector (input-side lower bound, estimated)
```

- [ ] **Step 4: Fact-check and commit**

Run: `npx vitest run test/cursor.test.ts` (cwd `packages/cli`) — PASS; confirm doc claims (input-only lower bound, sonnet pricing, VIBERULER_CURSOR_STORAGE, Node 22.5+) match `cursor.ts` verbatim.

```bash
git add METHODOLOGY.md README.md
git commit -m "docs: document the Cursor collector as an estimated lower bound (S6, closes #17, #1)"
```

---

## Self-review notes

- Spec coverage: state.vscdb / cursorDiskKV / composerData / promptTokenBreakdown per the codeburn reference ✓; input-only lower bound (safe failure direction) ✓; node:sqlite graceful degrade ✓ (mirrors litellm); estimated warning ✓; agent surfacing ✓; env seam for OS-independent tests ✓; BLOB/TEXT decode ✓; docs incl. the honest limitation ✓.
- Fairness decision (recorded): Cursor tokens ARE included in the aggregate (priced at sonnet API-equivalent), NOT excluded — because input-only pricing yields ~333K tok/$, which can only lower a mixed tok/$, never inflate it. Simpler than a parallel "estimated-excluded" accounting and provably fair. Documented in METHODOLOGY §7.
- Verification honesty: no live Cursor DB available to author — validated against fixtures + reference schema; wants a real-Cursor-user smoke (noted in the caveat section + to be flagged in the issue/PR). The lower-bound design bounds the blast radius of any schema mismatch to "undercount / contribute nothing", never "inflate / crash".
- `npm run typecheck` is an explicit step (S5 lesson).
- Type consistency: `parseCursorValues` signature identical Tasks 1-2; `VIBERULER_CURSOR_STORAGE` seam; node:sqlite import pattern copied from litellm.ts verbatim.
- Deliberately NOT done (YAGNI): output estimation from reply text (fuzzy, would only raise the lower bound — future refinement); Cursor's own admin-console reconciliation; per-model Cursor pricing (sonnet default is a documented approximation).
