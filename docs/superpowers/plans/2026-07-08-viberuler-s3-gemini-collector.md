# S3 Gemini CLI Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count token usage from Gemini CLI sessions, locally and cheaply, pricing Gemini tokens at API-equivalent rates (epic S3, issue #14; closes #2).

**Architecture:** Gemini CLI writes one JSONL file per session under `${GEMINI_DATA_DIR:-~/.gemini}/tmp/<project>/chats/` (top-level `session-*.jsonl` plus subagent sessions nested in UUID subdirs — a recursive walk). Each line is a document-mutation log (`{"$set":{"messages":[…]}}`) that **replays the full messages array**, so tokens MUST be de-duplicated by message id or they multiply. Assistant messages carry `tokens:{input,output,cached,thoughts,tool,total}` and a `model`. A pure `parseGeminiSession` maps those buckets to `TokenUsage` (thoughts+tool bill as output, cached → cacheRead) and prices each message by its model via two new `gemini-*` entries in the price table. The collector scans `tmp/*/chats`, which structurally excludes Antigravity (`~/.gemini/antigravity-cli/`).

**Tech Stack:** TypeScript ESM, vitest ^4.1, `node:fs/promises` + `node:path`. No new dependencies.

## Global Constraints

- `packages/cli` keeps exactly ONE runtime dependency (`picocolors`).
- Dedup by message `id` GLOBALLY across all Gemini files (the `$set` log replays the full array every line; without dedup a 10-message session is counted ~10×).
- Token bucket mapping (verified on real 2026-06 sessions where `total = input+output+cached+thoughts+tool`, i.e. mutually-exclusive buckets): `input→input`, `output+thoughts+tool→output`, `cached→cacheRead`, `cacheWrite=0`.
- Cost is **API-equivalent value** (consistent with METHODOLOGY §2's framing for subscription tokens). Gemini pricing (USD per MTok, snapshot with `PRICES_SNAPSHOT_DATE`): `gemini-2.5-pro` = in 1.25 / out 10 / cacheWrite 1.25 / cacheRead 0.31; `gemini` (flash/default, longest-prefix fallback) = in 0.30 / out 2.50 / cacheWrite 0.30 / cacheRead 0.075. A message with no model prices at the `gemini` (flash) tier, NOT the sonnet fallback.
- MUST NOT read Antigravity data — scan only `<geminiDir>/tmp/*/chats/**`, never `<geminiDir>/antigravity-cli`.
- Test seam: `ctx.env.GEMINI_DATA_DIR` overrides the `~/.gemini` root (matches Gemini CLI's own env), so tests are OS-independent.
- `RawStats.agents` is display-only; the collector may add `'Gemini CLI'`.

---

### Task 1: Gemini price-table entries

**Files:**
- Modify: `packages/cli/src/pricing.ts` (add two `gemini-*` rows to `PRICES`)
- Test: `packages/cli/test/pricing.test.ts`

**Interfaces:**
- Consumes: existing `PRICES`, `priceFor`, `costForUsage`.
- Produces: `PRICES['gemini-2.5-pro']` and `PRICES['gemini']`. Task 2 prices via `costForUsage(model, …)`.

- [ ] **Step 1: Write the failing tests** — append to `packages/cli/test/pricing.test.ts`:

```ts
describe('gemini pricing', () => {
  it('prices the flash/default tier via the generic gemini prefix', () => {
    // gemini-3-flash-preview → 'gemini' row: in 0.30, out 2.50, cacheRead 0.075
    const u = { input: 1000, output: 150, cacheWrite: 0, cacheRead: 500 };
    expect(costForUsage('gemini-3-flash-preview', u)).toBeCloseTo((1000 * 0.3 + 150 * 2.5 + 500 * 0.075) / 1e6, 12);
  });
  it('prices gemini-2.5-pro via the longer, more specific prefix', () => {
    const u = { input: 2000, output: 200, cacheWrite: 0, cacheRead: 0 };
    expect(costForUsage('gemini-2.5-pro', u)).toBeCloseTo((2000 * 1.25 + 200 * 10) / 1e6, 12);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/pricing.test.ts` (cwd `packages/cli`)
Expected: FAIL — no gemini rows, so both fall back to sonnet (3/15/…), numbers don't match.

- [ ] **Step 3: Implement** — in `packages/cli/src/pricing.ts`, add two rows to the `PRICES` object (after the `codex-default` row, before the closing `}`):

```ts
  'codex-default': { input: 1.25, output: 10, cacheWrite: 1.25,  cacheRead: 0.125 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.31 },
  'gemini':         { input: 0.3,  output: 2.5, cacheWrite: 0.3, cacheRead: 0.075 },
```

- [ ] **Step 4: Run the full CLI suite**

Run: `npx vitest run` (cwd `packages/cli`)
Expected: ALL PASS (existing pricing tests unaffected — no existing model starts with `gemini`).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/pricing.ts packages/cli/test/pricing.test.ts
git commit -m "feat(pricing): gemini flash + 2.5-pro API-equivalent rates (S3, #14)"
```

### Task 2: `parseGeminiSession` parser + collector

**Files:**
- Create: `packages/cli/src/collectors/gemini.ts`
- Modify: `packages/cli/src/cli.ts` (import + COLLECTORS array)
- Test: `packages/cli/test/gemini.test.ts`

**Interfaces:**
- Consumes: `costForUsage` (with the gemini rows from Task 1); `Collector, ScanContext, TokenUsage`.
- Produces: `parseGeminiSession(content: string, seen: Set<string>): { tokens: TokenUsage; costUsd: number }` (mutates `seen` with message ids for global dedup); `export const geminiCollector: Collector`; env seam `GEMINI_DATA_DIR`. Registered in `COLLECTORS` after `clineCollector`.

- [ ] **Step 1: Write the failing parser + collector tests** — create `packages/cli/test/gemini.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGeminiSession, geminiCollector } from '../src/collectors/gemini.js';

// Two $set lines that REPLAY the full messages array (Gemini's mutation log).
// m2 appears on both lines; correct dedup counts it once.
const msg = (id: string, model: string, t: object) =>
  ({ id, type: 'gemini', model, tokens: t });
const line = (msgs: unknown[]) => JSON.stringify({ $set: { messages: msgs } });
const m1 = { id: 'm1', type: 'user', content: [{ text: 'hi' }] };
const m2 = msg('m2', 'gemini-3-flash-preview', { input: 1000, output: 100, cached: 500, thoughts: 50, tool: 0, total: 1650 });
const m3 = msg('m3', 'gemini-2.5-pro', { input: 2000, output: 200, cached: 0, thoughts: 0, tool: 0, total: 2200 });
const sessionFile =
  JSON.stringify({ sessionId: 's1', kind: 'session' }) + '\n' +
  line([m1, m2]) + '\n' +
  line([m1, m2, m3]) + '\n';

describe('parseGeminiSession', () => {
  it('dedups by message id and maps buckets (thoughts+tool→output, cached→cacheRead)', () => {
    const r = parseGeminiSession(sessionFile, new Set());
    // m2: input1000, output 100+50=150, cacheRead500 ; m3: input2000, output200
    expect(r.tokens).toEqual({ input: 3000, output: 350, cacheWrite: 0, cacheRead: 500 });
    // cost: m2 flash (1000*.30+150*2.5+500*.075) + m3 pro (2000*1.25+200*10), /1e6
    expect(r.costUsd).toBeCloseTo((300 + 375 + 37.5 + 2500 + 2000) / 1e6, 12);
  });
  it('shares the seen-set so the same id across files is not double-counted', () => {
    const seen = new Set<string>();
    parseGeminiSession(sessionFile, seen);
    const again = parseGeminiSession(sessionFile, seen); // all ids already seen
    expect(again.tokens).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(again.costUsd).toBe(0);
  });
  it('prices a missing model at the flash tier, not sonnet', () => {
    const noModel = JSON.stringify({ $set: { messages: [
      { id: 'x', type: 'gemini', tokens: { input: 1000, output: 0, cached: 0, thoughts: 0, tool: 0, total: 1000 } },
    ] } }) + '\n';
    expect(parseGeminiSession(noModel, new Set()).costUsd).toBeCloseTo((1000 * 0.3) / 1e6, 12);
  });
});

describe('geminiCollector', () => {
  async function seed(gdir: string, project: string, rel: string, content: string): Promise<void> {
    const dir = join(gdir, 'tmp', project, 'chats', rel);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'session-x.jsonl'), content);
  }

  it('scans tmp/*/chats recursively and reports the Gemini CLI agent', async () => {
    const gdir = await mkdtemp(join(tmpdir(), 'vibe-gem-'));
    await seed(gdir, 'proj-a', '.', sessionFile);                 // top-level
    await seed(gdir, 'proj-a', '11111111-2222-3333', sessionFile); // nested UUID subdir (distinct file, same ids → deduped)
    const ctx = { home: '/', scanDirs: [] as string[], env: { GEMINI_DATA_DIR: gdir } };
    expect(await geminiCollector.detect(ctx)).toBe(true);
    const r = await geminiCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 3000, output: 350, cacheWrite: 0, cacheRead: 500 }); // deduped across both files
    expect(r.sources).toEqual(['gemini']);
    expect(r.agents).toEqual(['Gemini CLI']);
  });

  it('does not detect without a gemini tmp/chats tree', async () => {
    const gdir = await mkdtemp(join(tmpdir(), 'vibe-nogem-'));
    expect(await geminiCollector.detect({ home: '/', scanDirs: [], env: { GEMINI_DATA_DIR: gdir } })).toBe(false);
  });

  it('never descends into antigravity-cli', async () => {
    const gdir = await mkdtemp(join(tmpdir(), 'vibe-gemag-'));
    const ag = join(gdir, 'antigravity-cli', 'chats');
    await mkdir(ag, { recursive: true });
    await writeFile(join(ag, 'session-x.jsonl'), sessionFile);
    // no tmp/*/chats → nothing to collect
    expect(await geminiCollector.detect({ home: '/', scanDirs: [], env: { GEMINI_DATA_DIR: gdir } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/gemini.test.ts` (cwd `packages/cli`)
Expected: FAIL — module `../src/collectors/gemini.js` doesn't exist.

- [ ] **Step 3: Implement** — create `packages/cli/src/collectors/gemini.ts`:

```ts
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

interface GeminiTokens {
  input?: unknown; output?: unknown; cached?: unknown; thoughts?: unknown; tool?: unknown;
}
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function extractMessages(obj: unknown): unknown[] {
  const out: unknown[] = [];
  const push = (m: unknown) => { if (Array.isArray(m)) out.push(...m); else if (m && typeof m === 'object') out.push(m); };
  const o = obj as { messages?: unknown; $set?: { messages?: unknown }; $push?: { messages?: unknown } };
  push(o?.messages);
  push(o?.$set?.messages);
  push(o?.$push?.messages);
  return out;
}

/**
 * Parse one Gemini CLI session JSONL. Each line is a document-mutation log whose
 * `$set.messages` REPLAYS the full array, so we dedup by message `id` (via the
 * shared `seen` set — also dedups across files). Assistant messages carry
 * `tokens:{input,output,cached,thoughts,tool,total}` (mutually-exclusive buckets)
 * and a `model`. Mapping: input→input, output+thoughts+tool→output, cached→cacheRead.
 */
export function parseGeminiSession(content: string, seen: Set<string>): { tokens: TokenUsage; costUsd: number } {
  const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  for (const raw of content.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    for (const m of extractMessages(obj)) {
      const rec = m as { id?: unknown; model?: unknown; tokens?: GeminiTokens };
      if (!rec || typeof rec.id !== 'string' || !rec.tokens || typeof rec.tokens !== 'object') continue;
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      const t = rec.tokens;
      const u: TokenUsage = {
        input: num(t.input),
        output: num(t.output) + num(t.thoughts) + num(t.tool),
        cacheWrite: 0,
        cacheRead: num(t.cached),
      };
      tokens.input += u.input;
      tokens.output += u.output;
      tokens.cacheRead += u.cacheRead;
      costUsd += costForUsage(typeof rec.model === 'string' ? rec.model : 'gemini', u);
    }
  }
  return { tokens, costUsd };
}

function geminiDir(ctx: ScanContext): string {
  const env = ctx.env ?? process.env;
  return env.GEMINI_DATA_DIR ?? join(ctx.home, '.gemini');
}

// Yield every *.jsonl under <geminiDir>/tmp/<project>/chats/** (recursive for
// nested subagent UUID dirs). Never touches <geminiDir>/antigravity-cli.
async function* sessionFiles(ctx: ScanContext): AsyncGenerator<string> {
  const tmp = join(geminiDir(ctx), 'tmp');
  let projects;
  try { projects = await readdir(tmp, { withFileTypes: true }); } catch { return; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    yield* walk(join(tmp, p.name, 'chats'));
  }
}
async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield full;
  }
}

export const geminiCollector: Collector = {
  id: 'gemini',
  async detect(ctx) {
    for await (const _f of sessionFiles(ctx)) return true;
    return false;
  },
  async collect(ctx) {
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let found = false;
    const seen = new Set<string>();
    for await (const file of sessionFiles(ctx)) {
      found = true;
      try {
        const r = parseGeminiSession(await readFile(file, 'utf8'), seen);
        tokens.input += r.tokens.input;
        tokens.output += r.tokens.output;
        tokens.cacheRead += r.tokens.cacheRead;
        costUsd += r.costUsd;
      } catch { /* unreadable file — skip */ }
    }
    if (!found) return {};
    return { tokens, costUsd, sources: ['gemini'], agents: ['Gemini CLI'] };
  },
};
```

- [ ] **Step 4: Wire into the pipeline** — in `packages/cli/src/cli.ts`, add the import after the `clineCollector` import:

```ts
import { geminiCollector } from './collectors/gemini.js';
```

and add `geminiCollector` to `COLLECTORS` immediately after `clineCollector`:

```ts
const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector, clineCollector, geminiCollector, litellmCollector, agentsCollector, gitCollector, githubCollector];
```

- [ ] **Step 5: Run the full CLI suite + typecheck**

Run: `npx vitest run` then `npm run typecheck` (cwd `packages/cli`)
Expected: ALL PASS. (No existing test sets `GEMINI_DATA_DIR`, so the collector is dormant elsewhere; `tsc` clean.)

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/collectors/gemini.ts packages/cli/src/cli.ts packages/cli/test/gemini.test.ts
git commit -m "feat(gemini): collector — dedup-by-id session parser, recursive chats walk (S3, #14)"
```

### Task 3: Documentation

**Files:**
- Modify: `METHODOLOGY.md` (§1 data-sources table)
- Modify: `README.md` (roadmap checklist)

**Interfaces:**
- Consumes: shipped behavior of Tasks 1-2 — docs match code (paths, bucket mapping, pricing, dedup).
- Produces: nothing downstream; closes the slice.

- [ ] **Step 1: Add the METHODOLOGY source row** — in `METHODOLOGY.md` §1, after the **Cline family** row:

```markdown
| **Gemini CLI** | `${GEMINI_DATA_DIR:-~/.gemini}/tmp/<project>/chats/**/*.jsonl` — assistant-message `tokens` objects | Session logs replay the full message array, so tokens are de-duplicated by message id. Buckets map input→input, output+thoughts+tool→output, cached→cache-read. Priced at API-equivalent Gemini rates (flash/2.5-pro). Antigravity (`~/.gemini/antigravity-cli`) is never read. Source: [`packages/cli/src/collectors/gemini.ts`](packages/cli/src/collectors/gemini.ts) |
```

Add `gemini-2.5-pro` / `gemini` rows to the §2 price table too, matching pricing.ts:

```markdown
| `codex-default` | 1.25 | 10 | 1.25 | 0.125 |
| `gemini-2.5-pro` | 1.25 | 10 | 1.25 | 0.31 |
| `gemini` (flash/default) | 0.30 | 2.50 | 0.30 | 0.075 |
```

- [ ] **Step 2: Tick the README roadmap** — in `README.md`, replace `- [ ] Gemini CLI collector — \`good first issue\`` with:

```markdown
- [x] Gemini CLI collector
```

- [ ] **Step 3: Fact-check and commit**

Run: `npx vitest run test/gemini.test.ts test/pricing.test.ts` (cwd `packages/cli`) — PASS; confirm the doc paths/buckets/prices match `gemini.ts` + `pricing.ts` verbatim.

```bash
git add METHODOLOGY.md README.md
git commit -m "docs: document the Gemini CLI collector (S3, closes #14, #2)"
```

---

## Self-review notes

- Spec coverage: .jsonl (not .json) recursive walk ✓; dedup-by-id (the $set replay trap) ✓ (parser + shared seen-set test); bucket mapping incl thoughts/tool→output, cached→cacheRead ✓; Antigravity exclusion ✓ (explicit test); API-equivalent gemini pricing with missing-model→flash ✓; agent surfacing ✓; docs ✓.
- CLI-local only — no payload/worker/migration touched (Gemini tokens flow into the existing aggregate `tokens`/`costUsd`/`tok_per_usd`/`tok_per_loc`).
- Type consistency: `parseGeminiSession(content, seen)` signature identical in Tasks 1-2; `GEMINI_DATA_DIR` env seam; PRICES prefixes `gemini-2.5-pro`/`gemini` identical in pricing.ts (Task 1) and METHODOLOGY (Task 3); longest-prefix match gives pro the specific rate and everything else flash.
- `npm run typecheck` is an explicit step (S5 lesson: vitest is transpile-only; tsc catches required-field/type drift).
- Deliberately NOT done (YAGNI): per-message model rarely absent (handled via flash default); exact Gemini implicit-cache-write accounting (cacheWrite=0 — Gemini's object has no separate write bucket); Windsurf/Aider (no prior art — backlog).
