# S4 Shipped-Efficiency Metric (tokens-per-line) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute and display **tokens per line of code you shipped** — the efficiency-and-shipping axis no volume/spend leaderboard can copy, because only VibeRuler cross-references token collectors against a git LoC layer (epic S4, issue #15).

**Architecture:** `computeScore` gains a derived `tokPerLoc: number | null` (`total tokens ÷ git LoC`, `null` when LoC is 0 — mirrors the existing `tokPerUsd` guard). The card renders one line when it's non-null. Because `--json` already serializes the whole `ScoreReport`, the field appears there automatically. **Display-only in v0.3:** it does NOT enter the VIBE formula (no `score.ts` breakdown/weight change) — we collect a release of real data before weighting it (revisit v0.4).

**Tech Stack:** TypeScript ESM, vitest ^4.1. No new dependencies.

## Global Constraints

- `packages/cli` keeps exactly ONE runtime dependency: `picocolors`.
- **Scope boundary (deliberate):** this slice is CLI-LOCAL ONLY. It does NOT touch `payload.ts`, `validation.ts`, the worker, D1 migrations, or share/OG pages. The frozen 9-key submit payload and PRIVACY.md's "exactly nine fields" claim stay intact. Surfacing `tok_per_loc` on the leaderboard/OG cards + the payload/schema bump is bundled into S5 (#16), which already touches the worker + validation + a migration — one coordinated schema evolution, per the epic.
- The metric is **display-only**: `score.ts`'s `ScoreBreakdown` and the `vibe` computation are UNCHANGED. Do not add a weight.
- `tokPerLoc = totalTokens(stats.tokens) / stats.locTotal` when `stats.locTotal > 0`, else `null`. Lower = leaner (fewer tokens per shipped line).
- `stats.locTotal` semantics (already documented in METHODOLOGY §1): lines in `git ls-files` code files across repos where you authored ≥1 commit — "lines in your repos," not blame-attributed authorship. METHODOLOGY must not overclaim.
- Existing tests must keep passing unchanged except where a step explicitly edits them.

---

### Task 1: `computeScore` derives `tokPerLoc`

**Files:**
- Modify: `packages/cli/src/score.ts` (the `ScoreReport` interface + `computeScore` body + its return)
- Test: `packages/cli/test/score.test.ts`

**Interfaces:**
- Consumes: `totalTokens` (already imported in `score.ts`), `RawStats.locTotal`, `RawStats.tokens`.
- Produces: `ScoreReport.tokPerLoc: number | null`. Task 2 (render) reads exactly this field.

- [ ] **Step 1: Write the failing tests** — append to `packages/cli/test/score.test.ts` inside the existing `describe('computeScore', …)` block (before its closing `});`):

```ts
  it('derives tokPerLoc = tokens / locTotal', () => {
    const stats = {
      ...emptyStats(), commits: 1, sources: ['git'], locTotal: 1000,
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
    };
    // 2,000,000 tokens / 1000 LoC = 2000 tok per line
    expect(computeScore(stats).tokPerLoc).toBeCloseTo(2000, 6);
  });

  it('tokPerLoc is null when locTotal is 0 (no division by zero)', () => {
    const stats = {
      ...emptyStats(), commits: 1, sources: ['git'], locTotal: 0,
      tokens: { input: 5_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
    };
    expect(computeScore(stats).tokPerLoc).toBeNull();
  });

  it('tokPerLoc does NOT change the VIBE score (display-only)', () => {
    const base = { ...emptyStats(), commits: 1, sources: ['git'], locTotal: 0,
      tokens: { input: 4_000_000, output: 0, cacheWrite: 0, cacheRead: 0 } };
    const withLoc = { ...base, locTotal: 500 };
    // adding LoC changes volume (that's expected), so isolate: same locTotal, the
    // tokPerLoc field itself must not feed the formula — compare vibe computed from
    // breakdown only.
    const r = computeScore(withLoc);
    expect(r.vibe).toBe(Math.round(
      r.breakdown.volume + r.breakdown.leverage + r.breakdown.efficiency +
      r.breakdown.breadth + r.breakdown.streak + r.breakdown.achievements,
    ));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/score.test.ts` (cwd `packages/cli`)
Expected: FAIL — `tokPerLoc` is `undefined` (not a property of `ScoreReport` yet); the two value tests fail.

- [ ] **Step 3: Implement in `packages/cli/src/score.ts`.** Add the field to the interface (after the `tokPerUsd` line):

```ts
  tokPerUsd: number | null;
  tokPerLoc: number | null;
```

In `computeScore`, after the existing `const tokPerUsd = …` line, add:

```ts
  const tokPerLoc = stats.locTotal > 0 ? tokens / stats.locTotal : null;
```

and add `tokPerLoc` to the returned object (after `tokPerUsd`):

```ts
  return { vibe, rank: rankFor(vibe, hasData), breakdown, tokPerUsd, tokPerLoc, effPercentile: pct, achievements: earned, stats };
```

- [ ] **Step 4: Run the full CLI suite**

Run: `npx vitest run` (cwd `packages/cli`)
Expected: ALL PASS. (`--json` output now includes `tokPerLoc` automatically since it serializes `ScoreReport`; no cli.ts change needed.)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/score.ts packages/cli/test/score.test.ts
git commit -m "feat(score): derive tokPerLoc (tokens per shipped line), display-only (S4, #15)"
```

### Task 2: Card renders the shipped-efficiency line

**Files:**
- Modify: `packages/cli/src/render.ts` (inside `renderCard`, the non-NPC branch)
- Test: `packages/cli/test/render.test.ts`

**Interfaces:**
- Consumes: `ScoreReport.tokPerLoc` (Task 1); `fmtCompact` (already imported in `render.ts`).
- Produces: one card line `🎯 <compact> tok / line shipped` when `tokPerLoc !== null`.

- [ ] **Step 1: Write the failing tests** — append to `packages/cli/test/render.test.ts` inside the existing `describe('renderCard', …)` block:

```ts
  it('renders the shipped-efficiency line when LoC is present', () => {
    const stats = {
      ...emptyStats(), commits: 10, locTotal: 1000, sources: ['claude-code', 'git'],
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 4,
    };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).toContain('🎯 2K tok / line shipped');
  });

  it('omits the shipped-efficiency line when there is no LoC', () => {
    const stats = {
      ...emptyStats(), commits: 10, locTotal: 0, sources: ['claude-code'],
      tokens: { input: 2_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 4,
    };
    const out = renderCard(computeScore(stats), { colors: false, version: '0.1.0' });
    expect(out).not.toContain('line shipped');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/render.test.ts` (cwd `packages/cli`)
Expected: FAIL — the line is not rendered yet.

- [ ] **Step 3: Implement in `packages/cli/src/render.ts`.** In `renderCard`, inside the `else` (non-NPC) branch, immediately after the `if (report.tokPerUsd !== null) { … }` block, add:

```ts
    if (report.tokPerLoc !== null) {
      lines.push(`🎯 ${c.bold(fmtCompact(report.tokPerLoc))} tok / line shipped`);
    }
```

- [ ] **Step 4: Run the full CLI suite**

Run: `npx vitest run` (cwd `packages/cli`)
Expected: ALL PASS. (The golden-card test in `render.test.ts` uses `locTotal: 312_441` with `tokens` summing to 1.2B → it will now also contain the new line; that test only asserts `toContain(...)` on specific substrings and `not.toMatch(/\[/)`, so the extra line does not break it. Verify this holds; if the golden test asserts an exact full-string equality it does not — it uses `toContain` — so no update needed.)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/render.ts packages/cli/test/render.test.ts
git commit -m "feat(render): show tok/line-shipped on the card when LoC is present (S4, #15)"
```

### Task 3: METHODOLOGY documents the metric

**Files:**
- Modify: `METHODOLOGY.md` (add a short subsection after «## 3. The formula», before «## 4. Ranks»)

**Interfaces:**
- Consumes: the shipped behavior of Tasks 1-2 — doc must match code (ratio direction, null case, LoC semantics, display-only status).
- Produces: nothing downstream; closes the slice.

- [ ] **Step 1: Insert the subsection.** In `METHODOLOGY.md`, add this block immediately before the `## 4. Ranks` heading:

```markdown
### Shipped efficiency (tokens per line)

Your card also shows **`tok / line shipped`** = total tokens ÷ your LoC (the git figure from §1). It's the "did the tokens actually produce code?" axis: lower is leaner. Two honest caveats — (1) LoC here is *lines in your repos* (`git ls-files`), not blame-attributed authorship, so shared and vendored code you committed counts; (2) it is **display-only** — it does **not** feed the VIBE score in this version (we're collecting a release of real data before deciding its weight). It's `—`/omitted when you have no scanned LoC. Source: [`packages/cli/src/score.ts`](packages/cli/src/score.ts).
```

- [ ] **Step 2: Fact-check the doc against the code.**

Run: `npx vitest run test/score.test.ts test/render.test.ts` (cwd `packages/cli`)
Expected: PASS — and manually confirm the doc's claims (ratio = tokens ÷ LoC, lower-is-leaner, display-only / not in VIBE, null when no LoC) match `score.ts` and `render.ts` verbatim.

- [ ] **Step 3: Commit**

```bash
git add METHODOLOGY.md
git commit -m "docs(methodology): document tok/line shipped-efficiency metric (S4, closes #15)"
```

---

## Self-review notes

- Spec coverage: compute `tokPerLoc` with div-by-zero guard ✓ (Task 1); card line ✓ (Task 2); `--json` field ✓ (automatic via `ScoreReport` serialization — noted, not a separate task); display-only / no VIBE weight ✓ (explicit test + no breakdown change); METHODOLOGY caveats ✓ (Task 3).
- Payload/worker/migration/share/OG NOT touched — deferred to S5 per the epic's one-schema-bump guidance; frozen-9-key payload + PRIVACY "nine fields" intact. Stated in Global Constraints so the final reviewer expects the boundary.
- Type consistency: `tokPerLoc: number | null` named identically in `ScoreReport` (Task 1) and read as `report.tokPerLoc` (Task 2); mirrors the existing `tokPerUsd` shape exactly.
- Deliberately NOT done (YAGNI): blame-based per-author LoC (heavy git work, future refinement); percentile/ranking of tok/line (needs board data — comes with S5's board display); inverting to "lines per Mtok" (epic named tokens-per-line; keep it).
