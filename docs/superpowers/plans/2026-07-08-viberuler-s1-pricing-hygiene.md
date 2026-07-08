# S1 Pricing Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cost model tier-aware (5-minute vs 1-hour cache writes) and pin the price table to a stated snapshot date, so every token metric in v0.3 stands on exact, documented math (epic S1, issue #12).

**Architecture:** `costForUsage` in `packages/cli/src/pricing.ts` gains an optional third parameter carrying the 1-hour cache-write portion (billed at 2× input; the PRICES `cacheWrite` column stays the 5-minute 1.25× rate). The claude-code collector reads `usage.cache_creation.ephemeral_1h_input_tokens` per JSONL record and passes it through. Logs without the breakdown fall back to the 5-minute rate (documented). A `PRICES_SNAPSHOT_DATE` constant + METHODOLOGY updates make the snapshot policy explicit.

**Tech Stack:** TypeScript ESM, vitest ^4.1, no new dependencies.

## Global Constraints

- `packages/cli` keeps exactly ONE runtime dependency: `picocolors`.
- `engines.node >= 18.17` — no Node 22-only APIs in the CLI core path.
- The submit payload stays EXACTLY the frozen 9 keys (`client_version, vibe_score, loc, projects, tokens, cost_usd, tok_per_usd, achievements, breakdown`) — this slice must not touch payload.ts or the worker.
- METHODOLOGY.md claims must be fact-checkable against the code they cite.
- Existing tests must keep passing unchanged EXCEPT where a step below explicitly edits them.
- Real Claude Code JSONL ground truth (verified on a live machine 2026-07-08): `"usage":{"input_tokens":30539,"cache_creation_input_tokens":15007,"cache_read_input_tokens":23474,"output_tokens":388,...,"cache_creation":{"ephemeral_1h_input_tokens":15007,"ephemeral_5m_input_tokens":0}}` — `cache_creation_input_tokens` equals the SUM of the two ephemeral buckets when the breakdown is present; older logs lack the `cache_creation` object entirely.

---

### Task 1: Tier-aware `costForUsage` + snapshot constant

**Files:**
- Modify: `packages/cli/src/pricing.ts`
- Test: `packages/cli/test/pricing.test.ts`

**Interfaces:**
- Consumes: existing `PRICES`, `priceFor(model)`, `TokenUsage` from `../src/types.js`.
- Produces: `costForUsage(model: string, u: TokenUsage, opts?: CostOptions): number` where `interface CostOptions { cacheWrite1h?: number }`; `export const PRICES_SNAPSHOT_DATE: string`. Task 2 relies on exactly this signature.

- [ ] **Step 1: Write the failing tests** — append to `packages/cli/test/pricing.test.ts`:

```ts
import { PRICES_SNAPSHOT_DATE } from '../src/pricing.js';

describe('costForUsage cache-write tiers', () => {
  const u = { input: 100, output: 200, cacheWrite: 1000, cacheRead: 5000 };

  it('bills the 1h portion at 2x input and the rest at the table 5m rate', () => {
    // sonnet: in 3, out 15, cacheWrite(5m) 3.75, cacheRead 0.3; 1h = 3*2 = 6 per MTok
    // (100*3 + 200*15 + 400*3.75 + 600*6 + 5000*0.3) / 1e6 = 0.0099
    expect(costForUsage('claude-sonnet-5', u, { cacheWrite1h: 600 })).toBeCloseTo(0.0099, 12);
  });

  it('defaults to the 5m rate when no breakdown is passed (old logs)', () => {
    // (100*3 + 200*15 + 1000*3.75 + 5000*0.3) / 1e6 = 0.00855
    expect(costForUsage('claude-sonnet-5', u)).toBeCloseTo(0.00855, 12);
  });

  it('clamps cacheWrite1h to the cacheWrite total (defensive against bad logs)', () => {
    expect(costForUsage('claude-sonnet-5', u, { cacheWrite1h: 9999 })).toBeCloseTo(
      (100 * 3 + 200 * 15 + 1000 * 6 + 5000 * 0.3) / 1e6, 12,
    );
  });
});

describe('PRICES_SNAPSHOT_DATE', () => {
  it('is a YYYY-MM-DD date string', () => {
    expect(PRICES_SNAPSHOT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

(Adjust the top of the file so `costForUsage` and `describe/it/expect` imports remain intact; the file already imports `costForUsage`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/pricing.test.ts` (cwd `packages/cli`)
Expected: FAIL — `PRICES_SNAPSHOT_DATE` not exported; tier test gets 0.00855 (no opts param yet).

- [ ] **Step 3: Implement in `packages/cli/src/pricing.ts`** — replace the existing `costForUsage` and add the constant + comment above `PRICES`:

```ts
// USD per million tokens. Sources: public Anthropic/OpenAI pricing pages.
// SNAPSHOT POLICY: this table is a point-in-time snapshot (see PRICES_SNAPSHOT_DATE);
// refresh the numbers AND the date together, each release. Historical usage is priced
// at the snapshot rates — we do not track per-date price history (documented in METHODOLOGY).
// The cacheWrite column is the 5-MINUTE (1.25x input) rate; 1-hour writes bill at 2x input
// via CostOptions.cacheWrite1h.
export const PRICES_SNAPSHOT_DATE = '2026-07-08';

export interface CostOptions {
  /** Portion of u.cacheWrite written with a 1-hour TTL (Claude Code:
   *  usage.cache_creation.ephemeral_1h_input_tokens). Billed at 2x input. */
  cacheWrite1h?: number;
}

export function costForUsage(model: string, u: TokenUsage, opts: CostOptions = {}): number {
  const p = priceFor(model);
  const oneHour = Math.min(Math.max(opts.cacheWrite1h ?? 0, 0), u.cacheWrite);
  const fiveMin = u.cacheWrite - oneHour;
  return (
    (u.input * p.input +
      u.output * p.output +
      fiveMin * p.cacheWrite +
      oneHour * p.input * 2 +
      u.cacheRead * p.cacheRead) /
    1_000_000
  );
}
```

(The existing `// USD per million tokens...` comment above `PRICES` is replaced by the block above. `PRICES`, `FALLBACK`, `priceFor` stay unchanged.)

- [ ] **Step 4: Run the full CLI suite**

Run: `npx vitest run` (cwd `packages/cli`)
Expected: ALL PASS — existing pricing/codex/litellm tests still pin the same numbers (default path unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/pricing.ts packages/cli/test/pricing.test.ts
git commit -m "feat(pricing): tier-aware cache-write cost + PRICES_SNAPSHOT_DATE (S1, #12)"
```

### Task 2: claude-code collector passes the 1h breakdown

**Files:**
- Modify: `packages/cli/src/collectors/claude-code.ts:33-43`
- Create: `packages/cli/test/fixtures/claude/session-cache1h.jsonl`
- Test: `packages/cli/test/claude-code.test.ts`

**Interfaces:**
- Consumes: `costForUsage(model, u, { cacheWrite1h })` from Task 1.
- Produces: no signature changes — `parseClaudeJsonl(content, seen, since?)` return shape stays `{ tokens, costUsd, skipped }`.

- [ ] **Step 1: Create the fixture** `packages/cli/test/fixtures/claude/session-cache1h.jsonl` (two records: one with the 1h breakdown, one legacy record without `cache_creation`):

```jsonl
{"type":"assistant","timestamp":"2026-07-01T10:00:00.000Z","requestId":"req_C1","message":{"id":"msg_C1","model":"claude-sonnet-5","usage":{"input_tokens":100,"output_tokens":200,"cache_creation_input_tokens":1000,"cache_read_input_tokens":5000,"cache_creation":{"ephemeral_1h_input_tokens":600,"ephemeral_5m_input_tokens":400}}}}
{"type":"assistant","timestamp":"2026-07-01T10:01:00.000Z","requestId":"req_C2","message":{"id":"msg_C2","model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":100,"cache_read_input_tokens":0}}}
```

- [ ] **Step 2: Write the failing test** — append to `packages/cli/test/claude-code.test.ts`:

```ts
const fixture1h = fileURLToPath(new URL('./fixtures/claude/session-cache1h.jsonl', import.meta.url));

describe('cache-write tier pricing', () => {
  it('bills ephemeral_1h at 2x input and falls back to 5m without the breakdown', () => {
    const r = parseClaudeJsonl(readFileSync(fixture1h, 'utf8'), new Set());
    expect(r.tokens).toEqual({ input: 110, output: 220, cacheWrite: 1100, cacheRead: 5000 });
    // rec1 (breakdown): (100*3 + 200*15 + 400*3.75 + 600*6 + 5000*0.3)/1e6 = 0.0099
    // rec2 (legacy):    (10*3 + 20*15 + 100*3.75 + 0*0.3)/1e6            = 0.000705
    expect(r.costUsd).toBeCloseTo(0.0099 + 0.000705, 12);
  });
});
```

(`fileURLToPath`, `readFileSync`, `parseClaudeJsonl` are already imported at the top of this test file.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/claude-code.test.ts` (cwd `packages/cli`)
Expected: FAIL — costUsd comes out at the flat 5m rate (0.010305… vs expected 0.010605).

- [ ] **Step 4: Implement** — in `packages/cli/src/collectors/claude-code.ts`, replace the cost line (currently `costUsd += costForUsage(obj.message.model ?? '', u);`) with:

```ts
    const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    costUsd += costForUsage(obj.message.model ?? '', u, { cacheWrite1h });
```

- [ ] **Step 5: Run the full CLI suite**

Run: `npx vitest run` (cwd `packages/cli`)
Expected: ALL PASS (existing fixtures lack `cache_creation` → identical costs as before).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/collectors/claude-code.ts packages/cli/test/claude-code.test.ts packages/cli/test/fixtures/claude/session-cache1h.jsonl
git commit -m "feat(claude-code): bill 1h cache writes at 2x input via cache_creation breakdown (S1, #12)"
```

### Task 3: METHODOLOGY cost-model documentation

**Files:**
- Modify: `METHODOLOGY.md` (section «## 2. Cost model», lines ~18-32)

**Interfaces:**
- Consumes: `PRICES_SNAPSHOT_DATE = '2026-07-08'` and the tier policy from Tasks 1-2 — the doc must match the code exactly.
- Produces: nothing downstream; this closes the slice.

- [ ] **Step 1: Edit METHODOLOGY.md.** Replace the intro line of section 2 (currently `Costs are computed from a **bundled static price table** (USD per million tokens), refreshed each release. Source: [...]`) with:

```markdown
Costs are computed from a **bundled static price table** (USD per million tokens), snapshotted **2026-07-08** (`PRICES_SNAPSHOT_DATE`) and refreshed together with its date each release. Historical usage is priced at the snapshot rates — we do not model per-date price history, so month-old tokens are valued at today's prices (same tradeoff as ccusage; keeps the scan dependency-free and offline). Source: [`packages/cli/src/pricing.ts`](packages/cli/src/pricing.ts).
```

Then add one bullet to the list under the table (after the `codex-default` bullet):

```markdown
- **Cache writes are tiered.** The table's cache-write column is the 5-minute (1.25× input) rate. When Claude Code logs carry the `usage.cache_creation` breakdown, the 1-hour portion is billed at **2× input** (`ephemeral_1h_input_tokens`). Legacy logs without the breakdown fall back to the 5-minute rate, which **undercounts** 1h-heavy sessions — a documented, conservative-for-your-wallet simplification.
```

- [ ] **Step 2: Fact-check the edited section against the code**

Run: `npx vitest run test/pricing.test.ts test/claude-code.test.ts` (cwd `packages/cli`)
Expected: PASS — and manually confirm the doc's `2026-07-08`, `1.25×`, `2×` figures match `pricing.ts` verbatim.

- [ ] **Step 3: Commit and close the slice**

```bash
git add METHODOLOGY.md
git commit -m "docs(methodology): price snapshot date + cache-write tier policy (S1, closes #12)"
```

---

## Self-review notes

- Spec coverage: snapshot ✓ (Task 1 const + Task 3 doc), cache-write tiers ✓ (Tasks 1-2), regression tests pinning exact costs ✓ (both test steps use exact `toBeCloseTo(…, 12)` pins).
- No payload/worker changes anywhere — frozen-payload constraint honored.
- Type consistency: `CostOptions.cacheWrite1h` name used identically in Tasks 1, 2; fixture model `claude-sonnet-5` prefix-matches the `claude-sonnet` PRICES row.
- Deliberately NOT done (YAGNI, per epic): per-date price history, codex/litellm tier handling (their sources carry no cache-write breakdown), surfacing the snapshot date on the card.
