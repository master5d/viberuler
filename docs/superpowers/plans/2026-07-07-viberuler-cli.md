# VibeRuler CLI (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the local-only `npx viberuler` CLI: scan Claude Code / Codex logs + local git repos (+optional GitHub API), compute the VIBE score, render the ANSI scorecard, and print the future submit payload — zero network calls by default.

**Architecture:** Public monorepo `viberuler` with npm workspaces. This plan builds `packages/cli` only (Plan 2 = `packages/worker`, Plan 3 = release assets). CLI is a collector-plugin pipeline: `Collector[] → RawStats (merged) → ScoreReport → ANSI card / JSON / payload`. Everything is pure-function-first so units are table-testable; filesystem/process access lives in thin wrappers.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Node ≥18.17, `tsup` (single-file bundle with shebang), `vitest`, `picocolors` (the ONLY runtime dep), `node:util.parseArgs` for argv.

## Global Constraints

- Runtime dependency limit: exactly one — `picocolors`. Everything else is devDependency or `node:*` builtin.
- Default run performs **zero network calls**. Network only behind explicit `--github <handle>` flag (5 s timeout).
- Never crash on malformed input: bad JSONL lines are skipped and counted; a failing collector degrades to a stderr warning, never a crash.
- Dedup Claude Code usage by `message.id + ':' + requestId` — replayed sessions must not double-count.
- All tests that need files/repos use sacrificial temp dirs (`fs.mkdtemp` under `os.tmpdir()`), NEVER the real `~/.claude` or real repos.
- Home dir resolution: `process.env.VIBERULER_HOME ?? os.homedir()` (test seam).
- npm package name: `viberuler` (verified free on npm 2026-07-07). Version starts at `0.1.0`.
- Spec deviation (approved): cursor/gemini collectors are ROADMAP items, not in this plan. The `Collector` interface is the extension point; README (Plan 3) lists them as `good first issue`.
- Cost model: bundled static price table (USD per MTok). Unknown Claude models fall back to Sonnet-tier pricing; Codex tokens are costed at the bundled `codex-default` rate. Both facts get documented in METHODOLOGY.md (Plan 3).

---

### Task 1: Monorepo scaffold + CLI package tooling

**Files:**
- Create: `package.json` (repo root)
- Create: `.gitignore`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/tsup.config.ts`
- Create: `packages/cli/vitest.config.ts`
- Create: `packages/cli/test/sanity.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: workspace where `npm test -w viberuler` and `npm run build -w viberuler` work; all later tasks add files under `packages/cli/src` and `packages/cli/test`.

- [ ] **Step 1: Write root package.json**

```json
{
  "name": "viberuler-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "npm test -w viberuler",
    "build": "npm run build -w viberuler",
    "typecheck": "npm run typecheck -w viberuler"
  }
}
```

- [ ] **Step 2: Write .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 3: Write packages/cli/package.json**

```json
{
  "name": "viberuler",
  "version": "0.1.0",
  "description": "The benchmark for vibe coders. Scan your rig, get your Vibe Score.",
  "type": "module",
  "license": "MIT",
  "bin": { "viberuler": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=18.17" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "picocolors": "^1.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 4: Write packages/cli/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: Write packages/cli/tsup.config.ts**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  minify: false,
});
```

- [ ] **Step 6: Write packages/cli/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 7: Write the sanity test**

`packages/cli/test/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('package', () => {
  it('is named viberuler with a bin entry', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    );
    expect(pkg.name).toBe('viberuler');
    expect(pkg.bin.viberuler).toBe('./dist/cli.js');
  });
});
```

- [ ] **Step 8: Install and run the test**

Run (from repo root `C:\telo\Efforts\On\viberuler`): `npm install` then `npm test`
Expected: 1 test file, 1 passed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: monorepo scaffold + cli package tooling"
```

---

### Task 2: Core types + stats merging

**Files:**
- Create: `packages/cli/src/types.ts`
- Create: `packages/cli/src/merge.ts`
- Test: `packages/cli/test/merge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all later tasks import from `../src/types.js` / `../src/merge.js`):
  - `interface TokenUsage { input: number; output: number; cacheWrite: number; cacheRead: number }`
  - `interface RawStats { projects: number; commits: number; streakDays: number; lateNightCommits: number; historyRewrites: number; locTotal: number; locByLang: Record<string, number>; maxRepoLoc: number; tokens: TokenUsage; costUsd: number; ghStars: number; sources: string[]; warnings: string[] }`
  - `interface ScanContext { home: string; scanDirs: string[]; since?: Date; githubHandle?: string }`
  - `interface Collector { id: string; detect(ctx: ScanContext): Promise<boolean>; collect(ctx: ScanContext): Promise<Partial<RawStats>> }`
  - `function emptyStats(): RawStats`
  - `function totalTokens(u: TokenUsage): number`
  - `function mergeStats(base: RawStats, add: Partial<RawStats>): RawStats` (returns new object; numeric fields sum, `locByLang` sums per key, `streakDays`/`maxRepoLoc` take max, arrays concat)

- [ ] **Step 1: Write the failing test**

`packages/cli/test/merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { emptyStats, mergeStats, totalTokens } from '../src/merge.js';

describe('emptyStats', () => {
  it('starts at zero everywhere', () => {
    const s = emptyStats();
    expect(s.projects).toBe(0);
    expect(s.tokens).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(s.locByLang).toEqual({});
    expect(s.sources).toEqual([]);
  });
});

describe('totalTokens', () => {
  it('sums all four buckets', () => {
    expect(totalTokens({ input: 1, output: 2, cacheWrite: 3, cacheRead: 4 })).toBe(10);
  });
});

describe('mergeStats', () => {
  it('sums numerics, maxes streak/maxRepoLoc, merges maps, concats arrays', () => {
    const a = mergeStats(emptyStats(), {
      projects: 2, commits: 10, streakDays: 5, locTotal: 100,
      locByLang: { TypeScript: 100 }, maxRepoLoc: 100,
      tokens: { input: 10, output: 20, cacheWrite: 0, cacheRead: 0 },
      costUsd: 1.5, sources: ['git'],
    });
    const b = mergeStats(a, {
      projects: 1, commits: 5, streakDays: 3, locTotal: 50,
      locByLang: { TypeScript: 30, Rust: 20 }, maxRepoLoc: 50,
      tokens: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 },
      costUsd: 0.5, sources: ['claude-code'], warnings: ['w1'],
    });
    expect(b.projects).toBe(3);
    expect(b.commits).toBe(15);
    expect(b.streakDays).toBe(5);           // max, not sum
    expect(b.maxRepoLoc).toBe(100);          // max, not sum
    expect(b.locTotal).toBe(150);
    expect(b.locByLang).toEqual({ TypeScript: 130, Rust: 20 });
    expect(b.tokens).toEqual({ input: 11, output: 22, cacheWrite: 3, cacheRead: 4 });
    expect(b.costUsd).toBeCloseTo(2.0);
    expect(b.sources).toEqual(['git', 'claude-code']);
    expect(b.warnings).toEqual(['w1']);
  });

  it('does not mutate the base', () => {
    const base = emptyStats();
    mergeStats(base, { projects: 5 });
    expect(base.projects).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/merge.test.ts` (from `packages/cli`)
Expected: FAIL — cannot resolve `../src/merge.js`.

- [ ] **Step 3: Write types and merge**

`packages/cli/src/types.ts`:

```ts
export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface RawStats {
  projects: number;
  commits: number;
  streakDays: number;
  lateNightCommits: number;   // commits at 00:00-04:59 local
  historyRewrites: number;    // reflog rebase/reset entries
  locTotal: number;
  locByLang: Record<string, number>;
  maxRepoLoc: number;
  tokens: TokenUsage;
  costUsd: number;
  ghStars: number;
  sources: string[];
  warnings: string[];
}

export interface ScanContext {
  home: string;
  scanDirs: string[];
  since?: Date;
  githubHandle?: string;
}

export interface Collector {
  id: string;
  detect(ctx: ScanContext): Promise<boolean>;
  collect(ctx: ScanContext): Promise<Partial<RawStats>>;
}
```

`packages/cli/src/merge.ts`:

```ts
import type { RawStats, TokenUsage } from './types.js';

export function emptyStats(): RawStats {
  return {
    projects: 0, commits: 0, streakDays: 0, lateNightCommits: 0, historyRewrites: 0,
    locTotal: 0, locByLang: {}, maxRepoLoc: 0,
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    costUsd: 0, ghStars: 0, sources: [], warnings: [],
  };
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheWrite + u.cacheRead;
}

export function mergeStats(base: RawStats, add: Partial<RawStats>): RawStats {
  const locByLang = { ...base.locByLang };
  for (const [lang, n] of Object.entries(add.locByLang ?? {})) {
    locByLang[lang] = (locByLang[lang] ?? 0) + n;
  }
  const t = add.tokens;
  return {
    projects: base.projects + (add.projects ?? 0),
    commits: base.commits + (add.commits ?? 0),
    streakDays: Math.max(base.streakDays, add.streakDays ?? 0),
    lateNightCommits: base.lateNightCommits + (add.lateNightCommits ?? 0),
    historyRewrites: base.historyRewrites + (add.historyRewrites ?? 0),
    locTotal: base.locTotal + (add.locTotal ?? 0),
    locByLang,
    maxRepoLoc: Math.max(base.maxRepoLoc, add.maxRepoLoc ?? 0),
    tokens: {
      input: base.tokens.input + (t?.input ?? 0),
      output: base.tokens.output + (t?.output ?? 0),
      cacheWrite: base.tokens.cacheWrite + (t?.cacheWrite ?? 0),
      cacheRead: base.tokens.cacheRead + (t?.cacheRead ?? 0),
    },
    costUsd: base.costUsd + (add.costUsd ?? 0),
    ghStars: base.ghStars + (add.ghStars ?? 0),
    sources: [...base.sources, ...(add.sources ?? [])],
    warnings: [...base.warnings, ...(add.warnings ?? [])],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/merge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected clean.

```bash
git add packages/cli/src/types.ts packages/cli/src/merge.ts packages/cli/test/merge.test.ts
git commit -m "feat(cli): core RawStats/Collector types + mergeStats"
```

---

### Task 3: Price table + cost calculation

**Files:**
- Create: `packages/cli/src/pricing.ts`
- Test: `packages/cli/test/pricing.test.ts`

**Interfaces:**
- Consumes: `TokenUsage` from Task 2.
- Produces:
  - `interface ModelPrice { input: number; output: number; cacheWrite: number; cacheRead: number }` — USD per million tokens
  - `const PRICES: Record<string, ModelPrice>` — longest-prefix keys
  - `function priceFor(model: string): ModelPrice` — longest matching prefix; fallback = `claude-sonnet` tier
  - `function costForUsage(model: string, u: TokenUsage): number` — USD

- [ ] **Step 1: Write the failing test**

`packages/cli/test/pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { priceFor, costForUsage } from '../src/pricing.js';

describe('priceFor', () => {
  it('matches model ids by longest prefix', () => {
    expect(priceFor('claude-sonnet-4-6').input).toBe(3);
    expect(priceFor('claude-opus-4-8').output).toBe(75);
    expect(priceFor('claude-haiku-4-5-20251001').input).toBe(1);
  });
  it('falls back to sonnet tier for unknown models', () => {
    expect(priceFor('mystery-model-9000')).toEqual(priceFor('claude-sonnet-4-6'));
  });
});

describe('costForUsage', () => {
  it('computes USD across all four buckets', () => {
    // sonnet: in 3, out 15, cacheWrite 3.75, cacheRead 0.30 per MTok
    const cost = costForUsage('claude-sonnet-4-6', {
      input: 1_000_000, output: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 + 15 + 3.75 + 0.3, 5);
  });
  it('is zero for zero usage', () => {
    expect(costForUsage('claude-opus-4-8', { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pricing.test.ts`
Expected: FAIL — cannot resolve `../src/pricing.js`.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/pricing.ts`:

```ts
import type { TokenUsage } from './types.js';

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// USD per million tokens. Sources: public Anthropic/OpenAI pricing pages.
// Refresh each release; documented in METHODOLOGY.md.
export const PRICES: Record<string, ModelPrice> = {
  'claude-opus':   { input: 15,   output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet': { input: 3,    output: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
  'claude-haiku':  { input: 1,    output: 5,  cacheWrite: 1.25,  cacheRead: 0.1 },
  'claude-fable':  { input: 15,   output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'codex-default': { input: 1.25, output: 10, cacheWrite: 1.25,  cacheRead: 0.125 },
};

const FALLBACK = PRICES['claude-sonnet']!;

export function priceFor(model: string): ModelPrice {
  let best: ModelPrice | undefined;
  let bestLen = -1;
  for (const [prefix, price] of Object.entries(PRICES)) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = price;
      bestLen = prefix.length;
    }
  }
  return best ?? FALLBACK;
}

export function costForUsage(model: string, u: TokenUsage): number {
  const p = priceFor(model);
  return (
    (u.input * p.input + u.output * p.output + u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead) /
    1_000_000
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pricing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/pricing.ts packages/cli/test/pricing.test.ts
git commit -m "feat(cli): model price table + costForUsage"
```

---

### Task 4: Streak calculator (pure)

**Files:**
- Create: `packages/cli/src/streak.ts`
- Test: `packages/cli/test/streak.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function longestStreak(days: Iterable<string>): number` — input: `YYYY-MM-DD` strings (duplicates/unsorted OK), output: longest run of consecutive calendar days.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/streak.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { longestStreak } from '../src/streak.js';

describe('longestStreak', () => {
  it('returns 0 for no days', () => {
    expect(longestStreak([])).toBe(0);
  });
  it('returns 1 for a single day', () => {
    expect(longestStreak(['2026-01-15'])).toBe(1);
  });
  it('counts consecutive runs and ignores duplicates/order', () => {
    expect(longestStreak(['2026-01-03', '2026-01-01', '2026-01-02', '2026-01-02'])).toBe(3);
  });
  it('picks the longest of several runs', () => {
    expect(longestStreak(['2026-01-01', '2026-01-02', '2026-02-10', '2026-02-11', '2026-02-12'])).toBe(3);
  });
  it('handles month and year boundaries', () => {
    expect(longestStreak(['2025-12-31', '2026-01-01'])).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/streak.test.ts`
Expected: FAIL — cannot resolve `../src/streak.js`.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/streak.ts`:

```ts
const DAY_MS = 86_400_000;

export function longestStreak(days: Iterable<string>): number {
  const stamps = [...new Set(days)]
    .map((d) => Date.parse(d + 'T00:00:00Z'))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (stamps.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < stamps.length; i++) {
    const cur = stamps[i]!;
    const prev = stamps[i - 1]!;
    run = cur - prev === DAY_MS ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/streak.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/streak.ts packages/cli/test/streak.test.ts
git commit -m "feat(cli): longestStreak calculator"
```

---

### Task 5: Claude Code collector

**Files:**
- Create: `packages/cli/src/collectors/claude-code.ts`
- Create: `packages/cli/test/fixtures/claude/session-a.jsonl`
- Create: `packages/cli/test/fixtures/claude/session-b.jsonl`
- Test: `packages/cli/test/claude-code.test.ts`

**Interfaces:**
- Consumes: `TokenUsage`, `Collector`, `ScanContext` (Task 2); `costForUsage` (Task 3).
- Produces:
  - `function parseClaudeJsonl(content: string, seen: Set<string>, since?: Date): { tokens: TokenUsage; costUsd: number; skipped: number }` — pure, exported for tests
  - `const claudeCodeCollector: Collector` with `id: 'claude-code'`; scans `<home>/.claude/projects/**/*.jsonl`; contributes `{ tokens, costUsd, sources: ['claude-code'], warnings? }`

**JSONL record shape (verified against a real install 2026-07-07):** relevant lines have `type: "assistant"`, top-level `requestId`, and `message: { id, model, usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } }`, plus top-level ISO `timestamp`. Dedup key: `message.id + ':' + requestId`.

- [ ] **Step 1: Write fixtures**

`packages/cli/test/fixtures/claude/session-a.jsonl` (5 lines: user line to skip, valid assistant, corrupt JSON, duplicate of line 2, assistant missing usage):

```
{"type":"user","timestamp":"2026-06-01T10:00:00.000Z","message":{"role":"user","content":"hi"}}
{"type":"assistant","timestamp":"2026-06-01T10:00:05.000Z","requestId":"req_A1","message":{"id":"msg_A1","model":"claude-sonnet-4-6","usage":{"input_tokens":100,"output_tokens":200,"cache_creation_input_tokens":1000,"cache_read_input_tokens":5000}}}
{this line is corrupt json
{"type":"assistant","timestamp":"2026-06-01T10:00:05.000Z","requestId":"req_A1","message":{"id":"msg_A1","model":"claude-sonnet-4-6","usage":{"input_tokens":100,"output_tokens":200,"cache_creation_input_tokens":1000,"cache_read_input_tokens":5000}}}
{"type":"assistant","timestamp":"2026-06-01T10:01:00.000Z","requestId":"req_A2","message":{"id":"msg_A2","model":"claude-sonnet-4-6"}}
```

`packages/cli/test/fixtures/claude/session-b.jsonl` (1 old line for `--since` filtering, 1 recent):

```
{"type":"assistant","timestamp":"2025-01-01T00:00:00.000Z","requestId":"req_B1","message":{"id":"msg_B1","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}
{"type":"assistant","timestamp":"2026-06-02T00:00:00.000Z","requestId":"req_B2","message":{"id":"msg_B2","model":"claude-opus-4-8","usage":{"input_tokens":1000,"output_tokens":2000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}
```

- [ ] **Step 2: Write the failing test**

`packages/cli/test/claude-code.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaudeJsonl, claudeCodeCollector } from '../src/collectors/claude-code.js';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/claude/${name}`, import.meta.url));

describe('parseClaudeJsonl', () => {
  it('sums usage, dedups by message.id+requestId, counts corrupt lines', () => {
    const seen = new Set<string>();
    const r = parseClaudeJsonl(readFileSync(fixture('session-a.jsonl'), 'utf8'), seen);
    // duplicate line must count once; corrupt line -> skipped; missing-usage line ignored silently
    expect(r.tokens).toEqual({ input: 100, output: 200, cacheWrite: 1000, cacheRead: 5000 });
    // sonnet: (100*3 + 200*15 + 1000*3.75 + 5000*0.3)/1e6
    expect(r.costUsd).toBeCloseTo((100 * 3 + 200 * 15 + 1000 * 3.75 + 5000 * 0.3) / 1e6, 10);
    expect(r.skipped).toBe(1);
  });

  it('dedups across files via the shared seen set', () => {
    const seen = new Set<string>();
    const content = readFileSync(fixture('session-a.jsonl'), 'utf8');
    const first = parseClaudeJsonl(content, seen);
    const second = parseClaudeJsonl(content, seen);
    expect(first.tokens.input).toBe(100);
    expect(second.tokens.input).toBe(0);
  });

  it('filters records older than since', () => {
    const r = parseClaudeJsonl(
      readFileSync(fixture('session-b.jsonl'), 'utf8'),
      new Set(),
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(r.tokens).toEqual({ input: 1000, output: 2000, cacheWrite: 0, cacheRead: 0 });
  });
});

describe('claudeCodeCollector', () => {
  it('detects and aggregates a fake ~/.claude/projects tree', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-home-'));
    const proj = join(home, '.claude', 'projects', 'C--fake');
    await mkdir(proj, { recursive: true });
    await copyFile(fixture('session-a.jsonl'), join(proj, 'a.jsonl'));
    await copyFile(fixture('session-b.jsonl'), join(proj, 'b.jsonl'));

    const ctx = { home, scanDirs: [] as string[] };
    expect(await claudeCodeCollector.detect(ctx)).toBe(true);
    const r = await claudeCodeCollector.collect(ctx);
    expect(r.tokens!.input).toBe(100 + 10 + 1000);
    expect(r.sources).toEqual(['claude-code']);
  });

  it('does not detect when ~/.claude/projects is absent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-empty-'));
    expect(await claudeCodeCollector.detect({ home, scanDirs: [] })).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/claude-code.test.ts`
Expected: FAIL — cannot resolve `../src/collectors/claude-code.js`.

- [ ] **Step 4: Write the implementation**

`packages/cli/src/collectors/claude-code.ts`:

```ts
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

export function parseClaudeJsonl(
  content: string,
  seen: Set<string>,
  since?: Date,
): { tokens: TokenUsage; costUsd: number; skipped: number } {
  const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  let skipped = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      skipped++;
      continue;
    }
    const usage = obj?.message?.usage;
    if (obj?.type !== 'assistant' || !usage) continue;
    if (since && obj.timestamp && Date.parse(obj.timestamp) < since.getTime()) continue;

    const key = `${obj.message.id ?? 'nomsg'}:${obj.requestId ?? 'noreq'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const u: TokenUsage = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
    };
    tokens.input += u.input;
    tokens.output += u.output;
    tokens.cacheWrite += u.cacheWrite;
    tokens.cacheRead += u.cacheRead;
    costUsd += costForUsage(obj.message.model ?? '', u);
  }
  return { tokens, costUsd, skipped };
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

function projectsDir(ctx: ScanContext): string {
  return join(ctx.home, '.claude', 'projects');
}

export const claudeCodeCollector: Collector = {
  id: 'claude-code',
  async detect(ctx) {
    try {
      return (await stat(projectsDir(ctx))).isDirectory();
    } catch {
      return false;
    }
  },
  async collect(ctx) {
    const seen = new Set<string>();
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let skipped = 0;

    for await (const file of walkJsonl(projectsDir(ctx))) {
      try {
        const r = parseClaudeJsonl(await readFile(file, 'utf8'), seen, ctx.since);
        tokens.input += r.tokens.input;
        tokens.output += r.tokens.output;
        tokens.cacheWrite += r.tokens.cacheWrite;
        tokens.cacheRead += r.tokens.cacheRead;
        costUsd += r.costUsd;
        skipped += r.skipped;
      } catch {
        skipped++;
      }
    }
    const warnings = skipped > 0 ? [`claude-code: skipped ${skipped} malformed line(s)`] : [];
    return { tokens, costUsd, sources: ['claude-code'], warnings };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/claude-code.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/collectors/claude-code.ts packages/cli/test/fixtures/claude packages/cli/test/claude-code.test.ts
git commit -m "feat(cli): claude-code collector with dedup and cost"
```

---

### Task 6: Git collector

**Files:**
- Create: `packages/cli/src/collectors/git.ts`
- Test: `packages/cli/test/git.test.ts`

**Interfaces:**
- Consumes: `Collector`, `ScanContext` (Task 2); `longestStreak` (Task 4).
- Produces:
  - `function classifyExt(filePath: string): string | null` — pure; maps extension → language name, `null` = not code (excluded from LoC)
  - `function parseGitLog(out: string): { dates: string[]; lateNight: number }` — pure; parses `git log --date=format:'%Y-%m-%d %H'` output lines
  - `const gitCollector: Collector` with `id: 'git'`; contributes `{ projects, commits, streakDays, lateNightCommits, historyRewrites, locTotal, locByLang, maxRepoLoc, sources: ['git'], warnings? }`

**Behavior:** find repos by walking each `ctx.scanDirs` root (max depth 5, skip `node_modules`, `.venv`, `dist`, `target`, dotted dirs except `.` roots; a dir containing `.git` is a repo — do not descend into it further). Author email = `git config --get user.email` (run once, global). Repos with zero authored commits are skipped entirely. LoC counts lines of `git ls-files` files that classify to a language, skipping files >1 MB. `since` applies to `git log --since`, not to LoC (LoC is a state metric).

- [ ] **Step 1: Write the failing test**

`packages/cli/test/git.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyExt, parseGitLog, gitCollector } from '../src/collectors/git.js';

describe('classifyExt', () => {
  it('maps known code extensions', () => {
    expect(classifyExt('src/app.ts')).toBe('TypeScript');
    expect(classifyExt('main.rs')).toBe('Rust');
    expect(classifyExt('script.py')).toBe('Python');
  });
  it('returns null for non-code files', () => {
    expect(classifyExt('photo.png')).toBeNull();
    expect(classifyExt('README.md')).toBeNull();
  });
});

describe('parseGitLog', () => {
  it('extracts dates and counts late-night commits (00-04h)', () => {
    const out = ['2026-06-01 14', '2026-06-01 03', '2026-06-02 23', ''].join('\n');
    const r = parseGitLog(out);
    expect(r.dates).toEqual(['2026-06-01', '2026-06-01', '2026-06-02']);
    expect(r.lateNight).toBe(1);
  });
});

describe('gitCollector (integration, sacrificial temp repo)', () => {
  let scanRoot: string;

  beforeAll(async () => {
    scanRoot = await mkdtemp(join(tmpdir(), 'vibe-git-'));
    const repo = join(scanRoot, 'myproject');
    await mkdir(repo, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args]);
    git('init');
    git('config', 'user.email', 'vibe@test.local');
    git('config', 'user.name', 'Vibe Tester');
    await writeFile(join(repo, 'index.ts'), 'const a = 1;\nconst b = 2;\nexport { a, b };\n');
    await writeFile(join(repo, 'notes.txt'), 'not code\n');
    git('add', '-A');
    git('commit', '-m', 'init', '--date', '2026-06-01T12:00:00');
  });

  it('finds the repo and counts LoC/commits for the repo author', async () => {
    const r = await gitCollector.collect({
      home: scanRoot,
      scanDirs: [scanRoot],
      // authorEmail override for tests — real runs read git config
      authorEmail: 'vibe@test.local',
    } as any);
    expect(r.projects).toBe(1);
    expect(r.commits).toBe(1);
    expect(r.streakDays).toBe(1);
    expect(r.locByLang).toEqual({ TypeScript: 3 });
    expect(r.locTotal).toBe(3);
    expect(r.maxRepoLoc).toBe(3);
    expect(r.sources).toEqual(['git']);
  });

  it('reports zero projects when author has no commits anywhere', async () => {
    const r = await gitCollector.collect({
      home: scanRoot,
      scanDirs: [scanRoot],
      authorEmail: 'stranger@nowhere.local',
    } as any);
    expect(r.projects).toBe(0);
    expect(r.locTotal).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git.test.ts`
Expected: FAIL — cannot resolve `../src/collectors/git.js`.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/collectors/git.ts`:

```ts
import { readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, extname, join } from 'node:path';
import type { Collector, ScanContext } from '../types.js';
import { longestStreak } from '../streak.js';

const exec = promisify(execFile);
const MAX_DEPTH = 5;
const MAX_FILE_BYTES = 1_000_000;
const SKIP_DIRS = new Set(['node_modules', '.venv', 'venv', 'dist', 'build', 'target', 'out', 'vendor']);

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.rb': 'Ruby',
  '.cs': 'C#', '.cpp': 'C++', '.cc': 'C++', '.h': 'C/C++', '.hpp': 'C++', '.c': 'C',
  '.swift': 'Swift', '.kt': 'Kotlin', '.php': 'PHP', '.sh': 'Shell', '.ps1': 'PowerShell',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'CSS', '.sql': 'SQL', '.vue': 'Vue', '.svelte': 'Svelte',
};

export function classifyExt(filePath: string): string | null {
  return LANG_BY_EXT[extname(filePath).toLowerCase()] ?? null;
}

export function parseGitLog(out: string): { dates: string[]; lateNight: number } {
  const dates: string[] = [];
  let lateNight = 0;
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2})$/);
    if (!m) continue;
    dates.push(m[1]!);
    if (Number(m[2]) < 5) lateNight++;
  }
  return { dates, lateNight };
}

async function findRepos(root: string, depth = 0, acc: string[] = []): Promise<string[]> {
  if (depth > MAX_DEPTH) return acc;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  if (entries.some((e) => e.name === '.git' && e.isDirectory())) {
    acc.push(root);
    return acc; // repo found — do not descend further
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    await findRepos(join(root, e.name), depth + 1, acc);
  }
  return acc;
}

async function authorEmail(ctx: ScanContext): Promise<string | null> {
  const override = (ctx as { authorEmail?: string }).authorEmail;
  if (override) return override;
  try {
    const { stdout } = await exec('git', ['config', '--get', 'user.email']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function countRepoLoc(repo: string): Promise<Record<string, number>> {
  const byLang: Record<string, number> = {};
  const { stdout } = await exec('git', ['-C', repo, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 });
  for (const rel of stdout.split('\0')) {
    if (!rel) continue;
    const lang = classifyExt(rel);
    if (!lang) continue;
    const abs = join(repo, rel);
    try {
      if ((await stat(abs)).size > MAX_FILE_BYTES) continue;
      const text = await readFile(abs, 'utf8');
      let lines = 0;
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
      if (text.length > 0 && !text.endsWith('\n')) lines++;
      byLang[lang] = (byLang[lang] ?? 0) + lines;
    } catch {
      /* unreadable file — skip */
    }
  }
  return byLang;
}

export const gitCollector: Collector = {
  id: 'git',
  async detect() {
    try {
      await exec('git', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
  async collect(ctx) {
    const email = await authorEmail(ctx);
    if (!email) return { sources: ['git'], warnings: ['git: no user.email configured — skipping repo scan'] };

    const repos: string[] = [];
    for (const root of ctx.scanDirs) await findRepos(root, 0, repos);

    let projects = 0, commits = 0, lateNightCommits = 0, historyRewrites = 0;
    let locTotal = 0, maxRepoLoc = 0;
    const locByLang: Record<string, number> = {};
    const allDates: string[] = [];
    const warnings: string[] = [];

    for (const repo of repos) {
      try {
        const logArgs = ['-C', repo, 'log', `--author=${email}`, '--date=format:%Y-%m-%d %H', '--pretty=format:%ad'];
        if (ctx.since) logArgs.push(`--since=${ctx.since.toISOString()}`);
        const { stdout } = await exec('git', logArgs, { maxBuffer: 64 * 1024 * 1024 });
        const { dates, lateNight } = parseGitLog(stdout);
        if (dates.length === 0) continue; // not our repo

        projects++;
        commits += dates.length;
        lateNightCommits += lateNight;
        allDates.push(...dates);

        try {
          const { stdout: reflog } = await exec('git', ['-C', repo, 'reflog', '--format=%gs'], { maxBuffer: 16 * 1024 * 1024 });
          historyRewrites += reflog.split('\n').filter((l) => /^(rebase|reset: moving)/.test(l)).length;
        } catch { /* fresh clone without reflog — fine */ }

        const byLang = await countRepoLoc(repo);
        let repoLoc = 0;
        for (const [lang, n] of Object.entries(byLang)) {
          locByLang[lang] = (locByLang[lang] ?? 0) + n;
          repoLoc += n;
        }
        locTotal += repoLoc;
        if (repoLoc > maxRepoLoc) maxRepoLoc = repoLoc;
      } catch {
        warnings.push(`git: failed to scan ${basename(repo)}`);
      }
    }

    return {
      projects, commits, streakDays: longestStreak(allDates), lateNightCommits, historyRewrites,
      locTotal, locByLang, maxRepoLoc, sources: ['git'], warnings,
    };
  },
};
```

Note: `authorEmail` override is typed via a cast in tests; keep the production `ScanContext` clean. If the cast feels dirty during implementation, add `authorEmail?: string` to `ScanContext` instead and drop the `as any` from the test — both acceptable.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git.test.ts`
Expected: PASS (5 tests). (Requires `git` on PATH — true on CI matrix and dev machines.)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/collectors/git.ts packages/cli/test/git.test.ts
git commit -m "feat(cli): git collector — repos, commits, streak, LoC by language"
```

---

### Task 7: Codex collector

**Files:**
- Create: `packages/cli/src/collectors/codex.ts`
- Create: `packages/cli/test/fixtures/codex/rollout-a.jsonl`
- Test: `packages/cli/test/codex.test.ts`

**Interfaces:**
- Consumes: `Collector`, `ScanContext`, `TokenUsage` (Task 2); `costForUsage` (Task 3).
- Produces:
  - `function parseCodexJsonl(content: string): TokenUsage | null` — pure; returns the LAST cumulative `token_count` record in the file (Codex logs cumulative totals), or `null` if none
  - `const codexCollector: Collector` with `id: 'codex'`; scans `<home>/.codex/sessions/**/*.jsonl`; costs tokens at the `codex-default` price entry

**Codex record shape (best-effort):** lines like `{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":N,"cached_input_tokens":N,"output_tokens":N}}}}`. Cumulative per session → take the last one per file. `cached_input_tokens` maps to `cacheRead`; Codex has no cacheWrite concept → 0.

- [ ] **Step 1: Write fixture**

`packages/cli/test/fixtures/codex/rollout-a.jsonl`:

```
{"type":"event_msg","payload":{"type":"agent_message","message":"hi"}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":30}}}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":400,"cached_input_tokens":200,"output_tokens":90}}}}
```

- [ ] **Step 2: Write the failing test**

`packages/cli/test/codex.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCodexJsonl, codexCollector } from '../src/collectors/codex.js';

const fixture = fileURLToPath(new URL('./fixtures/codex/rollout-a.jsonl', import.meta.url));

describe('parseCodexJsonl', () => {
  it('returns the LAST cumulative token_count (not the sum)', () => {
    const u = parseCodexJsonl(readFileSync(fixture, 'utf8'));
    expect(u).toEqual({ input: 400, output: 90, cacheWrite: 0, cacheRead: 200 });
  });
  it('returns null when no token_count lines exist', () => {
    expect(parseCodexJsonl('{"type":"event_msg","payload":{"type":"agent_message"}}\n')).toBeNull();
  });
});

describe('codexCollector', () => {
  it('aggregates sessions and prices at codex-default', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-codex-'));
    const sessions = join(home, '.codex', 'sessions', '2026', '06');
    await mkdir(sessions, { recursive: true });
    await copyFile(fixture, join(sessions, 'rollout-a.jsonl'));

    const ctx = { home, scanDirs: [] as string[] };
    expect(await codexCollector.detect(ctx)).toBe(true);
    const r = await codexCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 400, output: 90, cacheWrite: 0, cacheRead: 200 });
    // codex-default: in 1.25, out 10, cacheRead 0.125 per MTok
    expect(r.costUsd).toBeCloseTo((400 * 1.25 + 90 * 10 + 200 * 0.125) / 1e6, 10);
    expect(r.sources).toEqual(['codex']);
  });

  it('does not detect without ~/.codex/sessions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nocodex-'));
    expect(await codexCollector.detect({ home, scanDirs: [] })).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/codex.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 4: Write the implementation**

`packages/cli/src/collectors/codex.ts`:

```ts
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

export function parseCodexJsonl(content: string): TokenUsage | null {
  let last: TokenUsage | null = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      const total = obj?.payload?.info?.total_token_usage;
      if (obj?.payload?.type === 'token_count' && total) {
        last = {
          input: total.input_tokens ?? 0,
          output: total.output_tokens ?? 0,
          cacheWrite: 0,
          cacheRead: total.cached_input_tokens ?? 0,
        };
      }
    } catch {
      /* malformed line — skip */
    }
  }
  return last;
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

function sessionsDir(ctx: ScanContext): string {
  return join(ctx.home, '.codex', 'sessions');
}

export const codexCollector: Collector = {
  id: 'codex',
  async detect(ctx) {
    try {
      return (await stat(sessionsDir(ctx))).isDirectory();
    } catch {
      return false;
    }
  },
  async collect(ctx) {
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    for await (const file of walkJsonl(sessionsDir(ctx))) {
      try {
        const u = parseCodexJsonl(await readFile(file, 'utf8'));
        if (!u) continue;
        tokens.input += u.input;
        tokens.output += u.output;
        tokens.cacheRead += u.cacheRead;
      } catch {
        /* unreadable file — skip */
      }
    }
    return { tokens, costUsd: costForUsage('codex-default', tokens), sources: ['codex'] };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/codex.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/collectors/codex.ts packages/cli/test/fixtures/codex packages/cli/test/codex.test.ts
git commit -m "feat(cli): codex collector (cumulative token_count, best-effort)"
```

---

### Task 8: GitHub collector (optional, network)

**Files:**
- Create: `packages/cli/src/collectors/github.ts`
- Test: `packages/cli/test/github.test.ts`

**Interfaces:**
- Consumes: `Collector`, `ScanContext` (Task 2).
- Produces: `const githubCollector: Collector & { fetchImpl?: typeof fetch }` with `id: 'github'`. `detect` returns true ONLY when `ctx.githubHandle` is set (the network never activates by default). Contributes `{ ghStars, sources: ['github'], warnings? }`. 5-second timeout via `AbortSignal.timeout(5000)`. `fetchImpl` property exists as a test seam (defaults to global `fetch`).

- [ ] **Step 1: Write the failing test**

`packages/cli/test/github.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { githubCollector } from '../src/collectors/github.js';

afterEach(() => {
  githubCollector.fetchImpl = undefined;
});

describe('githubCollector', () => {
  it('does not detect without a handle (privacy default)', async () => {
    expect(await githubCollector.detect({ home: '/x', scanDirs: [] })).toBe(false);
  });

  it('detects with a handle and sums stars from the repos API', async () => {
    githubCollector.fetchImpl = (async (url: any) => {
      expect(String(url)).toContain('/users/master5d/repos');
      return new Response(
        JSON.stringify([{ stargazers_count: 10 }, { stargazers_count: 32 }]),
        { status: 200 },
      );
    }) as typeof fetch;

    const ctx = { home: '/x', scanDirs: [], githubHandle: 'master5d' };
    expect(await githubCollector.detect(ctx)).toBe(true);
    const r = await githubCollector.collect(ctx);
    expect(r.ghStars).toBe(42);
    expect(r.sources).toEqual(['github']);
  });

  it('degrades to a warning on HTTP failure', async () => {
    githubCollector.fetchImpl = (async () => new Response('nope', { status: 403 })) as typeof fetch;
    const r = await githubCollector.collect({ home: '/x', scanDirs: [], githubHandle: 'master5d' });
    expect(r.ghStars).toBeUndefined();
    expect(r.warnings?.[0]).toContain('github');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/github.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/collectors/github.ts`:

```ts
import type { Collector, ScanContext } from '../types.js';

interface GithubCollector extends Collector {
  fetchImpl?: typeof fetch;
}

export const githubCollector: GithubCollector = {
  id: 'github',
  fetchImpl: undefined,

  async detect(ctx: ScanContext) {
    return Boolean(ctx.githubHandle);
  },

  async collect(ctx: ScanContext) {
    const doFetch = this.fetchImpl ?? fetch;
    try {
      const res = await doFetch(
        `https://api.github.com/users/${encodeURIComponent(ctx.githubHandle!)}/repos?per_page=100&type=owner`,
        {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'viberuler' },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) return { sources: ['github'], warnings: [`github: API returned ${res.status}`] };
      const repos = (await res.json()) as Array<{ stargazers_count?: number }>;
      const ghStars = repos.reduce((sum, r) => sum + (r.stargazers_count ?? 0), 0);
      return { ghStars, sources: ['github'] };
    } catch {
      return { sources: ['github'], warnings: ['github: request failed or timed out'] };
    }
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/github.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/collectors/github.ts packages/cli/test/github.test.ts
git commit -m "feat(cli): optional github collector behind --github flag"
```

---

### Task 9: Achievements

**Files:**
- Create: `packages/cli/src/achievements.ts`
- Test: `packages/cli/test/achievements.test.ts`

**Interfaces:**
- Consumes: `RawStats`, `emptyStats`, `totalTokens` (Task 2).
- Produces:
  - `interface Achievement { id: string; title: string; emoji: string; test(s: RawStats): boolean }`
  - `const ACHIEVEMENTS: Achievement[]`
  - `function evalAchievements(s: RawStats): Achievement[]` — earned ones, in ACHIEVEMENTS order

**Roster (exact predicates):**

| id | title | emoji | predicate |
|---|---|---|---|
| `token-billionaire` | Token Billionaire | 💰 | `totalTokens(s.tokens) >= 1e9` |
| `free-tier-martyr` | Free Tier Martyr | 🪦 | `s.costUsd < 1 && totalTokens(s.tokens) >= 1e6` |
| `cache-whisperer` | Cache Whisperer | 🗄️ | `totalTokens > 0 && s.tokens.cacheRead / totalTokens > 0.9` |
| `polyglot` | Polyglot | 🌐 | `Object.keys(s.locByLang).length >= 5` |
| `monorepo-menace` | Monorepo Menace | 🐘 | `s.maxRepoLoc > 100_000` |
| `streak-freak` | Streak Freak | 🔥 | `s.streakDays >= 100` |
| `3am-committer` | 3AM Committer | 🌙 | `s.lateNightCommits >= 10` |
| `yolo-force-pusher` | YOLO Force Pusher | 💥 | `s.historyRewrites >= 20` |

- [ ] **Step 1: Write the failing test**

`packages/cli/test/achievements.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evalAchievements } from '../src/achievements.js';
import { emptyStats } from '../src/merge.js';

const withStats = (over: object) => ({ ...emptyStats(), ...over });

describe('evalAchievements', () => {
  it('earns nothing on empty stats', () => {
    expect(evalAchievements(emptyStats())).toEqual([]);
  });

  it('token-billionaire at 1e9 total tokens', () => {
    const s = withStats({ tokens: { input: 1e9, output: 0, cacheWrite: 0, cacheRead: 0 } });
    expect(evalAchievements(s).map((a) => a.id)).toContain('token-billionaire');
  });

  it('free-tier-martyr needs >=1M tokens AND <$1', () => {
    const yes = withStats({ costUsd: 0.5, tokens: { input: 2e6, output: 0, cacheWrite: 0, cacheRead: 0 } });
    const noTokens = withStats({ costUsd: 0.5, tokens: { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 } });
    expect(evalAchievements(yes).map((a) => a.id)).toContain('free-tier-martyr');
    expect(evalAchievements(noTokens).map((a) => a.id)).not.toContain('free-tier-martyr');
  });

  it('cache-whisperer above 90% cache-read ratio', () => {
    const s = withStats({ tokens: { input: 5, output: 4, cacheWrite: 0, cacheRead: 91 } });
    expect(evalAchievements(s).map((a) => a.id)).toContain('cache-whisperer');
  });

  it('polyglot, monorepo-menace, streak-freak, 3am, yolo', () => {
    const s = withStats({
      locByLang: { a: 1, b: 1, c: 1, d: 1, e: 1 },
      maxRepoLoc: 100_001,
      streakDays: 100,
      lateNightCommits: 10,
      historyRewrites: 20,
    });
    const ids = evalAchievements(s).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      'polyglot', 'monorepo-menace', 'streak-freak', '3am-committer', 'yolo-force-pusher',
    ]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/achievements.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/achievements.ts`:

```ts
import type { RawStats } from './types.js';
import { totalTokens } from './merge.js';

export interface Achievement {
  id: string;
  title: string;
  emoji: string;
  test(s: RawStats): boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'token-billionaire', title: 'Token Billionaire', emoji: '💰', test: (s) => totalTokens(s.tokens) >= 1e9 },
  { id: 'free-tier-martyr', title: 'Free Tier Martyr', emoji: '🪦', test: (s) => s.costUsd < 1 && totalTokens(s.tokens) >= 1e6 },
  { id: 'cache-whisperer', title: 'Cache Whisperer', emoji: '🗄️', test: (s) => { const t = totalTokens(s.tokens); return t > 0 && s.tokens.cacheRead / t > 0.9; } },
  { id: 'polyglot', title: 'Polyglot', emoji: '🌐', test: (s) => Object.keys(s.locByLang).length >= 5 },
  { id: 'monorepo-menace', title: 'Monorepo Menace', emoji: '🐘', test: (s) => s.maxRepoLoc > 100_000 },
  { id: 'streak-freak', title: 'Streak Freak', emoji: '🔥', test: (s) => s.streakDays >= 100 },
  { id: '3am-committer', title: '3AM Committer', emoji: '🌙', test: (s) => s.lateNightCommits >= 10 },
  { id: 'yolo-force-pusher', title: 'YOLO Force Pusher', emoji: '💥', test: (s) => s.historyRewrites >= 20 },
];

export function evalAchievements(s: RawStats): Achievement[] {
  return ACHIEVEMENTS.filter((a) => a.test(s));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/achievements.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/achievements.ts packages/cli/test/achievements.test.ts
git commit -m "feat(cli): achievement roster + evaluator"
```

---

### Task 10: Score engine

**Files:**
- Create: `packages/cli/src/score.ts`
- Test: `packages/cli/test/score.test.ts`

**Interfaces:**
- Consumes: `RawStats`, `totalTokens` (Task 2); `Achievement`, `evalAchievements` (Task 9).
- Produces:
  - `interface ScoreBreakdown { volume: number; leverage: number; efficiency: number; breadth: number; streak: number; achievements: number }`
  - `interface ScoreReport { vibe: number; rank: string; breakdown: ScoreBreakdown; tokPerUsd: number | null; effPercentile: number; achievements: Achievement[]; stats: RawStats }`
  - `function offlinePercentile(tokPerUsd: number): number` — piecewise-linear over log10, clamped to [0.05, 0.99]
  - `function rankFor(vibe: number, hasData: boolean): string`
  - `function computeScore(stats: RawStats, effPercentile?: number): ScoreReport` — optional override percentile (Plan 2 wires the live API value here; offline curve is the fallback)

**Formula (spec-exact):**

```
volume       = 1000 · log10(1 + locTotal/1000)
leverage     =  500 · log10(1 + totalTokens/1e6)
efficiency   =  800 · effPercentile           (0 when costUsd == 0)
breadth      =  300 · log10(1 + projects·10)
streak       =  min(streakDays, 365)
achievements =  50 · earnedCount
vibe         =  round(sum)
```

**Rank table:** `>=8000` Singularity Adjacent · `>=6500` GIGACHAD SHIPPER · `>=5000` Ship Machine · `>=3500` Context Goblin · `>=2000` Token Burner · `>=800` Vibe Apprentice · else Prompt Peasant. `hasData === false` → `NPC (no vibes detected)`. `hasData = stats.sources.length > 0 && (totalTokens > 0 || stats.commits > 0)`.

**Offline curve anchors** (log10 tok/$ → percentile): `[[4,0.05],[5,0.2],[6,0.5],[6.7,0.8],[7.3,0.95],[8,0.99]]`.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/score.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeScore, offlinePercentile, rankFor } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

describe('offlinePercentile', () => {
  it('clamps below and above the curve', () => {
    expect(offlinePercentile(1)).toBeCloseTo(0.05);
    expect(offlinePercentile(1e12)).toBeCloseTo(0.99);
  });
  it('hits anchor points exactly', () => {
    expect(offlinePercentile(1e6)).toBeCloseTo(0.5);
  });
  it('interpolates between anchors', () => {
    const mid = offlinePercentile(10 ** 5.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.5);
  });
  it('returns 0 for non-positive input', () => {
    expect(offlinePercentile(0)).toBe(0);
  });
});

describe('rankFor', () => {
  it('maps thresholds', () => {
    expect(rankFor(0, false)).toBe('NPC (no vibes detected)');
    expect(rankFor(100, true)).toBe('Prompt Peasant');
    expect(rankFor(800, true)).toBe('Vibe Apprentice');
    expect(rankFor(2000, true)).toBe('Token Burner');
    expect(rankFor(3500, true)).toBe('Context Goblin');
    expect(rankFor(5000, true)).toBe('Ship Machine');
    expect(rankFor(6500, true)).toBe('GIGACHAD SHIPPER');
    expect(rankFor(8000, true)).toBe('Singularity Adjacent');
  });
});

describe('computeScore', () => {
  it('zero stats -> NPC with vibe 0', () => {
    const r = computeScore(emptyStats());
    expect(r.vibe).toBe(0);
    expect(r.rank).toBe('NPC (no vibes detected)');
    expect(r.tokPerUsd).toBeNull();
  });

  it('computes each component per the published formula', () => {
    const stats = {
      ...emptyStats(),
      locTotal: 9_000,                 // volume = 1000*log10(10) = 1000
      projects: 0,
      commits: 1,
      sources: ['git'],
      tokens: { input: 999_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, // leverage = 500*log10(1000) = 1500
      costUsd: 999,                    // tok/$ ≈ 1e6 -> percentile ~0.5 -> efficiency ~400
    };
    const r = computeScore(stats);
    expect(r.breakdown.volume).toBeCloseTo(1000, 0);
    expect(r.breakdown.leverage).toBeCloseTo(1500, 0);
    expect(r.breakdown.efficiency).toBeCloseTo(400, 0);
    expect(r.breakdown.breadth).toBe(0);
    expect(r.vibe).toBe(Math.round(
      r.breakdown.volume + r.breakdown.leverage + r.breakdown.efficiency +
      r.breakdown.breadth + r.breakdown.streak + r.breakdown.achievements,
    ));
  });

  it('caps streak bonus at 365 and honors percentile override', () => {
    const stats = { ...emptyStats(), streakDays: 500, commits: 1, sources: ['git'], costUsd: 1,
      tokens: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 } };
    const r = computeScore(stats, 1.0);
    expect(r.breakdown.streak).toBe(365);
    expect(r.breakdown.efficiency).toBeCloseTo(800);
    expect(r.effPercentile).toBe(1.0);
  });

  it('efficiency is 0 when cost is 0 (no division by zero)', () => {
    const stats = { ...emptyStats(), commits: 1, sources: ['git'],
      tokens: { input: 1e6, output: 0, cacheWrite: 0, cacheRead: 0 } };
    const r = computeScore(stats);
    expect(r.breakdown.efficiency).toBe(0);
    expect(r.tokPerUsd).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/score.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/score.ts`:

```ts
import type { RawStats } from './types.js';
import { totalTokens } from './merge.js';
import { evalAchievements, type Achievement } from './achievements.js';

export interface ScoreBreakdown {
  volume: number;
  leverage: number;
  efficiency: number;
  breadth: number;
  streak: number;
  achievements: number;
}

export interface ScoreReport {
  vibe: number;
  rank: string;
  breakdown: ScoreBreakdown;
  tokPerUsd: number | null;
  effPercentile: number;
  achievements: Achievement[];
  stats: RawStats;
}

const CURVE: Array<[number, number]> = [
  [4, 0.05], [5, 0.2], [6, 0.5], [6.7, 0.8], [7.3, 0.95], [8, 0.99],
];

export function offlinePercentile(tokPerUsd: number): number {
  if (tokPerUsd <= 0) return 0;
  const x = Math.log10(tokPerUsd);
  const first = CURVE[0]!;
  const last = CURVE[CURVE.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i - 1]!;
    const [x2, y2] = CURVE[i]!;
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return last[1];
}

const RANK_TABLE: Array<[number, string]> = [
  [8000, 'Singularity Adjacent'],
  [6500, 'GIGACHAD SHIPPER'],
  [5000, 'Ship Machine'],
  [3500, 'Context Goblin'],
  [2000, 'Token Burner'],
  [800, 'Vibe Apprentice'],
];

export function rankFor(vibe: number, hasData: boolean): string {
  if (!hasData) return 'NPC (no vibes detected)';
  for (const [min, name] of RANK_TABLE) if (vibe >= min) return name;
  return 'Prompt Peasant';
}

export function computeScore(stats: RawStats, effPercentile?: number): ScoreReport {
  const tokens = totalTokens(stats.tokens);
  const tokPerUsd = stats.costUsd > 0 ? tokens / stats.costUsd : null;
  const pct = effPercentile ?? (tokPerUsd !== null ? offlinePercentile(tokPerUsd) : 0);
  const earned = evalAchievements(stats);

  const breakdown: ScoreBreakdown = {
    volume: 1000 * Math.log10(1 + stats.locTotal / 1000),
    leverage: 500 * Math.log10(1 + tokens / 1_000_000),
    efficiency: tokPerUsd !== null ? 800 * pct : 0,
    breadth: 300 * Math.log10(1 + stats.projects * 10),
    streak: Math.min(stats.streakDays, 365),
    achievements: 50 * earned.length,
  };
  const vibe = Math.round(
    breakdown.volume + breakdown.leverage + breakdown.efficiency +
    breakdown.breadth + breakdown.streak + breakdown.achievements,
  );
  const hasData = stats.sources.length > 0 && (tokens > 0 || stats.commits > 0);

  return { vibe, rank: rankFor(vibe, hasData), breakdown, tokPerUsd, effPercentile: pct, achievements: earned, stats };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/score.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/score.ts packages/cli/test/score.test.ts
git commit -m "feat(cli): VIBE score engine — formula, ranks, offline percentile"
```

---

### Task 11: Number formatting + ANSI card renderer (golden test)

**Files:**
- Create: `packages/cli/src/format.ts`
- Create: `packages/cli/src/render.ts`
- Test: `packages/cli/test/format.test.ts`
- Test: `packages/cli/test/render.test.ts`

**Interfaces:**
- Consumes: `ScoreReport` (Task 10); `totalTokens` (Task 2).
- Produces:
  - `function fmtInt(n: number): string` — `312441 → '312,441'`
  - `function fmtCompact(n: number): string` — `1_234_000_000 → '1.2B'`, `6_500_000 → '6.5M'`, `950 → '950'`
  - `function fmtUsd(n: number): string` — `184.2 → '$184.20'`
  - `function renderCard(report: ScoreReport, opts: { colors: boolean; version: string }): string` — box-drawn card; when `colors: false` output contains zero escape sequences (golden-testable)

- [ ] **Step 1: Write the failing format test**

`packages/cli/test/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtInt, fmtCompact, fmtUsd } from '../src/format.js';

describe('formatters', () => {
  it('fmtInt adds thousands separators', () => {
    expect(fmtInt(312441)).toBe('312,441');
    expect(fmtInt(0)).toBe('0');
  });
  it('fmtCompact scales to K/M/B', () => {
    expect(fmtCompact(950)).toBe('950');
    expect(fmtCompact(6_500_000)).toBe('6.5M');
    expect(fmtCompact(1_234_000_000)).toBe('1.2B');
    expect(fmtCompact(12_300)).toBe('12.3K');
  });
  it('fmtUsd renders two decimals', () => {
    expect(fmtUsd(184.2)).toBe('$184.20');
    expect(fmtUsd(0)).toBe('$0.00');
  });
});
```

- [ ] **Step 2: Write the failing render test**

`packages/cli/test/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderCard } from '../src/render.js';
import { computeScore } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

describe('renderCard', () => {
  it('renders a stable plain card (golden)', () => {
    const stats = {
      ...emptyStats(),
      projects: 47, commits: 8921, streakDays: 212,
      locTotal: 312_441, locByLang: { TypeScript: 300_000, Rust: 12_441 }, maxRepoLoc: 200_000,
      tokens: { input: 200_000_000, output: 100_000_000, cacheWrite: 300_000_000, cacheRead: 600_000_000 },
      costUsd: 184.2, sources: ['claude-code', 'git'],
    };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).toContain('VIBERULER v0.1.0');
    expect(out).toContain('47 projects');
    expect(out).toContain('312,441 LoC');
    expect(out).toContain('1.2B tokens');
    expect(out).toContain('$184.20 burned');
    expect(out).toContain('tok/$');
    expect(out).toContain('VIBE SCORE');
    expect(out).toContain('RANK:');
    expect(out).not.toMatch(/\[/); // zero ANSI escapes in plain mode
  });

  it('renders NPC guidance when no data was found', () => {
    const out = renderCard(computeScore(emptyStats()), { colors: false, version: '0.1.0' });
    expect(out).toContain('NPC (no vibes detected)');
    expect(out).toContain('viberuler --scan-dir');
  });

  it('emits ANSI colors when enabled', () => {
    const out = renderCard(computeScore(emptyStats()), { colors: true, version: '0.1.0' });
    expect(out).toMatch(/\[/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/format.test.ts test/render.test.ts`
Expected: FAIL — cannot resolve modules.

- [ ] **Step 4: Write the implementations**

`packages/cli/src/format.ts`:

```ts
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
```

`packages/cli/src/render.ts`:

```ts
import { createColors } from 'picocolors';
import type { ScoreReport } from './score.js';
import { totalTokens } from './merge.js';
import { fmtCompact, fmtInt, fmtUsd } from './format.js';

const WIDTH = 46; // inner width of the card

function bar(vibe: number): string {
  const cells = 16;
  const filled = Math.max(0, Math.min(cells, Math.round((vibe / 8000) * cells)));
  return '▓'.repeat(filled) + '░'.repeat(cells - filled);
}

export function renderCard(report: ScoreReport, opts: { colors: boolean; version: string }): string {
  const c = createColors(opts.colors);
  const s = report.stats;
  const tokens = totalTokens(s.tokens);
  const lines: string[] = [];

  lines.push(c.bold(c.magenta(`VIBERULER v${opts.version}`)));
  lines.push('');

  if (report.rank === 'NPC (no vibes detected)') {
    lines.push(c.dim('No vibes detected on this rig.'));
    lines.push(c.dim('Try: viberuler --scan-dir <path-to-your-code>'));
    lines.push(c.dim('     (and make sure git user.email is set)'));
  } else {
    lines.push(`⚡ ${c.bold(fmtInt(s.projects))} projects · ${c.bold(fmtInt(s.locTotal))} LoC shipped`);
    lines.push(`🧠 ${c.bold(fmtCompact(tokens))} tokens · ${c.bold(fmtUsd(s.costUsd))} burned`);
    if (report.tokPerUsd !== null) {
      const pct = Math.round((1 - report.effPercentile) * 100);
      lines.push(`💸 ${c.bold(fmtCompact(report.tokPerUsd))} tok/$ · TOP ${c.bold(String(Math.max(1, pct)))}% (est.)`);
    }
    if (s.commits > 0) lines.push(`🔥 ${c.bold(String(s.streakDays))}-day streak · ${c.bold(fmtInt(s.commits))} commits`);
    if (s.ghStars > 0) lines.push(`⭐ ${c.bold(fmtInt(s.ghStars))} GitHub stars`);
  }

  lines.push('');
  lines.push(`VIBE SCORE ${c.magenta(bar(report.vibe))}  ${c.bold(fmtInt(report.vibe))}`);
  lines.push(`RANK: ${c.bold(c.cyan(report.rank.toUpperCase()))}`);

  if (report.achievements.length > 0) {
    lines.push('');
    lines.push(report.achievements.map((a) => `${a.emoji} ${a.title}`).join(' · '));
  }

  const top = `┌${'─'.repeat(WIDTH)}┐`;
  const bottom = `└${'─'.repeat(WIDTH)}┘`;
  return [top, ...lines.map((l) => `│ ${l}`), bottom].join('\n');
}
```

Note the card intentionally does NOT right-pad `│` borders on the right side — emoji are double-width in most terminals and code-unit padding produces visually broken right edges. Left border only + bottom rule reads clean everywhere. (If implementation shows this looks bad in practice, drop the side border entirely — keep top/bottom rules — and update the golden assertions accordingly; the golden test asserts content substrings, not exact layout, for exactly this reason.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/format.test.ts test/render.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/format.ts packages/cli/src/render.ts packages/cli/test/format.test.ts packages/cli/test/render.test.ts
git commit -m "feat(cli): formatters + ANSI scorecard renderer"
```

---

### Task 12: Submit payload builder

**Files:**
- Create: `packages/cli/src/payload.ts`
- Test: `packages/cli/test/payload.test.ts`

**Interfaces:**
- Consumes: `ScoreReport` (Task 10); `totalTokens` (Task 2).
- Produces:
  - `interface SubmitPayload { client_version: string; vibe_score: number; loc: number; projects: number; tokens: number; cost_usd: number; tok_per_usd: number | null; achievements: string[]; breakdown: Record<string, number> }`
  - `function buildPayload(report: ScoreReport, clientVersion: string): SubmitPayload`
- This is the EXACT shape Plan 2's `POST /api/submit` accepts. It must stay aggregates-only: the test asserts no key of the payload contains paths, language maps, or free-form strings beyond achievement ids.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPayload } from '../src/payload.js';
import { computeScore } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

describe('buildPayload', () => {
  const stats = {
    ...emptyStats(),
    projects: 3, commits: 50, streakDays: 10, locTotal: 5000,
    locByLang: { TypeScript: 5000 }, maxRepoLoc: 5000,
    tokens: { input: 1e6, output: 5e5, cacheWrite: 0, cacheRead: 0 },
    costUsd: 10, sources: ['git', 'claude-code'],
  };

  it('carries aggregates and rounded numbers only', () => {
    const p = buildPayload(computeScore(stats), '0.1.0');
    expect(p.client_version).toBe('0.1.0');
    expect(p.loc).toBe(5000);
    expect(p.projects).toBe(3);
    expect(p.tokens).toBe(1_500_000);
    expect(p.cost_usd).toBe(10);
    expect(p.tok_per_usd).toBe(150_000);
    expect(Array.isArray(p.achievements)).toBe(true);
    expect(typeof p.vibe_score).toBe('number');
  });

  it('leaks nothing beyond the fixed key set (privacy contract)', () => {
    const p = buildPayload(computeScore(stats), '0.1.0');
    expect(Object.keys(p).sort()).toEqual([
      'achievements', 'breakdown', 'client_version', 'cost_usd',
      'loc', 'projects', 'tok_per_usd', 'tokens', 'vibe_score',
    ]);
    // no locByLang, no paths, no repo names anywhere in the JSON
    const json = JSON.stringify(p);
    expect(json).not.toContain('TypeScript');
    expect(json).not.toContain('\\\\');
    expect(json).not.toContain('/home/');
  });

  it('serializes null tok_per_usd for zero-cost stats', () => {
    const p = buildPayload(computeScore({ ...emptyStats(), commits: 1, sources: ['git'] }), '0.1.0');
    expect(p.tok_per_usd).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/payload.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/payload.ts`:

```ts
import type { ScoreReport } from './score.js';
import { totalTokens } from './merge.js';

export interface SubmitPayload {
  client_version: string;
  vibe_score: number;
  loc: number;
  projects: number;
  tokens: number;
  cost_usd: number;
  tok_per_usd: number | null;
  achievements: string[];
  breakdown: Record<string, number>;
}

export function buildPayload(report: ScoreReport, clientVersion: string): SubmitPayload {
  const s = report.stats;
  return {
    client_version: clientVersion,
    vibe_score: report.vibe,
    loc: s.locTotal,
    projects: s.projects,
    tokens: totalTokens(s.tokens),
    cost_usd: Math.round(s.costUsd * 100) / 100,
    tok_per_usd: report.tokPerUsd === null ? null : Math.round(report.tokPerUsd),
    achievements: report.achievements.map((a) => a.id),
    breakdown: Object.fromEntries(
      Object.entries(report.breakdown).map(([k, v]) => [k, Math.round(v)]),
    ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/payload.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/payload.ts packages/cli/test/payload.test.ts
git commit -m "feat(cli): submit payload builder (aggregates-only privacy contract)"
```

---

### Task 13: CLI entry — argv, orchestration, `--json`, `payload`

**Files:**
- Create: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: everything above — collectors (`claudeCodeCollector`, `codexCollector`, `gitCollector`, `githubCollector`), `emptyStats`/`mergeStats`, `computeScore`, `renderCard`, `buildPayload`.
- Produces: `export async function main(argv: string[], out?: (line: string) => void): Promise<number>` (exit code). The tsup bundle of this file is the published bin. `out` defaults to `console.log` — tests inject a collector.

**CLI contract:**

```
viberuler [payload] [--json] [--scan-dir <path>]... [--since <YYYY-MM-DD>] [--github <handle>] [--no-color] [--version] [--help]
```

- default command: render card (colors auto: `process.stdout.isTTY && !process.env.NO_COLOR`, forced off by `--no-color`)
- `payload` command: print `JSON.stringify(buildPayload(...), null, 2)` — "everything that would leave your machine"
- `--json`: print full ScoreReport JSON (stats included — local eyes only)
- `--scan-dir` repeatable; default `[os.homedir()]` (via VIBERULER_HOME seam)
- warnings from stats go to `process.stderr`, never stdout
- collector failure → warning, run continues (Promise-level try/catch per collector)

- [ ] **Step 1: Write the failing test**

`packages/cli/test/cli.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

const fixture = fileURLToPath(new URL('./fixtures/claude/session-a.jsonl', import.meta.url));

let home: string;
let repoDir: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'vibe-cli-'));
  // fake ~/.claude/projects
  const proj = join(home, '.claude', 'projects', 'p1');
  await mkdir(proj, { recursive: true });
  await copyFile(fixture, join(proj, 's.jsonl'));
  // sacrificial git repo
  repoDir = join(home, 'code', 'proj1');
  await mkdir(repoDir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-C', repoDir, ...a]);
  git('init');
  git('config', 'user.email', 'vibe@test.local');
  git('config', 'user.name', 'V');
  await writeFile(join(repoDir, 'a.ts'), 'let x = 1;\n');
  git('add', '-A');
  git('commit', '-m', 'x');
  process.env.VIBERULER_HOME = home;
  process.env.VIBERULER_AUTHOR_EMAIL = 'vibe@test.local';
});

afterAll(() => {
  delete process.env.VIBERULER_HOME;
  delete process.env.VIBERULER_AUTHOR_EMAIL;
});

async function run(args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await main(args, (l) => lines.push(l));
  return { code, lines };
}

describe('main', () => {
  it('--json emits a full report with merged sources', async () => {
    const { code, lines } = await run(['--json', '--scan-dir', join(home, 'code')]);
    expect(code).toBe(0);
    const report = JSON.parse(lines.join('\n'));
    expect(report.stats.sources).toContain('claude-code');
    expect(report.stats.sources).toContain('git');
    expect(report.stats.tokens.input).toBe(100);
    expect(report.stats.projects).toBe(1);
    expect(report.vibe).toBeGreaterThan(0);
  });

  it('default command renders the card', async () => {
    const { code, lines } = await run(['--no-color', '--scan-dir', join(home, 'code')]);
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('VIBE SCORE');
    expect(text).toContain('RANK:');
  });

  it('payload command prints the aggregates-only JSON', async () => {
    const { code, lines } = await run(['payload', '--scan-dir', join(home, 'code')]);
    expect(code).toBe(0);
    const p = JSON.parse(lines.join('\n'));
    expect(p).toHaveProperty('vibe_score');
    expect(p).toHaveProperty('tok_per_usd');
    expect(p).not.toHaveProperty('locByLang');
  });

  it('--version prints the package version', async () => {
    const { code, lines } = await run(['--version']);
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--help prints usage and exits 0', async () => {
    const { code, lines } = await run(['--help']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('--scan-dir');
  });

  it('unknown flag exits 1 with usage on stderr path', async () => {
    const { code } = await run(['--bogus']);
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL — cannot resolve `../src/cli.js`.

- [ ] **Step 3: Write the implementation**

`packages/cli/src/cli.ts`:

```ts
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Collector, ScanContext, RawStats } from './types.js';
import { emptyStats, mergeStats } from './merge.js';
import { claudeCodeCollector } from './collectors/claude-code.js';
import { codexCollector } from './collectors/codex.js';
import { gitCollector } from './collectors/git.js';
import { githubCollector } from './collectors/github.js';
import { computeScore } from './score.js';
import { renderCard } from './render.js';
import { buildPayload } from './payload.js';

const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector, gitCollector, githubCollector];

const USAGE = `viberuler — the benchmark for vibe coders

Usage: viberuler [payload] [options]

Commands:
  (default)            scan + render your scorecard (100% local)
  payload              print the exact JSON that --submit WOULD send (nothing is sent)

Options:
  --scan-dir <path>    git scan root, repeatable        (default: your home dir)
  --since <date>       only count activity since YYYY-MM-DD
  --github <handle>    also pull public GitHub stars    (the only network call)
  --json               machine-readable full report
  --no-color           plain output
  --version            print version
  --help               this help
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  return pkg.version as string;
}

export async function collectAll(ctx: ScanContext, warn: (s: string) => void): Promise<RawStats> {
  let stats = emptyStats();
  for (const collector of COLLECTORS) {
    try {
      if (!(await collector.detect(ctx))) continue;
      stats = mergeStats(stats, await collector.collect(ctx));
    } catch (err) {
      warn(`[viberuler] ${collector.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}

export async function main(argv: string[], out: (line: string) => void = console.log): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'scan-dir': { type: 'string', multiple: true },
        since: { type: 'string' },
        github: { type: 'string' },
        json: { type: 'boolean' },
        'no-color': { type: 'boolean' },
        version: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
  } catch {
    process.stderr.write(USAGE);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.version) { out(version()); return 0; }
  if (values.help) { out(USAGE); return 0; }

  const command = positionals[0] ?? 'card';
  if (command !== 'card' && command !== 'payload') {
    process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
    return 1;
  }

  const home = process.env.VIBERULER_HOME ?? homedir();
  const since = values.since ? new Date(`${values.since}T00:00:00Z`) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    process.stderr.write('Invalid --since date, expected YYYY-MM-DD\n');
    return 1;
  }
  const ctx: ScanContext & { authorEmail?: string } = {
    home,
    scanDirs: values['scan-dir'] ?? [home],
    since,
    githubHandle: values.github,
    authorEmail: process.env.VIBERULER_AUTHOR_EMAIL,
  };

  const stats = await collectAll(ctx, (s) => process.stderr.write(s + '\n'));
  for (const w of stats.warnings) process.stderr.write(`[viberuler] ${w}\n`);
  const report = computeScore(stats);

  if (command === 'payload') {
    out(JSON.stringify(buildPayload(report, version()), null, 2));
    return 0;
  }
  if (values.json) {
    out(JSON.stringify(report, null, 2));
    return 0;
  }
  const colors = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !values['no-color'];
  out(renderCard(report, { colors, version: version() }));
  return 0;
}

// bin entry: execute only when run directly (not when imported by tests)
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
```

Implementation note: the direct-run detection line above is finicky across platforms. If it misbehaves on Windows during implementation, replace with the simpler convention: create `src/bin.ts` containing only `import { main } from './cli.js'; main(process.argv.slice(2)).then((c) => process.exit(c));`, point tsup `entry` at `src/bin.ts`, and keep `cli.ts` pure. Adjust `package.json` bin to `./dist/bin.js`. Either shape is acceptable; the test only imports `main`.

Also: Task 6's `gitCollector` reads the author-email override from `ctx` — confirm the key it reads (`authorEmail`) matches what `main` passes. Both are named `authorEmail` here; keep them in sync.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + typecheck + build smoke**

Run: `npx vitest run` — expected: ALL tests pass (~40).
Run: `npm run typecheck` — expected: clean.
Run: `npm run build` then `node dist/cli.js --version` — expected: `0.1.0`.
Run: `node dist/cli.js --no-color --scan-dir .` — expected: a real card renders against the viberuler repo itself (first dogfood!).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): CLI entry — orchestration, card/payload/json commands"
```

---

### Task 14: CI workflow (3-OS matrix)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts from Task 1 (`npm test`, `npm run typecheck`, `npm run build`).
- Produces: green CI badge target for Plan 3's README.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: git config --global user.email ci@viberuler.test && git config --global user.name CI
        shell: bash
      - run: npm install
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: node packages/cli/dist/cli.js --no-color --scan-dir .
```

- [ ] **Step 2: Verify locally what CI will run**

Run from repo root: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: 3-OS matrix — typecheck, test, build, dogfood run"
```

---

## Plan-level Definition of Done

- `npx viberuler` (via `node dist/cli.js`) renders a real card on the dev machine scanning `C:\telo` — dogfood screenshot saved for Plan 3 assets.
- All vitest suites green on the 3-OS CI matrix.
- Zero runtime deps beyond `picocolors` (`npm ls --omit=dev` shows exactly one).
- `viberuler payload` prints aggregates-only JSON matching Task 12's `SubmitPayload` — the frozen contract Plan 2 builds against.

## Deferred to Plan 2 (Worker + submit)

`--submit` flag, GitHub device flow, live percentile endpoint wiring (`computeScore`'s `effPercentile` param is the hook), share-link printing.

## Deferred to Plan 3 (Release)

README + animated SVG terminal, METHODOLOGY.md, PRIVACY section, vhs demo GIF, npm publish, launch-day checklist, cursor/gemini collector `good first issue` stubs.
