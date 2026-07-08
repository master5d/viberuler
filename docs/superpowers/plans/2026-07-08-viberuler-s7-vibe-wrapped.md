# S7 Vibe Wrapped (monthly recap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `viberuler wrapped [--month YYYY-MM]` command that renders a shareable monthly recap — commits, busiest day, top language, streak, late-night sessions, tokens/cost/tok-per-dollar, and achievements — computed 100% locally (epic S7, issue #18).

**Architecture:** Wrapped needs a *bounded time window*, so `ScanContext` gains an optional `until` upper bound to pair with the existing `since`. Only the two accurately time-windowable collectors run for a recap — **git** (`git log --since/--until` is exact) and **claude-code** (per-message timestamps) — via a `collectAll(ctx, warn, collectors?)` subset parameter; cumulative/timeless sources (codex, cline, cursor, gemini, litellm) are deliberately excluded from the monthly view because their month splits aren't reliably reconstructable locally. The git collector also surfaces the month's `busiestDay`. A new `renderWrapped` prints the recap card. No worker route, no D1, no payload change — the recap is local (share by screenshot / the existing flex links).

**Tech Stack:** TypeScript ESM, vitest ^4.1. No new dependencies.

## Global Constraints

- `packages/cli` keeps exactly ONE runtime dependency (`picocolors`).
- CLI-LOCAL only: NO worker/D1/payload/migration change. Wrapped renders from local logs; nothing new is submitted or stored server-side.
- **Honesty about window scope:** wrapped counts only what is accurately windowable — git activity + Claude Code tokens for the month. It does NOT include Codex/Cline/Cursor/Gemini/LiteLLM (cumulative or timeless locally). The card and METHODOLOGY must say so; do not imply a full cross-agent monthly total.
- **Flow vs state:** wrapped shows flow metrics (commits, tokens, cost, streak, busiest day, late-night). It does NOT show LoC (a state metric — "LoC written in June" isn't derivable from `git ls-files`). Achievements shown are those earned *from the windowed stats* ("unlocked by this month's activity").
- `until` is a half-open upper bound: claude-code counts `since <= ts < until`; git uses `--since`/`--until` (minor boundary fuzz between the two is acceptable for a recap).
- `--month YYYY-MM` sets `since` = first instant of that month (UTC), `until` = first instant of the next month (UTC). Invalid/absent month handling per Task 2.
- `npm run typecheck` MUST pass (S5 lesson: vitest is transpile-only).

---

### Task 1: `until` window + `busiestDay` stat

**Files:**
- Modify: `packages/cli/src/types.ts` (`ScanContext.until`, `RawStats.busiestDay`/`busiestDayCount`)
- Modify: `packages/cli/src/merge.ts` (`emptyStats` + `mergeStats` for the new fields)
- Modify: `packages/cli/src/collectors/git.ts` (compute busiestDay; add `--until`)
- Modify: `packages/cli/src/collectors/claude-code.ts` (upper-bound the timestamp filter)
- Test: `packages/cli/test/git.test.ts`, `packages/cli/test/claude-code.test.ts`, `packages/cli/test/merge.test.ts`

**Interfaces:**
- Consumes: existing collector internals.
- Produces: `ScanContext.until?: Date`; `RawStats.busiestDay: string | null`; `RawStats.busiestDayCount: number`; `parseClaudeJsonl(content, seen, since?, until?)`. Task 2 sets `until` and reads `busiestDay`.

- [ ] **Step 1: Write the failing tests.**

Append to `packages/cli/test/merge.test.ts` (inside `describe('mergeStats', …)`):

```ts
  it('keeps the busiest day with the higher commit count', () => {
    const a = mergeStats(emptyStats(), { busiestDay: '2026-06-14', busiestDayCount: 40 });
    const b = mergeStats(a, { busiestDay: '2026-06-20', busiestDayCount: 12 });
    expect(b.busiestDay).toBe('2026-06-14');
    expect(b.busiestDayCount).toBe(40);
  });
```

Also add to the `emptyStats` assertion test (the "starts at zero everywhere" test): `expect(emptyStats().busiestDay).toBeNull();`.

Append to `packages/cli/test/claude-code.test.ts`:

```ts
describe('parseClaudeJsonl time window', () => {
  const line = (ts: string, id: string) =>
    JSON.stringify({ type: 'assistant', timestamp: ts, requestId: id,
      message: { id, model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  const content = [line('2026-05-31T12:00:00Z', 'r0'), line('2026-06-15T12:00:00Z', 'r1'), line('2026-07-01T00:00:00Z', 'r2')].join('\n');
  it('excludes records at/after `until` and before `since`', () => {
    const since = new Date('2026-06-01T00:00:00Z');
    const until = new Date('2026-07-01T00:00:00Z');
    const r = parseClaudeJsonl(content, new Set(), since, until);
    expect(r.tokens.input).toBe(100); // only r1 (June); r0 before since, r2 at until
  });
});
```

Append to `packages/cli/test/git.test.ts` (inside the integration `describe`, add a second commit on the same day as `init` to make a busiest day, then assert). Add this test:

```ts
  it('reports the busiest day (date with the most commits)', async () => {
    // the beforeAll repo has one commit on 2026-06-01; add two more that day
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'vibe@test.local']);
    await writeFile(join(repo, 'b.ts'), 'export const b = 1;\n');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-m', 'b', '--date', '2026-06-01T13:00:00']);
    await writeFile(join(repo, 'c.ts'), 'export const c = 1;\n');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-m', 'c', '--date', '2026-06-01T14:00:00']);
    const r = await gitCollector.collect({ home: scanRoot, scanDirs: [scanRoot], authorEmail: 'vibe@test.local' });
    expect(r.busiestDay).toBe('2026-06-01');
    expect(r.busiestDayCount).toBeGreaterThanOrEqual(3);
  });
```

(Note: `git.test.ts` must expose `repo`/`scanRoot` at describe scope. If they're local to `beforeAll`, hoist them to `let` at describe scope as PR #11 already did for `repo`. Confirm before writing; if `scanRoot` is not hoisted, hoist it.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/merge.test.ts test/claude-code.test.ts test/git.test.ts` (cwd `packages/cli`)
Expected: FAIL — `busiestDay` undefined; `until` param ignored.

- [ ] **Step 3: Implement types** — in `packages/cli/src/types.ts`:

Add to `ScanContext` (after `since?`):

```ts
  since?: Date;
  until?: Date; // exclusive upper bound for time-windowed recaps (wrapped)
```

Add to `RawStats` (after `historyRewrites`):

```ts
  busiestDay: string | null;   // YYYY-MM-DD with the most commits (windowed)
  busiestDayCount: number;
```

- [ ] **Step 4: Implement merge** — in `packages/cli/src/merge.ts`:

In `emptyStats`, add `busiestDay: null, busiestDayCount: 0,` to the returned object.

In `mergeStats`, add to the returned object:

```ts
    busiestDay: (add.busiestDayCount ?? 0) > base.busiestDayCount ? (add.busiestDay ?? null) : base.busiestDay,
    busiestDayCount: Math.max(base.busiestDayCount, add.busiestDayCount ?? 0),
```

- [ ] **Step 5: Implement git collector** — in `packages/cli/src/collectors/git.ts`:

Add `--until` after the existing `--since` push:

```ts
        if (ctx.since) logArgs.push(`--since=${ctx.since.toISOString()}`);
        if (ctx.until) logArgs.push(`--until=${ctx.until.toISOString()}`);
```

Compute busiest day from `allDates` before the return. Add just before `return {`:

```ts
    let busiestDay: string | null = null;
    let busiestDayCount = 0;
    const dayCounts = new Map<string, number>();
    for (const d of allDates) {
      const n = (dayCounts.get(d) ?? 0) + 1;
      dayCounts.set(d, n);
      if (n > busiestDayCount) { busiestDayCount = n; busiestDay = d; }
    }
```

and add `busiestDay, busiestDayCount,` to the returned object.

- [ ] **Step 6: Implement claude-code upper bound** — in `packages/cli/src/collectors/claude-code.ts`, change `parseClaudeJsonl`'s signature to accept `until?: Date`:

```ts
export function parseClaudeJsonl(
  content: string,
  seen: Set<string>,
  since?: Date,
  until?: Date,
): { tokens: TokenUsage; costUsd: number; skipped: number } {
```

Add the upper-bound guard right after the existing `since` guard:

```ts
    if (since && obj.timestamp && Date.parse(obj.timestamp) < since.getTime()) continue;
    if (until && obj.timestamp && Date.parse(obj.timestamp) >= until.getTime()) continue;
```

And in the collector's `collect`, pass `ctx.until` through the `parseClaudeJsonl` call:

```ts
        const r = parseClaudeJsonl(await readFile(file, 'utf8'), seen, ctx.since, ctx.until);
```

- [ ] **Step 7: Run the full CLI suite + typecheck**

Run: `npx vitest run` then `npm run typecheck` (cwd `packages/cli`)
Expected: ALL PASS. Existing callers of `parseClaudeJsonl(content, seen)` and `(…, since)` still work (until defaults undefined). `RawStats` consumers compile (new required fields are set by `emptyStats`).

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/types.ts packages/cli/src/merge.ts packages/cli/src/collectors/git.ts packages/cli/src/collectors/claude-code.ts packages/cli/test/merge.test.ts packages/cli/test/git.test.ts packages/cli/test/claude-code.test.ts
git commit -m "feat(scan): ScanContext.until window + busiestDay stat (S7, #18)"
```

### Task 2: `wrapped` command + `renderWrapped`

**Files:**
- Modify: `packages/cli/src/cli.ts` (`collectAll` subset param; `--month` option; `wrapped` command)
- Create: `packages/cli/src/wrapped.ts` (`renderWrapped`)
- Test: `packages/cli/test/wrapped.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `ScanContext.until`, `RawStats.busiestDay` (Task 1); `computeScore`, `renderCard` patterns; `claudeCodeCollector`, `gitCollector`.
- Produces: `renderWrapped(report: ScoreReport, month: string, opts: { colors: boolean; version: string }): string`; `collectAll(ctx, warn, collectors?)`; `wrapped` command + `--month` flag.

- [ ] **Step 1: Write the failing tests** — create `packages/cli/test/wrapped.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderWrapped } from '../src/wrapped.js';
import { computeScore } from '../src/score.js';
import { emptyStats } from '../src/merge.js';

describe('renderWrapped', () => {
  it('renders the month, commits, busiest day, streak, and tokens', () => {
    const stats = {
      ...emptyStats(), commits: 132, streakDays: 16, lateNightCommits: 9,
      busiestDay: '2026-06-14', busiestDayCount: 22,
      locByLang: { TypeScript: 9000, Rust: 1000 },
      tokens: { input: 5_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 }, costUsd: 12,
      sources: ['claude-code', 'git'],
    };
    const out = renderWrapped(computeScore(stats), '2026-06', { colors: false, version: '0.3.0' });
    expect(out).toContain('VIBE WRAPPED');
    expect(out).toContain('2026-06');
    expect(out).toContain('132'); // commits
    expect(out).toContain('2026-06-14'); // busiest day
    expect(out).toContain('16'); // streak
    expect(out).toContain('TypeScript'); // top language
    expect(out).not.toMatch(/\[/); // no ANSI in plain mode
  });

  it('handles an empty month gracefully', () => {
    const out = renderWrapped(computeScore(emptyStats()), '2026-01', { colors: false, version: '0.3.0' });
    expect(out).toContain('2026-01');
    expect(out).toMatch(/quiet month|no vibes|nothing/i);
  });
});
```

Append to `packages/cli/test/cli.test.ts` (a command-level test; reuses the `run` helper and the fake `home`):

```ts
  it('wrapped renders a monthly recap card', async () => {
    const { code, lines } = await run(['wrapped', '--month', '2026-06', '--no-color']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('VIBE WRAPPED');
    expect(lines.join('\n')).toContain('2026-06');
  });

  it('wrapped rejects a malformed month', async () => {
    const { code } = await run(['wrapped', '--month', 'June', '--no-color']);
    expect(code).toBe(1);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/wrapped.test.ts test/cli.test.ts` (cwd `packages/cli`)
Expected: FAIL — `renderWrapped` missing; `wrapped` command unknown.

- [ ] **Step 3: Implement `renderWrapped`** — create `packages/cli/src/wrapped.ts`:

```ts
import { createColors } from 'picocolors';
import type { ScoreReport } from './score.js';
import { totalTokens } from './merge.js';
import { fmtCompact, fmtInt, fmtUsd } from './format.js';

const WIDTH = 46;

function topLanguage(byLang: Record<string, number>): string | null {
  let top: string | null = null;
  let max = -1;
  for (const [lang, n] of Object.entries(byLang)) if (n > max) { max = n; top = lang; }
  return top;
}

export function renderWrapped(
  report: ScoreReport,
  month: string,
  opts: { colors: boolean; version: string },
): string {
  const c = createColors(opts.colors);
  const s = report.stats;
  const tokens = totalTokens(s.tokens);
  const lines: string[] = [];

  lines.push(c.bold(c.magenta(`🎁 VIBE WRAPPED · ${month}`)));
  lines.push('');

  const quiet = s.commits === 0 && tokens === 0;
  if (quiet) {
    lines.push(c.dim('A quiet month — no commits or tokens in this window.'));
    lines.push(c.dim('Try another --month, or go ship something.'));
  } else {
    lines.push(`🔥 ${c.bold(fmtInt(s.commits))} commits · ${c.bold(String(s.streakDays))}-day streak`);
    if (s.busiestDay) lines.push(`📅 busiest day ${c.bold(s.busiestDay)} (${c.bold(fmtInt(s.busiestDayCount))} commits)`);
    if (s.lateNightCommits > 0) lines.push(`🌙 ${c.bold(fmtInt(s.lateNightCommits))} late-night commits`);
    const lang = topLanguage(s.locByLang);
    if (lang) lines.push(`🏆 top language: ${c.bold(lang)}`);
    if (tokens > 0) {
      lines.push(`🧠 ${c.bold(fmtCompact(tokens))} tokens · ${c.bold(fmtUsd(s.costUsd))} (Claude Code)`);
      if (report.tokPerUsd !== null) lines.push(`💸 ${c.bold(fmtCompact(report.tokPerUsd))} tok/$`);
    }
    if (report.achievements.length > 0) {
      lines.push('');
      lines.push(`unlocked: ${report.achievements.map((a) => `${a.emoji} ${a.title}`).join(' · ')}`);
    }
  }

  lines.push('');
  lines.push(c.dim('recap: Claude Code tokens + git activity for the month · npx viberuler wrapped'));

  const top = `┌${'─'.repeat(WIDTH)}┐`;
  const bottom = `└${'─'.repeat(WIDTH)}┘`;
  return [top, ...lines.map((l) => `│ ${l}`), bottom].join('\n');
}
```

- [ ] **Step 4: Wire the command into cli.ts.**

Add a `collectors` subset param to `collectAll` (default preserves current behavior):

```ts
export async function collectAll(
  ctx: ScanContext,
  warn: (s: string) => void,
  collectors: Collector[] = COLLECTORS,
): Promise<RawStats> {
  let stats = emptyStats();
  for (const collector of collectors) {
```

Add `month` to the `parseArgs` options object:

```ts
        since: { type: 'string' },
        month: { type: 'string' },
```

Extend the command guard (currently `command !== 'card' && command !== 'payload'`) to also allow `'wrapped'`:

```ts
  if (command !== 'card' && command !== 'payload' && command !== 'wrapped') {
```

Add the `wrapped` branch. Place it AFTER the `ctx` is built (it needs `home`) but it builds its own windowed ctx. Insert this block right after the `const stats = await collectAll(...)` line is NOT reached for wrapped — instead, handle `wrapped` BEFORE the default collectAll. Concretely, insert immediately after the `if (since && Number.isNaN(...))` validation block and before `const ctx: ScanContext = {`:

```ts
  if (command === 'wrapped') {
    const month = values.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      process.stderr.write('wrapped requires --month YYYY-MM\n');
      return 1;
    }
    const monthStart = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(monthStart.getTime())) {
      process.stderr.write('invalid --month, expected YYYY-MM\n');
      return 1;
    }
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const wctx: ScanContext = {
      home,
      scanDirs: values['scan-dir'] ?? [home],
      since: monthStart,
      until: nextMonth,
      authorEmail: process.env.VIBERULER_AUTHOR_EMAIL,
      env: process.env,
    };
    const wstats = await collectAll(wctx, (s) => process.stderr.write(s + '\n'), [claudeCodeCollector, gitCollector]);
    for (const w of wstats.warnings) process.stderr.write(`[viberuler] ${w}\n`);
    const colors = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !values['no-color'];
    out(renderWrapped(computeScore(wstats), month, { colors, version: version() }));
    return 0;
  }
```

Add the imports at the top of cli.ts:

```ts
import { renderWrapped } from './wrapped.js';
```

(`claudeCodeCollector` and `gitCollector` are already imported.)

Update the USAGE string: add under Commands:

```
  wrapped              monthly recap card — needs --month YYYY-MM (Claude Code + git)
```

and under Options:

```
  --month <YYYY-MM>    the month for `wrapped`
```

- [ ] **Step 5: Run the full CLI suite + typecheck**

Run: `npx vitest run` then `npm run typecheck` (cwd `packages/cli`)
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/wrapped.ts packages/cli/test/wrapped.test.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): viberuler wrapped — local monthly recap card (S7, #18)"
```

### Task 3: Documentation

**Files:**
- Modify: `README.md` (usage + roadmap)
- Modify: `METHODOLOGY.md` (a short «Wrapped» note)

**Interfaces:**
- Consumes: shipped behavior of Tasks 1-2.
- Produces: nothing downstream; closes the slice.

- [ ] **Step 1: README** — add a short usage line near the top commands and tick the roadmap. Under a commands/usage area add:

```markdown
### Monthly recap

```bash
npx viberuler wrapped --month 2026-06
```

Your **Vibe Wrapped** for the month — commits, busiest day, streak, top language, and Claude Code tokens/cost for that window. 100% local; screenshot and flex.
```

And in the roadmap, replace `- [ ] Team leaderboards` position by adding above it:

```markdown
- [x] Vibe Wrapped — monthly recap card
- [ ] Team leaderboards
```

- [ ] **Step 2: METHODOLOGY** — add a short subsection after §3 (or near the ranks), before a suitable heading:

```markdown
### Vibe Wrapped (`wrapped --month`)

`viberuler wrapped --month YYYY-MM` renders a monthly recap from the two sources that can be **accurately time-windowed locally**: git activity (`git log --since/--until`) and Claude Code tokens (per-message timestamps). Cumulative or timeless sources (Codex, Cline, Cursor, Gemini, LiteLLM) are **excluded** from the monthly view — their month splits aren't reliably reconstructable on your machine. It reports flow metrics (commits, streak, busiest day, late-night, tokens, cost, tok/$) — not LoC, which is a state metric. Achievements shown are those the month's activity alone would earn.
```

- [ ] **Step 3: Fact-check and commit**

Run: `npx vitest run test/wrapped.test.ts test/cli.test.ts` (cwd `packages/cli`) — PASS; confirm doc claims (windowed sources = git + claude-code only; flow not LoC) match `cli.ts`'s wrapped collector subset + `wrapped.ts` verbatim.

```bash
git add README.md METHODOLOGY.md
git commit -m "docs: document viberuler wrapped monthly recap (S7, closes #18)"
```

---

## Self-review notes

- Spec coverage: `wrapped [--month]` command ✓; recap stats (commits, busiest day, top language, streak, late-night, tokens, cost, tok/$, achievements) ✓; local-only, no worker/D1/payload ✓ (chose CLI-side over the epic's optional `/wrapped/:login` route to avoid storing time series — documented); month window via since+until ✓.
- Honesty: wrapped only aggregates accurately-windowable sources (git + claude-code); the card footer AND METHODOLOGY state this so it doesn't imply a full cross-agent monthly total. LoC excluded (state metric).
- Type consistency: `ScanContext.until?: Date` and `RawStats.busiestDay/busiestDayCount` defined in Task 1, consumed by Task 2; `parseClaudeJsonl(content, seen, since?, until?)` extended compatibly (existing 2/3-arg callers unaffected); `renderWrapped(report, month, opts)` signature identical across wrapped.ts and cli.ts.
- `npm run typecheck` is an explicit step in both code tasks (S5 lesson).
- Deliberately NOT done (YAGNI): worker `/wrapped/:login/:YYYY-MM` share route + OG (would require storing per-month time series server-side — out of scope; local screenshot is the share path for v0.3); time-windowing codex/cline/cursor/gemini/litellm (cumulative/unreliable locally — excluded honestly rather than counted wrongly); January-timed yearly wrap (monthly is the shippable unit now).
