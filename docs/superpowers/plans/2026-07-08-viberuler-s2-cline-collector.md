# S2 Cline-family Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One collector that counts real token usage from the Cline extension family — Cline, Roo Code, KiloCode — which all share the same on-disk task format (epic S2, issue #13; closes #5; supersedes-with-credit PR #7).

**Architecture:** A pure parser `parseClineTaskFile(content)` reads a task's `ui_messages.json` (a JSON array); token usage lives in `{type:"say", say:"api_req_started"}` entries whose `text` field is a JSON **string** (JSON-inside-JSON) holding `tokensIn/tokensOut/cacheReads/cacheWrites/cost`. The collector resolves globalStorage roots per-OS (with an env override that makes tests OS-independent), walks `<root>/<ext-id>/tasks/<taskId>/`, dedups by taskId across roots, and reports tokens + cost + which fork(s) were seen. Cost uses Cline's own logged `cost` when present, else the sonnet-tier price table — never both.

**Tech Stack:** TypeScript ESM, vitest ^4.1, `node:fs/promises` + `node:path`. No new dependencies.

## Global Constraints

- `packages/cli` keeps exactly ONE runtime dependency: `picocolors`.
- `engines.node >= 18.17` — no Node 22-only APIs in the CLI core path (this rules out `node:sqlite`; Cline is plain JSON files, so none is needed).
- The submit payload stays EXACTLY the frozen 9 keys (`client_version, vibe_score, loc, projects, tokens, cost_usd, tok_per_usd, achievements, breakdown`). A collector only contributes to the aggregate `RawStats` (tokens/costUsd/sources/agents) — it must NOT touch `payload.ts` or the worker.
- Tests MUST pass identically on ubuntu/macos/windows (3-OS CI). Achieve this with the `VIBERULER_CLINE_STORAGE` env override (via `ctx.env`) so no test depends on real per-OS globalStorage paths — mirrors the litellm collector's `ctx.env` seam.
- Cost rule (fixes PR #7's double-count bug): per api_req_started, `costUsd += (finite numeric metric.cost >= 0) ? metric.cost : costForUsage('claude-sonnet', tokens)`. Never add both.
- Ground-truth format (deep-research verified 2026-07-08 against tokscale, codeburn, and Cline's own source): task file path `globalStorage/<ext-id>/tasks/<taskId>/ui_messages.json`; extension IDs `saoudrizwan.claude-dev` (Cline), `cline.cline` (Cline rebrand), `rooveterinaryinc.roo-cline` (Roo Code), `kilocode.kilo-code` (KiloCode); token payload is a JSON string in the `text` field of `say:"api_req_started"` messages.
- `RawStats.agents` is display-only (feeds the `🤖 agents in the stable` card line) and already excluded from the payload — the collector may add to it.

---

### Task 1: `parseClineTaskFile` pure parser

**Files:**
- Create: `packages/cli/src/collectors/cline.ts` (parser + types only in this task; collector added in Task 2)
- Create: `packages/cli/test/cline.test.ts`

**Interfaces:**
- Consumes: `TokenUsage` from `../types.js`; `costForUsage` from `../pricing.js`.
- Produces: `parseClineTaskFile(content: string): { tokens: TokenUsage; costUsd: number } | null` — returns `null` when the content is not a JSON array or contains no completed api_req_started metrics. Task 2 relies on exactly this signature.

- [ ] **Step 1: Write the failing test** — create `packages/cli/test/cline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseClineTaskFile } from '../src/collectors/cline.js';

// One api_req_started with a full metric+cost, one with tokens but NO cost
// (price-table fallback), one streaming/partial entry (unparseable text → skip),
// plus non-metric messages that must be ignored.
const taskFile = JSON.stringify([
  { type: 'say', say: 'text', text: 'hello' },
  {
    type: 'say',
    say: 'api_req_started',
    text: JSON.stringify({ request: '...', tokensIn: 1000, tokensOut: 500, cacheReads: 8000, cacheWrites: 2000, cost: 0.042 }),
  },
  {
    type: 'say',
    say: 'api_req_started',
    text: JSON.stringify({ tokensIn: 100, tokensOut: 50, cacheReads: 0, cacheWrites: 0 }),
  },
  { type: 'say', say: 'api_req_started', text: '{"request":"in progress' }, // partial → skip
  { type: 'ask', ask: 'tool', text: 'whatever' },
]);

describe('parseClineTaskFile', () => {
  it('sums api_req_started metrics; trusts logged cost, else prices at sonnet tier', () => {
    const r = parseClineTaskFile(taskFile);
    expect(r).not.toBeNull();
    expect(r!.tokens).toEqual({ input: 1100, output: 550, cacheWrite: 2000, cacheRead: 8000 });
    // 0.042 (logged) + costForUsage('claude-sonnet',{in100,out50}) = 0.042 + (100*3+50*15)/1e6
    expect(r!.costUsd).toBeCloseTo(0.042 + 0.00105, 12);
  });

  it('trusts a logged cost of exactly 0 (fully cached) instead of re-pricing', () => {
    const f = JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 5, tokensOut: 0, cacheReads: 9000, cacheWrites: 0, cost: 0 }) },
    ]);
    expect(parseClineTaskFile(f)!.costUsd).toBe(0);
  });

  it('returns null for non-array JSON and for arrays with no completed metrics', () => {
    expect(parseClineTaskFile('{"not":"an array"}')).toBeNull();
    expect(parseClineTaskFile('not json at all')).toBeNull();
    expect(parseClineTaskFile(JSON.stringify([{ type: 'say', say: 'text', text: 'hi' }]))).toBeNull();
    // an api_req_started with no token fields = request not yet completed
    expect(parseClineTaskFile(JSON.stringify([{ type: 'say', say: 'api_req_started', text: '{"request":"x"}' }]))).toBeNull();
  });

  it('coerces missing/non-numeric token fields to 0 without NaN-poisoning', () => {
    const f = JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 10, tokensOut: 'bad', cacheReads: null, cost: 0.001 }) },
    ]);
    const r = parseClineTaskFile(f)!;
    expect(r.tokens).toEqual({ input: 10, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBeCloseTo(0.001, 12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cline.test.ts` (cwd `packages/cli`)
Expected: FAIL — `parseClineTaskFile` is not exported (module has no such member).

- [ ] **Step 3: Implement the parser** — create `packages/cli/src/collectors/cline.ts`:

```ts
import type { TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

interface ClineApiMetrics {
  tokensIn?: unknown;
  tokensOut?: unknown;
  cacheReads?: unknown;
  cacheWrites?: unknown;
  cost?: unknown;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Parse one Cline-family task file (ui_messages.json — a JSON array of UI
 * messages). Token usage lives in { type:"say", say:"api_req_started" } entries
 * whose `text` field is a JSON STRING (JSON-inside-JSON) holding tokensIn/
 * tokensOut/cacheReads/cacheWrites/cost. Streaming/partial entries whose text
 * won't parse, or that carry no token fields yet, are skipped.
 * Returns null when the file isn't a JSON array or holds no completed metrics.
 */
export function parseClineTaskFile(content: string): { tokens: TokenUsage; costUsd: number } | null {
  let msgs: unknown;
  try {
    msgs = JSON.parse(content);
  } catch {
    return null;
  }
  if (!Array.isArray(msgs)) return null;

  const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  let sawMetric = false;

  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue;
    const rec = m as { type?: unknown; say?: unknown; text?: unknown };
    if (rec.type !== 'say' || rec.say !== 'api_req_started' || typeof rec.text !== 'string') continue;

    let metric: ClineApiMetrics;
    try {
      metric = JSON.parse(rec.text) as ClineApiMetrics;
    } catch {
      continue; // partial/streaming entry
    }
    if (
      metric.tokensIn === undefined &&
      metric.tokensOut === undefined &&
      metric.cacheReads === undefined &&
      metric.cacheWrites === undefined
    ) {
      continue; // request not yet completed
    }

    sawMetric = true;
    const t: TokenUsage = {
      input: num(metric.tokensIn),
      output: num(metric.tokensOut),
      cacheWrite: num(metric.cacheWrites),
      cacheRead: num(metric.cacheReads),
    };
    tokens.input += t.input;
    tokens.output += t.output;
    tokens.cacheWrite += t.cacheWrite;
    tokens.cacheRead += t.cacheRead;
    // Trust Cline's own logged cost (including 0) when it's a finite non-negative
    // number; otherwise fall back to the sonnet-tier table (Cline's dominant
    // backend). NEVER both — that was PR #7's double-count bug.
    costUsd +=
      typeof metric.cost === 'number' && Number.isFinite(metric.cost) && metric.cost >= 0
        ? metric.cost
        : costForUsage('claude-sonnet', t);
  }

  return sawMetric ? { tokens, costUsd } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cline.test.ts` (cwd `packages/cli`)
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/collectors/cline.ts packages/cli/test/cline.test.ts
git commit -m "feat(cline): parseClineTaskFile — JSON-in-JSON api_req_started metrics (S2, #13)"
```

### Task 2: Cline collector — roots, walk, dedup, fork detection, wiring

**Files:**
- Modify: `packages/cli/src/collectors/cline.ts` (append collector below the parser)
- Modify: `packages/cli/src/cli.ts:8-17` (import + COLLECTORS array)
- Test: `packages/cli/test/cline.test.ts` (append collector tests)

**Interfaces:**
- Consumes: `parseClineTaskFile` (Task 1); `Collector, ScanContext, TokenUsage` from `../types.js`.
- Produces: `export const clineCollector: Collector`; env override `VIBERULER_CLINE_STORAGE` (path list, delimiter-separated). Registered in `COLLECTORS` after `codexCollector`.

- [ ] **Step 1: Write the failing collector tests** — append to `packages/cli/test/cline.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { clineCollector } from '../src/collectors/cline.js';

async function makeTask(root: string, extId: string, taskId: string, messages: unknown[]): Promise<void> {
  const dir = join(root, extId, 'tasks', taskId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'ui_messages.json'), JSON.stringify(messages));
}

function apiReq(m: Record<string, number>): unknown {
  return { type: 'say', say: 'api_req_started', text: JSON.stringify(m) };
}

describe('clineCollector', () => {
  it('stays dormant when no roots hold task files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nocline-'));
    const ctx = { home, scanDirs: [] as string[], env: { VIBERULER_CLINE_STORAGE: home } };
    expect(await clineCollector.detect(ctx)).toBe(false);
  });

  it('aggregates tokens/cost across tasks and reports the Cline agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-cline-'));
    await makeTask(root, 'saoudrizwan.claude-dev', 'task-1', [apiReq({ tokensIn: 1000, tokensOut: 500, cacheReads: 0, cacheWrites: 0, cost: 0.01 })]);
    await makeTask(root, 'saoudrizwan.claude-dev', 'task-2', [apiReq({ tokensIn: 200, tokensOut: 100, cacheReads: 0, cacheWrites: 0, cost: 0.02 })]);
    const ctx = { home: '/', scanDirs: [], env: { VIBERULER_CLINE_STORAGE: root } };
    expect(await clineCollector.detect(ctx)).toBe(true);
    const r = await clineCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 1200, output: 600, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBeCloseTo(0.03, 12);
    expect(r.sources).toEqual(['cline']);
    expect(r.agents).toEqual(['Cline']);
  });

  it('maps fork extension IDs to distinct agent names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-roo-'));
    await makeTask(root, 'rooveterinaryinc.roo-cline', 't1', [apiReq({ tokensIn: 10, tokensOut: 5, cacheReads: 0, cacheWrites: 0, cost: 0 })]);
    await makeTask(root, 'kilocode.kilo-code', 't2', [apiReq({ tokensIn: 20, tokensOut: 5, cacheReads: 0, cacheWrites: 0, cost: 0 })]);
    const r = await clineCollector.collect({ home: '/', scanDirs: [], env: { VIBERULER_CLINE_STORAGE: root } });
    expect(new Set(r.agents)).toEqual(new Set(['Roo Code', 'KiloCode']));
  });

  it('dedups the same taskId synced across two roots (multi-install)', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'vibe-ca-'));
    const rootB = await mkdtemp(join(tmpdir(), 'vibe-cb-'));
    const msgs = [apiReq({ tokensIn: 1000, tokensOut: 0, cacheReads: 0, cacheWrites: 0, cost: 0.05 })];
    await makeTask(rootA, 'saoudrizwan.claude-dev', 'dup-task', msgs);
    await makeTask(rootB, 'saoudrizwan.claude-dev', 'dup-task', msgs);
    const r = await clineCollector.collect({ home: '/', scanDirs: [], env: { VIBERULER_CLINE_STORAGE: `${rootA}${delimiter}${rootB}` } });
    expect(r.tokens!.input).toBe(1000); // counted once, not 2000
    expect(r.costUsd).toBeCloseTo(0.05, 12);
  });

  it('skips unparseable task files and warns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-clinebad-'));
    const dir = join(root, 'saoudrizwan.claude-dev', 'tasks', 'broken');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ui_messages.json'), 'not json');
    const r = await clineCollector.collect({ home: '/', scanDirs: [], env: { VIBERULER_CLINE_STORAGE: root } });
    expect(r.warnings?.[0]).toMatch(/skipped 1 unparseable/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/cline.test.ts` (cwd `packages/cli`)
Expected: FAIL — `clineCollector` is not exported yet.

- [ ] **Step 3: Append the collector** to `packages/cli/src/collectors/cline.ts` (add these imports at the TOP of the file, merging with the existing `costForUsage` import line, then append the collector at the bottom):

```ts
import { readFile, readdir } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import type { Collector, ScanContext } from '../types.js';
```

Append at the bottom of the file:

```ts
// ext-id → display name for the "agents in the stable" line. Order also defines
// which forks we probe under each globalStorage root.
const EXT_AGENT: Record<string, string> = {
  'saoudrizwan.claude-dev': 'Cline',
  'cline.cline': 'Cline',
  'rooveterinaryinc.roo-cline': 'Roo Code',
  'kilocode.kilo-code': 'KiloCode',
};

function storageRoots(ctx: ScanContext): string[] {
  const env = ctx.env ?? process.env;
  const override = env.VIBERULER_CLINE_STORAGE;
  if (override) return override.split(delimiter).filter(Boolean);

  const roots: string[] = [join(ctx.home, '.cline', 'data')]; // standalone Cline
  const base =
    process.platform === 'win32'
      ? (env.APPDATA ?? join(ctx.home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(ctx.home, 'Library', 'Application Support')
        : join(ctx.home, '.config');
  for (const variant of ['Code', 'Code - Insiders', 'VSCodium']) {
    roots.push(join(base, variant, 'User', 'globalStorage'));
  }
  return roots;
}

async function* taskDirs(ctx: ScanContext): AsyncGenerator<{ id: string; dir: string; agent: string }> {
  for (const root of storageRoots(ctx)) {
    for (const [extId, agent] of Object.entries(EXT_AGENT)) {
      const tasksDir = join(root, extId, 'tasks');
      let entries;
      try {
        entries = await readdir(tasksDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) yield { id: e.name, dir: join(tasksDir, e.name), agent };
      }
    }
  }
}

export const clineCollector: Collector = {
  id: 'cline',
  async detect(ctx) {
    for await (const _dir of taskDirs(ctx)) return true;
    return false;
  },
  async collect(ctx) {
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let skipped = 0;
    const seen = new Set<string>();
    const agents = new Set<string>();

    for await (const { id, dir, agent } of taskDirs(ctx)) {
      if (seen.has(id)) continue; // same task synced across installs — count once
      seen.add(id);
      let content: string;
      try {
        content = await readFile(join(dir, 'ui_messages.json'), 'utf8');
      } catch {
        continue; // task dir without a ui_messages.json
      }
      const r = parseClineTaskFile(content);
      if (!r) {
        skipped++;
        continue;
      }
      agents.add(agent);
      tokens.input += r.tokens.input;
      tokens.output += r.tokens.output;
      tokens.cacheWrite += r.tokens.cacheWrite;
      tokens.cacheRead += r.tokens.cacheRead;
      costUsd += r.costUsd;
    }

    if (agents.size === 0 && skipped === 0) return {}; // nothing here
    const warnings = skipped > 0 ? [`cline: skipped ${skipped} unparseable task file(s)`] : [];
    return { tokens, costUsd, sources: ['cline'], agents: [...agents], warnings };
  },
};
```

- [ ] **Step 4: Wire into the collector pipeline** — in `packages/cli/src/cli.ts`, add the import next to the other collector imports (after the `codexCollector` import line):

```ts
import { clineCollector } from './collectors/cline.js';
```

and add `clineCollector` to the `COLLECTORS` array immediately after `codexCollector`:

```ts
const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector, clineCollector, litellmCollector, agentsCollector, gitCollector, githubCollector];
```

- [ ] **Step 5: Run the full CLI suite**

Run: `npx vitest run` (cwd `packages/cli`)
Expected: ALL PASS — new cline tests green; existing tests unaffected (the collector is dormant unless roots hold task files, and no existing test sets `VIBERULER_CLINE_STORAGE`).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/collectors/cline.ts packages/cli/src/cli.ts packages/cli/test/cline.test.ts
git commit -m "feat(cline): collector with per-OS roots, taskId dedup, fork detection (S2, #13)"
```

### Task 3: Documentation

**Files:**
- Modify: `METHODOLOGY.md` (section «## 1. Data sources» table + the collectors line under it)
- Modify: `README.md:107-111` (the «Roadmap — PRs welcome» checklist)

**Interfaces:**
- Consumes: the shipped behavior of Tasks 1-2 — docs must match code exactly (ext-ids, cost rule, the sonnet fallback).
- Produces: nothing downstream; closes the slice.

**Note:** PRIVACY.md is deliberately source-agnostic (it enumerates what NEVER leaves and the frozen payload, not per-source reads) — do NOT add a Cline bullet there; the existing "any content of any file" + frozen-9-key guarantees already cover it. METHODOLOGY is the source-of-truth for what's read.

- [ ] **Step 1: Add the METHODOLOGY source row.** In `METHODOLOGY.md`, add this row to the «## 1. Data sources» table, immediately after the **Codex** row:

```markdown
| **Cline family** | `…/globalStorage/<ext-id>/tasks/<taskId>/ui_messages.json` for Cline (`saoudrizwan.claude-dev`, `cline.cline`), Roo Code (`rooveterinaryinc.roo-cline`), KiloCode (`kilocode.kilo-code`), across VS Code / Insiders / VSCodium and `~/.cline/data` | Token counts come from `say:"api_req_started"` messages (a JSON object encoded inside the `text` string). Cost uses Cline's own logged `cost` when present, else the sonnet-tier table. Tasks synced across installs are de-duplicated by task id. Override the search roots with `VIBERULER_CLINE_STORAGE`. Source: [`packages/cli/src/collectors/cline.ts`](packages/cli/src/collectors/cline.ts) |
```

- [ ] **Step 2: Update the collectors-roadmap line** under the table. Replace the existing line (`Collectors are plugins behind a 2-method interface (\`detect\` / \`collect\`). Cursor, Gemini CLI, Windsurf, Aider, Cline: PRs welcome — see the README roadmap.`) with:

```markdown
Collectors are plugins behind a 2-method interface (`detect` / `collect`). Cursor, Gemini CLI, Windsurf, Aider: PRs welcome — see the README roadmap.
```

- [ ] **Step 3: Mark Cline done in the README roadmap.** In `README.md`, replace the single line `- [ ] Windsurf / Aider / Cline collectors — \`good first issue\`` with:

```markdown
- [x] Cline / Roo Code / KiloCode collectors (one parser, three forks)
- [ ] Windsurf / Aider collectors — `good first issue`
```

- [ ] **Step 4: Fact-check the docs against the code.**

Run: `npx vitest run test/cline.test.ts` (cwd `packages/cli`)
Expected: PASS — and manually confirm the four ext-ids, the `VIBERULER_CLINE_STORAGE` name, and the "logged cost else sonnet table" rule in the docs match `cline.ts` verbatim.

- [ ] **Step 5: Commit**

```bash
git add METHODOLOGY.md README.md
git commit -m "docs: document the Cline-family collector (S2, closes #13, #5)"
```

---

## Self-review notes

- Spec coverage: one parser three forks ✓ (EXT_AGENT map, Task 2); real `ui_messages.json` format ✓ (Task 1, not flat files — fixes PR #7 issue 3); OS-independent tests ✓ (`VIBERULER_CLINE_STORAGE` override — fixes PR #7 issue 2); cost = logged OR table, never both ✓ (Task 1 cost line + dedicated test — fixes PR #7 issue 1); multi-root dedup ✓ (taskId `seen` set — addresses the #9-adjacent double-mount note in the epic); docs ✓ (Task 3).
- No payload/worker changes — frozen-payload constraint honored; `agents` is display-only and already payload-excluded.
- Type consistency: `parseClineTaskFile` return `{ tokens, costUsd } | null` used identically in Tasks 1-2; `TokenUsage` field names (`input/output/cacheWrite/cacheRead`) match `types.ts`; ext-ids identical across code (Task 2) and docs (Task 3).
- Deliberately NOT done (YAGNI / scope): per-fork `sources` (one `['cline']` source is enough — forks surface via `agents`); the agents-roster (`agents.ts`) `.cline` marker is left as-is since the collector now reports the agent from real data; Windsurf/Aider (no prior art — stays backlog).
- PR #7 disposition: on merge, credit @ayuuxh2 in the merge/commit trailer and close #7 with a note pointing here + offering an open collector issue.
