# VibeRuler Root-Cause Attribution — Design

> Research pattern-seed onboarding: **From Noisy Traces to Root Causes** (arXiv 2607.07702)
> → a structural-attribution layer over `viberuler audit`. Turns the audit from a
> *symptom counter* (ghosts: repeat-reads, oversized, exploratory) into a **ranked
> root-cause partition** of measured token waste, each motif with a concrete fix.
> Source seed: NAUTILUS `core/research/queue.md` row "From Noisy Traces to Root Causes".

## §0. One-sentence goal

Answer **"what patterns cause most of my token waste, and what do I change?"** — by
partitioning the audit's already-measured waste tokens under the named upstream motif that
produced each one, ranked by attributable cost, with a fix per motif.

## §1. The honesty decision (attribution, not causation)

The paper's word is "causal." True causation needs a counterfactual — *would these tokens
have been spent if the pattern hadn't happened?* — which a single realized trajectory
cannot supply (you can't replay the session). So v1 is **structural attribution**: a motif
is the most-upstream, most-actionable structural pattern that *precedes and correlates with*
a slice of waste. It is a **candidate** root cause, never a proven cause (a repeat-read may
have been forced by context eviction — the tool can't know). This fits VibeRuler's ethos
exactly (METHODOLOGY §"traceable or it's a bug"): every motif traces to its detection rule.
Where a **real** counterfactual already exists — cache economy (`costNoCacheUsd`, a
price-table subtraction, not a guess) — it stays a genuine measured delta, reported
separately, never folded into the attributed motifs.

## §2. The no-double-count backbone (correctness core)

Root-causes must **partition** the measured waste, never inflate it (`squad_postmortem`
no-double-blame; `harness_vs_its_own_null`):

- **Single ownership.** Each wasted token is attributed to **exactly one** motif. Overlaps
  are real (a repeat-read of an oversized whole file qualifies as two motifs); a fixed
  **precedence order** (§3) assigns it to one, so `Σ attributableTokens ≤ total measured
  waste`. The renderer asserts this invariant.
- **Attribution ≠ causation.** Section header: *"Structural attribution: these motifs
  precede the waste and are the most actionable fix — not proven causation."*
- **Real counterfactual kept separate.** Cache savings (`costNoCacheUsd − costUsd`) is a
  measured delta, reported on its own, not attributed as a motif.

## §3. Motif catalog + precedence

Four v1 motifs, each partitioning a slice of the audit's existing waste signals. Precedence
(top = most upstream/actionable) resolves overlaps so each token lands in exactly one:

| # | motif | root cause (human) | fix | attributable tokens (before partition) |
|---|---|---|---|---|
| 1 | `read-whole-then-reread` | re-read an identical-size (unchanged) file — the second+ read bought nothing | slice large reads; trust the first read | `repeatReadTokens` |
| 2 | `oversized-unslice` | pulled a huge result whole instead of slicing | `head_limit`/offset; paginate | oversized tokens from **non-sliced** Reads |
| 3 | `explore-wide-use-narrow` | read files you never edited | outline/grep first; read only what you'll touch | `exploratoryTokens` |
| 4 | `subagent-result-bloat` | subagents dumped large results into the parent | return files/summaries, not full dumps | `agentReturned` above `SUBAGENT_RETURN_BUDGET_TOKENS` (excess only) |

**Partition by precedence 1 > 2 > 3 > 4.** The right column is each motif's *raw* claim; a
token claimed by an earlier motif is **removed from every later motif's total** before
ranking, so the totals are disjoint and sum to ≤ measured waste. Concretely: a repeat-read
of an oversized whole file → #1 owns it, and #2 subtracts those tokens; an oversized
exploratory read → #2 owns it, and #3 subtracts. `SUBAGENT_RETURN_BUDGET_TOKENS` is a named
constant in `root-cause.ts` (v1 value fixed in the plan; a subagent returning under budget
is not waste). The enriched signals therefore carry enough per-path detail to compute the
exclusions, not just the aggregate ghost counts.

Each `RootCause`: `{ motif, rootCause, fix, attributableTokens, attributableUsd, evidence }`
where `evidence` names the top offending paths/counts (traceability). Ranked by
`attributableTokens` desc.

## §4. Architecture & data flow

New file `packages/cli/src/root-cause.ts` — pure, no I/O, no new JSONL parsing.

```
ENRICH    audit parse loop retains minimal per-path antecedent detail (token, sliced,
            repeat, edited) — it already computes these in reads[]/readSizes/edited/ghosts
ATTRIBUTE attributeRootCauses(signals, priceFn) -> RootCause[]   (partition, single-owner, §2)
RANK      sort by attributableTokens desc
REPORT    AuditReport gains optional `rootCauses?: RootCause[]` (populated only under --why)
RENDER    renderRootCauses() appended after the current audit output (flag-gated)
```

`attributeRootCauses` is a pure function over a `WasteSignals` object (the enriched
per-path/per-motif tallies) — fully unit-tested with synthetic signals; no live parse in
tests. The accumulator enrichment reuses existing data: `reads[]` (path, tokens, sliced),
`readSizes` (repeat detection), `edited` set (exploratory classification), `agentReturned`.

## §5. Integration

- **CLI:** a `--why` flag on the existing `audit` command (`cli.ts`); default audit output
  unchanged so the live 0.6.0 card is not disrupted until the feature is promoted.
- **Report:** optional `rootCauses?` on `AuditReport`, so `--json` consumers get it.
- **Pricing:** `attributableUsd` via the existing `pricing.ts` table (same source as the
  rest of the audit — no new price logic).
- **Render:** `renderRootCauses()` in `render-audit.ts`, appended after the audit, with the
  §2 disclaimer header and the single-ownership sum shown ("attributed N of M waste tokens").
- **METHODOLOGY.md:** a new section — each motif's detection rule, the precedence order, the
  single-ownership invariant, the attribution-not-causation disclaimer (required: every
  number must trace to that doc).

## §6. Testing

vitest, `packages/cli/test/root-cause.test.ts` (mirror `audit.test.ts` style):

- **Clean trajectory** (no waste signals) → `attributeRootCauses` returns `[]`.
- **Defect trajectory** → the expected ranked motifs with correct attributable tokens.
- **Invariant (honesty backbone):** `Σ attributableTokens ≤ total measured waste` on every
  fixture — no double-count.
- **Precedence:** the overlap case (repeat-read of an oversized whole file) is attributed to
  `read-whole-then-reread` only, counted once.
- **Ranking:** motifs sorted by attributable tokens desc.
- **Render:** the disclaimer header is present; the attributed/measured sum line is correct.
- **Live smoke** (owner-runnable, no infra gate — local): `viberuler audit --why` on real
  `~/.claude` transcripts; confirm the partition sums and the top motifs are plausible.

## §7. Out of scope (v1)

- True counterfactual replay (the causal-lift wall) — cannot replay a session.
- ML / embedding trajectory clustering; cross-session motif trend tracking.
- Motifs beyond the four — more can be added once the partition framework is proven.
- Promoting `--why` into the default card — a follow-up once the motifs are validated on
  real data.
