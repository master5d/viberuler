# VibeRuler Root-Cause Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structural root-cause attribution layer to `viberuler audit` that partitions the audit's already-measured token waste under named upstream motifs, each ranked with a concrete fix, behind a `--why` flag.

**Architecture:** The parse loop emits a `WasteEvent[]` (one per non-side Read result and per Agent return, with waste flags). A pure `attributeRootCauses(events, tokensToUsd)` assigns each event's tokens to exactly one motif via a precedence `if/else-if` chain (single-ownership → disjoint partition → no double-count). `runAudit` populates an optional `AuditReport.rootCauses` under `ctx.why`; `render-audit.ts` renders a flag-gated section with the attribution-not-causation disclaimer.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, tsup. Package: `packages/cli` (`viberuler@0.6.0`). No new dependencies.

## Global Constraints

- **Attribution, not causation.** Never claim proven causation. The rendered section carries: `Structural attribution: these motifs precede the waste and are the most actionable fix — not proven causation.` Each motif traces to its detection rule (VibeRuler METHODOLOGY: traceable or it's a bug).
- **Single ownership / no double-count.** Each `WasteEvent`'s tokens are attributed to **exactly one** motif. `Σ attributableTokens` over motifs equals the sum of owned-event tokens and is `≤` the total waste-event tokens — enforced by construction (an `if/else-if` chain) and asserted by a test.
- **Real counterfactual stays separate.** Cache economy (`costNoCacheUsd`) is untouched — never folded into the attributed motifs.
- **Flag-gated.** `--why` populates and renders the section; without it the audit output is byte-for-byte unchanged (the live 0.6.0 card must not shift).
- **Precedence order:** `read-whole-then-reread` (1) > `oversized-unslice` (2) > `explore-wide-use-narrow` (3); `subagent-result-bloat` (4) is scored separately on Agent returns.
- **Constant:** `SUBAGENT_RETURN_BUDGET_TOKENS = 2000` (a subagent return under budget is not waste; only the excess is attributed).
- **ESM imports** use `.js` specifiers (e.g. `from './root-cause.js'`), matching the existing codebase. Tests import from `../src/<x>.js`.
- **No new deps; pure functions have no I/O.** Live parse/fs only in `audit.ts`; `root-cause.ts` is pure and unit-tested with synthetic events.

---

### Task 1: Pure `attributeRootCauses` + types (root-cause.ts)

**Files:**
- Create: `packages/cli/src/root-cause.ts`
- Create: `packages/cli/test/root-cause.test.ts`

**Interfaces:**
- Produces: `WasteEvent`, `Motif`, `RootCause` types; `SUBAGENT_RETURN_BUDGET_TOKENS`; `attributeRootCauses(events: WasteEvent[], tokensToUsd: (t: number) => number) => RootCause[]`.

**Details:** Pure, no I/O. Each read event enters exactly one motif via `if/else-if` (precedence 1>2>3); agent events score `max(0, tokens − budget)` into motif 4. Buckets track per-path tokens for `evidence` (top 3 paths). Output ranked by `attributableTokens` desc; motifs with 0 tokens are omitted.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/test/root-cause.test.ts
import { describe, it, expect } from 'vitest';
import {
  attributeRootCauses,
  SUBAGENT_RETURN_BUDGET_TOKENS,
  type WasteEvent,
} from '../src/root-cause.js';

const ev = (p: Partial<WasteEvent>): WasteEvent => ({
  path: '', tokens: 0, kind: 'read',
  oversized: false, sliced: false, repeat: false, exploratory: false, ...p,
});
const idUsd = (t: number) => t; // 1 token = 1 "usd" for easy assertions

describe('attributeRootCauses', () => {
  it('returns [] for a clean trajectory (no waste flags)', () => {
    const events = [ev({ path: 'a.ts', tokens: 500, sliced: true })];
    expect(attributeRootCauses(events, idUsd)).toEqual([]);
  });

  it('attributes each motif and ranks by tokens desc', () => {
    const events = [
      ev({ path: 'big.ts', tokens: 300, repeat: true }),                 // motif 1
      ev({ path: 'huge.ts', tokens: 900, oversized: true }),            // motif 2
      ev({ path: 'x.ts', tokens: 100, exploratory: true }),            // motif 3
      ev({ kind: 'agent', tokens: 5000 }),                              // motif 4: 5000-2000=3000
    ];
    const out = attributeRootCauses(events, idUsd);
    expect(out.map((r) => r.motif)).toEqual([
      'subagent-result-bloat',      // 3000
      'oversized-unslice',          // 900
      'read-whole-then-reread',     // 300
      'explore-wide-use-narrow',    // 100
    ]);
    expect(out[0].attributableTokens).toBe(3000);
    expect(out[0].attributableUsd).toBe(3000);
    expect(out.find((r) => r.motif === 'read-whole-then-reread')!.evidence[0]).toContain('big.ts');
  });

  it('single-ownership: a repeat AND oversized event is counted once under motif 1', () => {
    const events = [ev({ path: 'f.ts', tokens: 400, repeat: true, oversized: true })];
    const out = attributeRootCauses(events, idUsd);
    expect(out).toHaveLength(1);
    expect(out[0].motif).toBe('read-whole-then-reread');
    // invariant: total attributed == the single event's tokens, never doubled
    const total = out.reduce((s, r) => s + r.attributableTokens, 0);
    expect(total).toBe(400);
  });

  it('invariant: Σ attributableTokens ≤ Σ waste-event tokens on a mixed fixture', () => {
    const events = [
      ev({ path: 'a', tokens: 200, repeat: true, oversized: true, exploratory: true }),
      ev({ path: 'b', tokens: 150, oversized: true, exploratory: true }),
      ev({ path: 'c', tokens: 80, sliced: true }),          // clean → 0
      ev({ kind: 'agent', tokens: 1500 }),                   // under budget → 0
    ];
    const out = attributeRootCauses(events, idUsd);
    const attributed = out.reduce((s, r) => s + r.attributableTokens, 0);
    const totalEventTokens = events.reduce((s, e) => s + e.tokens, 0);
    expect(attributed).toBeLessThanOrEqual(totalEventTokens);
    expect(attributed).toBe(200 + 150); // a→motif1(200), b→motif2(150), c/agent→0
  });

  it('agent return under budget contributes nothing', () => {
    const events = [ev({ kind: 'agent', tokens: SUBAGENT_RETURN_BUDGET_TOKENS })];
    expect(attributeRootCauses(events, idUsd)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/root-cause.test.ts`
Expected: FAIL — cannot resolve `../src/root-cause.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/cli/src/root-cause.ts

/** One tool result that could be waste: a non-side Read, or an Agent return. */
export interface WasteEvent {
  /** File path for reads; '' for agent returns. */
  path: string;
  /** Result size in tokens. */
  tokens: number;
  kind: 'read' | 'agent';
  /** Result exceeded the oversized threshold. */
  oversized: boolean;
  /** The Read used offset/limit (disciplined). */
  sliced: boolean;
  /** Identical-size re-read of the same path — the second+ read bought nothing. */
  repeat: boolean;
  /** Whole-file read of a path never subsequently edited (set post-parse). */
  exploratory: boolean;
}

export type Motif =
  | 'read-whole-then-reread'
  | 'oversized-unslice'
  | 'explore-wide-use-narrow'
  | 'subagent-result-bloat';

export interface RootCause {
  motif: Motif;
  /** Human root cause. */
  rootCause: string;
  /** Concrete fix. */
  fix: string;
  attributableTokens: number;
  attributableUsd: number;
  /** Top offending paths/counts, for traceability. */
  evidence: string[];
}

/** A subagent return under this many tokens is not waste; only the excess is attributed. */
export const SUBAGENT_RETURN_BUDGET_TOKENS = 2000;

const META: Record<Motif, { rootCause: string; fix: string }> = {
  'read-whole-then-reread': {
    rootCause: 're-read an unchanged file you had already read whole',
    fix: 'slice large reads (offset/limit); trust the first read',
  },
  'oversized-unslice': {
    rootCause: 'pulled a huge result whole instead of slicing',
    fix: 'use head_limit/offset; paginate large reads',
  },
  'explore-wide-use-narrow': {
    rootCause: 'read files you never edited',
    fix: 'outline/grep first; read only what you will touch',
  },
  'subagent-result-bloat': {
    rootCause: 'subagents returned large results into the parent context',
    fix: 'have subagents return files/summaries, not full dumps',
  },
};

/** Precedence 1>2>3 for reads; agents scored separately. Single-ownership by construction. */
function ownerOf(e: WasteEvent): Motif | null {
  if (e.kind === 'agent') return null; // handled separately (budget excess)
  if (e.repeat) return 'read-whole-then-reread';
  if (e.oversized && !e.sliced) return 'oversized-unslice';
  if (e.exploratory) return 'explore-wide-use-narrow';
  return null;
}

export function attributeRootCauses(
  events: WasteEvent[],
  tokensToUsd: (t: number) => number,
): RootCause[] {
  const buckets = new Map<Motif, { tokens: number; paths: Map<string, number> }>();
  const add = (m: Motif, tokens: number, path: string): void => {
    let b = buckets.get(m);
    if (!b) {
      b = { tokens: 0, paths: new Map() };
      buckets.set(m, b);
    }
    b.tokens += tokens;
    if (path) b.paths.set(path, (b.paths.get(path) ?? 0) + tokens);
  };

  for (const e of events) {
    if (e.kind === 'agent') {
      const excess = Math.max(0, e.tokens - SUBAGENT_RETURN_BUDGET_TOKENS);
      if (excess > 0) add('subagent-result-bloat', excess, '');
      continue;
    }
    const m = ownerOf(e);
    if (m) add(m, e.tokens, e.path);
  }

  const out: RootCause[] = [];
  for (const [motif, b] of buckets) {
    if (b.tokens <= 0) continue;
    const evidence = [...b.paths.entries()]
      .sort((a, z) => z[1] - a[1])
      .slice(0, 3)
      .map(([p, t]) => `${p} (${t} tok)`);
    out.push({
      motif,
      rootCause: META[motif].rootCause,
      fix: META[motif].fix,
      attributableTokens: b.tokens,
      attributableUsd: tokensToUsd(b.tokens),
      evidence,
    });
  }
  out.sort((a, z) => z.attributableTokens - a.attributableTokens);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/root-cause.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/root-cause.ts packages/cli/test/root-cause.test.ts
git commit -m "feat(cli): pure root-cause attribution (single-ownership partition)"
```

---

### Task 2: Emit `WasteEvent[]` from the audit parse loop

**Files:**
- Modify: `packages/cli/src/audit.ts`
- Modify: `packages/cli/test/audit.test.ts`

**Interfaces:**
- Consumes: `WasteEvent` (Task 1).
- Produces: `Acc.wasteEvents: WasteEvent[]` populated by `parseAuditJsonl`.

**Details:** Add `wasteEvents: WasteEvent[]` to the `Acc` interface and `emptyAcc()`. In the `tool_result` branch, for a non-side Read (has an `idToRead` entry) push a `WasteEvent` with the flags already computed there; for a non-side Agent result push `{ kind: 'agent', tokens }`. After the per-line loop, in the same post-processing pass that classifies exploratory reads, set `exploratory` on the corresponding read events (whole-file read of a path never edited). Existing `GhostStats` aggregation is unchanged (additive).

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/test/audit.test.ts` (reuse the file's existing `asst`/`res` helpers; add a `toolUse` helper if not present):

```typescript
import { attributeRootCauses } from '../src/root-cause.js';

describe('wasteEvents', () => {
  const readUse = (id: string, path: string, sliced = false) =>
    JSON.stringify({
      type: 'assistant', requestId: `r-${id}`, message: {
        id: `m-${id}`, model: 'claude-sonnet-4-5', usage: { input_tokens: 1 },
        content: [{ type: 'tool_use', id, name: 'Read',
          input: sliced ? { file_path: path, offset: 0, limit: 10 } : { file_path: path } }],
      },
    });

  it('emits a read WasteEvent and marks exploratory when the path is never edited', () => {
    const acc = emptyAcc();
    // Read big.ts whole (never edited later) → exploratory
    parseAuditJsonl([readUse('t1', '/x/big.ts'), res('t1', 8000)].join('\n'), acc);
    const reads = acc.wasteEvents.filter((e) => e.kind === 'read');
    expect(reads).toHaveLength(1);
    expect(reads[0].path).toBe('/x/big.ts');
    expect(reads[0].oversized).toBe(true);       // 8000 chars > 4096
    expect(reads[0].sliced).toBe(false);
    expect(reads[0].exploratory).toBe(true);      // never edited
  });

  it('emits an agent WasteEvent for an Agent return', () => {
    const acc = emptyAcc();
    const agentUse = JSON.stringify({
      type: 'assistant', requestId: 'ra', message: {
        id: 'ma', model: 'claude-sonnet-4-5', usage: { input_tokens: 1 },
        content: [{ type: 'tool_use', id: 'ag1', name: 'Agent', input: {} }],
      },
    });
    parseAuditJsonl([agentUse, res('ag1', 20000)].join('\n'), acc);
    const agents = acc.wasteEvents.filter((e) => e.kind === 'agent');
    expect(agents).toHaveLength(1);
    expect(agents[0].tokens).toBeGreaterThan(0);
    // and it flows through attribution as bloat (20000 chars ≈ >2000 tokens)
    expect(attributeRootCauses(acc.wasteEvents, (t) => t).some(
      (r) => r.motif === 'subagent-result-bloat')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/audit.test.ts -t wasteEvents`
Expected: FAIL — `acc.wasteEvents` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `packages/cli/src/audit.ts`:

1. Add the import at the top (near the other imports):

```typescript
import type { WasteEvent } from './root-cause.js';
```

2. Add the field to the `Acc` interface (after `ghosts: GhostStats;`):

```typescript
  wasteEvents: WasteEvent[];
```

3. Add it to `emptyAcc()` (in the returned object, alongside `ghosts: emptyGhosts()`):

```typescript
    wasteEvents: [],
```

4. In `parseAuditJsonl`, inside the `tool_result` branch's `if (!isSide)` block, where `read` is resolved and repeat is detected, push a read event. Replace the existing repeat-detection block so the event is emitted with the flags:

```typescript
          const read = acc.idToRead.get(tid);
          if (read) {
            g.readCalls++;
            g.readTokens += tok;
            let isRepeat = false;
            if (read.sliced) {
              g.slicedCalls++;
            } else {
              reads.push({ path: read.path, tokens: tok, sliced: false });
            }
            let prior = readSizes.get(read.path);
            if (!prior) {
              prior = [];
              readSizes.set(read.path, prior);
            }
            if (prior.includes(tok)) {
              g.repeatReadCalls++;
              g.repeatReadTokens += tok;
              isRepeat = true;
            }
            prior.push(tok);
            acc.wasteEvents.push({
              path: read.path, tokens: tok, kind: 'read',
              oversized: chars > OVERSIZED_CHARS, sliced: read.sliced,
              repeat: isRepeat, exploratory: false, // exploratory resolved post-loop
            });
          }
```

5. Where the existing code handles the Agent result (`if (name === 'Agent' && !isSide) acc.agentReturned += tok;`), also push an agent event right after it:

```typescript
        if (name === 'Agent' && !isSide) {
          acc.agentReturned += tok;
          acc.wasteEvents.push({
            path: '', tokens: tok, kind: 'agent',
            oversized: false, sliced: false, repeat: false, exploratory: false,
          });
        }
```

6. In the post-loop pass that classifies exploratory reads, mark the matching events. Replace the existing exploratory loop:

```typescript
  for (const r of reads) {
    if (edited.has(r.path)) continue;
    acc.ghosts.exploratoryCalls++;
    acc.ghosts.exploratoryTokens += r.tokens;
  }
  // Mark exploratory on the emitted events: a whole-file (non-sliced) read of a
  // path this session never edited. Resolved here because `edited` is only complete
  // once the whole transcript is parsed.
  for (const e of acc.wasteEvents) {
    if (e.kind === 'read' && !e.sliced && e.path && !edited.has(e.path)) {
      e.exploratory = true;
    }
  }
```

(Note: `edited` is a per-call local in `parseAuditJsonl`; this pass runs inside the same function, at the end, where `edited` is in scope. The `wasteEvents` pushed this call are the tail of `acc.wasteEvents`, but marking by path over the whole array is safe because paths are session-local and this runs once per transcript — a read event from a *prior* transcript with the same path would only be (re)marked exploratory if that path was also unedited there, which was already true. To be exact, capture the start index before the loop and only mark events pushed in this call.)

To be exact, capture the slice boundary. At the top of `parseAuditJsonl`, before the line loop, add:

```typescript
  const wasteStart = acc.wasteEvents.length;
```

and change the marking loop to:

```typescript
  for (let i = wasteStart; i < acc.wasteEvents.length; i++) {
    const e = acc.wasteEvents[i];
    if (e.kind === 'read' && !e.sliced && e.path && !edited.has(e.path)) {
      e.exploratory = true;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/audit.test.ts`
Expected: PASS (existing audit tests + the 2 new `wasteEvents` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/audit.ts packages/cli/test/audit.test.ts
git commit -m "feat(cli): emit per-event WasteEvents from the audit parse loop"
```

---

### Task 3: Wire attribution into `runAudit` + `AuditReport`

**Files:**
- Modify: `packages/cli/src/audit.ts`
- Modify: `packages/cli/src/types.ts`
- Modify: `packages/cli/test/audit.test.ts`

**Interfaces:**
- Consumes: `attributeRootCauses`, `RootCause` (Task 1); `Acc.wasteEvents` (Task 2).
- Produces: `ScanContext.why?: boolean`; `AuditReport.rootCauses?: RootCause[]`; `runAudit` populates it when `ctx.why`.

**Details:** Add `why?: boolean` to `ScanContext` (in `types.ts`). Add `rootCauses?: RootCause[]` to `AuditReport` (in `audit.ts`, import `RootCause`). In `runAudit`, after building `tokens` and before the `return`, compute an effective per-token USD rate from the session's own cost and attribute when `ctx.why`.

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/test/audit.test.ts` (uses a temp `.claude/projects` dir like the existing `runAudit` tests — reuse the file's existing temp-dir helper pattern):

```typescript
describe('runAudit rootCauses (--why)', () => {
  it('omits rootCauses without ctx.why and populates with it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vr-why-'));
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });
    const readUse = JSON.stringify({
      type: 'assistant', requestId: 'r1', message: {
        id: 'm1', model: 'claude-sonnet-4-5',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x/big.ts' } }],
      },
    });
    const result = JSON.stringify({
      type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(9000) }] },
    });
    await writeFile(join(proj, 's.jsonl'), [readUse, result].join('\n'));

    const base = { home, scanDirs: [], env: {} };
    const without = await runAudit(base);
    expect(without.rootCauses).toBeUndefined();

    const withWhy = await runAudit({ ...base, why: true });
    expect(Array.isArray(withWhy.rootCauses)).toBe(true);
    // an oversized, never-edited whole read → explore-wide or oversized motif present
    expect(withWhy.rootCauses!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/audit.test.ts -t "runAudit rootCauses"`
Expected: FAIL — `rootCauses` is always undefined (and/or `why` not accepted on the context type; if TS complains, that confirms the type gap).

- [ ] **Step 3: Write minimal implementation**

1. In `packages/cli/src/types.ts`, add to `ScanContext`:

```typescript
  why?: boolean; // audit --why: compute the root-cause attribution section
```

2. In `packages/cli/src/audit.ts`, import `RootCause` and `attributeRootCauses`:

```typescript
import { attributeRootCauses, type RootCause } from './root-cause.js';
```

3. Add the optional field to `AuditReport` (after `warnings: string[];`):

```typescript
  /** Populated only under `--why`: ranked structural root-cause attribution. */
  rootCauses?: RootCause[];
```

4. In `runAudit`, build the return object into a variable, attribute when asked, and return it. Replace `return { ... };` with:

```typescript
  const report: AuditReport = {
    sessions,
    tokens,
    costUsd: acc.costUsd,
    costNoCacheUsd: acc.costNoCacheUsd,
    cacheHitPct: totalInputSide > 0 ? (100 * tokens.cacheRead) / totalInputSide : 0,
    main,
    sub,
    subagents: {
      agents: acc.agentIds.size,
      calls: acc.agentCalls,
      returnedTokens: acc.agentReturned,
      keptOutTokens: keptOut,
      compression: acc.agentReturned > 0 ? sub.admittedTokens / acc.agentReturned : 0,
      shareOfSpendPct: totalInputSide > 0 ? (100 * sub.inputSideTokens) / totalInputSide : 0,
    },
    coldMain: coldOf(acc.coldMain),
    coldSub: coldOf(acc.coldSub),
    ghosts: acc.ghosts,
    tools,
    surfaces,
    dead,
    warnings,
  };

  if (ctx.why) {
    const totalInput = tokens.input + tokens.cacheWrite + tokens.cacheRead;
    const rate = totalInput > 0 ? acc.costUsd / totalInput : 0; // session's own $/token
    report.rootCauses = attributeRootCauses(acc.wasteEvents, (t) => t * rate);
  }

  return report;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/audit.test.ts && npx tsc --noEmit`
Expected: PASS (all audit tests) and a clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/audit.ts packages/cli/src/types.ts packages/cli/test/audit.test.ts
git commit -m "feat(cli): populate AuditReport.rootCauses under --why"
```

---

### Task 4: `--why` flag + `renderRootCauses`

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/render-audit.ts`
- Modify: `packages/cli/test/audit.test.ts`

**Interfaces:**
- Consumes: `AuditReport.rootCauses` (Task 3).
- Produces: `renderRootCauses(rootCauses: RootCause[]): string`; `renderAudit` appends it when present; `cli.ts` sets `ctx.why` from `--why`.

**Details:** `renderRootCauses` returns the section: a disclaimer header, one block per ranked motif (`root cause`, `fix`, attributable tokens/USD, top evidence), and a total-attributed line. `renderAudit` appends `renderRootCauses(r.rootCauses)` when `r.rootCauses?.length`. `cli.ts` detects `--why` in argv and sets `actx.why = true` before `runAudit`.

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/test/audit.test.ts`:

```typescript
import { renderRootCauses } from '../src/render-audit.js';
import type { RootCause } from '../src/root-cause.js';

describe('renderRootCauses', () => {
  const rc: RootCause[] = [
    { motif: 'subagent-result-bloat', rootCause: 'subagents returned large results',
      fix: 'return summaries', attributableTokens: 3000, attributableUsd: 0.01, evidence: [] },
    { motif: 'read-whole-then-reread', rootCause: 're-read an unchanged file',
      fix: 'slice reads', attributableTokens: 300, attributableUsd: 0.001,
      evidence: ['big.ts (300 tok)'] },
  ];

  it('renders the disclaimer, ranked motifs, evidence, and a total', () => {
    const s = renderRootCauses(rc);
    expect(s.toLowerCase()).toContain('not proven causation');   // honesty disclaimer
    expect(s.indexOf('subagent-result-bloat')).toBeLessThan(s.indexOf('read-whole-then-reread')); // ranked
    expect(s).toContain('big.ts (300 tok)');                     // evidence
    expect(s).toContain('3300');                                 // total attributed tokens
  });

  it('renders nothing for an empty list', () => {
    expect(renderRootCauses([])).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/audit.test.ts -t renderRootCauses`
Expected: FAIL — `renderRootCauses` is not exported.

- [ ] **Step 3: Write minimal implementation**

1. In `packages/cli/src/render-audit.ts`, add the import and the exported function (place `renderRootCauses` above `renderAudit`):

```typescript
import type { RootCause } from './root-cause.js';

export function renderRootCauses(rootCauses: RootCause[]): string {
  if (!rootCauses.length) return '';
  const total = rootCauses.reduce((s, r) => s + r.attributableTokens, 0);
  const lines: string[] = [];
  lines.push('');
  lines.push('Root causes — structural attribution: these motifs precede the waste and');
  lines.push('are the most actionable fix — not proven causation.');
  for (const r of rootCauses) {
    lines.push('');
    lines.push(`  ${r.motif}  —  ${r.attributableTokens} tok  ($${r.attributableUsd.toFixed(4)})`);
    lines.push(`    cause: ${r.rootCause}`);
    lines.push(`    fix:   ${r.fix}`);
    for (const e of r.evidence) lines.push(`    · ${e}`);
  }
  lines.push('');
  lines.push(`  attributed ${total} tok across ${rootCauses.length} root cause(s).`);
  return lines.join('\n');
}
```

2. In `renderAudit`, append the section before returning. Locate the final return/assembly of the audit string and add, just before it returns:

```typescript
  if (r.rootCauses?.length) {
    // renderAudit returns a single string; append the section to it.
    return `${/* existing assembled body */ body}${renderRootCauses(r.rootCauses)}`;
  }
```

If `renderAudit` builds its output in a local `string[]` or template, instead push `renderRootCauses(r.rootCauses)` onto that structure when `r.rootCauses?.length`, and keep the existing return. (Read the current `renderAudit` body and integrate accordingly — the requirement is: the section is appended after the existing audit output, and only when `r.rootCauses` is non-empty.)

3. In `packages/cli/src/cli.ts`, in the `if (command === 'audit')` block, set `why` from argv before calling `runAudit`:

```typescript
    actx.why = args.includes('--why');
    const report = await runAudit(actx);
```

(Use the same argv/flags source the other audit flags use — read the surrounding lines to match how `colors`/`version` are derived; `actx` is the resolved `ScanContext` passed to `runAudit`.)

4. Add `--why` to the `audit` help line in `cli.ts` (the usage text around line 48): append `(add --why for root-cause attribution)` to the audit description.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run && npx tsc --noEmit`
Expected: PASS (full suite) and clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/render-audit.ts packages/cli/test/audit.test.ts
git commit -m "feat(cli): --why flag + renderRootCauses section"
```

---

### Task 5: METHODOLOGY section + live smoke

**Files:**
- Modify: `METHODOLOGY.md`

**Interfaces:** none (docs + one live run).

**Details:** Document each motif's detection rule, the precedence, the single-ownership invariant, and the attribution-not-causation disclaimer (VibeRuler requires every number trace to this doc). Then run the gate on real transcripts and record the shape.

- [ ] **Step 1: Live smoke (local, no infra gate)**

Run: `cd packages/cli && npm run build && node dist/bin.js audit --why`
Expected: the normal audit output followed by the "Root causes" section with the disclaimer, ranked motifs, and the `attributed N tok across k root cause(s)` line. Sanity-check that the top motifs are plausible and that `attributed N` does not exceed the audit's reported ghost waste. Record the numbers for the report. (If `npm run build` is heavy, `npx tsx src/bin.ts audit --why` also works.)

- [ ] **Step 2: Add the METHODOLOGY section**

Append to `METHODOLOGY.md` a new section:

```markdown
## Root-cause attribution (`audit --why`)

`viberuler audit --why` partitions the audit's measured waste under the upstream
**motif** that most actionably explains it. It is **structural attribution, not proven
causation** — a motif precedes and correlates with the waste; the tool cannot replay the
session to prove counterfactually that the tokens would not have been spent. Cache economy
(§"Cache economy") is the one axis with a real counterfactual and is reported separately,
never as a motif.

Each waste event (a non-side Read result, or an Agent return) is attributed to **exactly one**
motif by precedence, so the totals are disjoint and sum to ≤ the measured waste (no
double-count). Source: [`packages/cli/src/root-cause.ts`](packages/cli/src/root-cause.ts).

| # | motif | detection rule | fix |
|---|---|---|---|
| 1 | `read-whole-then-reread` | a Read result of identical size to a prior read of the same path (the second+ read bought nothing) | slice large reads; trust the first read |
| 2 | `oversized-unslice` | a non-sliced Read result over 4 KB | head_limit/offset; paginate |
| 3 | `explore-wide-use-narrow` | a whole-file Read of a path never edited in the session | outline/grep first; read only what you'll touch |
| 4 | `subagent-result-bloat` | an Agent return above `SUBAGENT_RETURN_BUDGET_TOKENS` (2000); only the excess is attributed | subagents return files/summaries |

Precedence 1 > 2 > 3 (a repeat-read of an oversized whole file is owned by #1); #4 is scored
independently on Agent returns.
```

- [ ] **Step 3: Commit**

```bash
git add METHODOLOGY.md
git commit -m "docs: methodology for audit --why root-cause attribution"
```

---

## Time Estimate

Raw model estimate (T_model = focused build; T_glue = review loops + commits). Code fully
specified in-plan; Tasks 1,3 are transcription + test cycles, Tasks 2,4 need integration
into existing files (reading surrounding code). GTE-style calibration is a NAUTILUS concept;
this repo has no gate — estimate is advisory only.

| Phase | Scope | T_model | T_glue |
|---|---|---|---|
| Task 1 | pure attributeRootCauses + types | 0:15–0:22 | 0:05–0:10 |
| Tasks 2–3 | parse-loop enrichment + runAudit wiring | 0:25–0:40 | 0:10–0:20 |
| Tasks 4–5 | --why + render + methodology + smoke | 0:20–0:32 | 0:08–0:15 |

## Self-Review

**Spec coverage:**
- §1 attribution-not-causation → Global Constraints + Task 4 disclaimer + Task 5 methodology. ✓
- §2 no-double-count / single ownership → Task 1 `ownerOf` if/else-if + invariant test. ✓
- §3 motif catalog + precedence → Task 1 `META`/`ownerOf` + Task 5 table. ✓
- §4 architecture (root-cause.ts pure, enriched accumulator) → Tasks 1–2. ✓
- §5 integration (--why, rootCauses field, pricing, render, methodology) → Tasks 3–5. ✓
- §6 testing (clean/defect, invariant, precedence, ranking, render, live smoke) → tests across Tasks 1–4 + Task 5 smoke. ✓
- §7 out-of-scope (no replay/ML/trend/extra motifs) → nothing builds them. ✓

**Placeholder scan:** No TBD/TODO. Every code step carries complete code. Task 4 step 3 point 2 (renderAudit append) instructs reading the current body and integrating — this is genuinely integration-dependent (the exact assembly form of `renderAudit` must be matched), not a placeholder; the requirement (append when non-empty, after existing output) and the section function are both fully specified.

**Type consistency:** `WasteEvent { path, tokens, kind, oversized, sliced, repeat, exploratory }` used identically in Tasks 1–3. `RootCause { motif, rootCause, fix, attributableTokens, attributableUsd, evidence }` produced in Task 1, consumed in Tasks 3–4. `attributeRootCauses(events, tokensToUsd)` signature matches between Task 1 def and Task 3 call. `Acc.wasteEvents` added in Task 2, read in Task 3. `ScanContext.why` (Task 3) set in Task 4. `AuditReport.rootCauses?` (Task 3) read in Task 4. ✓

**Controller note for execution:** Tasks 2 and 4 modify existing files whose exact surrounding lines the implementer must read (`parseAuditJsonl`'s tool_result block; `renderAudit`'s assembly). The plan gives the precise insertions; flag to the reviewer that the integration points must be verified against the real file, and that the live smoke (Task 5) is the first real-data exercise of the whole chain.
