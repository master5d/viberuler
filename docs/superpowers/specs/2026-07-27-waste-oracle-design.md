# Waste oracle — honest context-waste accounting + window comparison

> Origin: owner's Evernote note «VibeRuler banch» — a list of 10 repos promising
> «cut Claude Code tokens by up to 90%». Lab intake #64 verified all 10 exist; **none
> publishes a methodology behind its percentage**. That gap is the product opportunity:
> those tools *treat*, viberuler *measures*. This slice makes viberuler the arbiter.

## §0. Goals

1. `viberuler audit` states, in tokens and with named classes, **where context went**
   and which of those classes a policy change could plausibly shrink — using this rig's
   own transcripts, never a vendor's number.
2. `viberuler audit --compare <since>..<until>` answers *«did the thing I installed
   actually change anything?»* by putting two windows side by side.

## §1. The honesty constraint (this is the whole point)

The tools we are answering claim savings they cannot substantiate. **We must not
inherit that sin.**

- **Never print a "you would save N%" figure.** We cannot know the counterfactual: a
  whole-file read that was never edited may still have been the read that told you
  *not* to edit. Same reasoning that killed causal-lift in the lab's own skill sensor.
- What we print instead: **class sizes** (facts) plus **one named lever per class**
  (a policy, not a promise). Example: `whole-file reads never edited — 412k tok · lever:
  outline-first`.
- The comparison mode reports an **observed delta between two windows**, explicitly
  labelled as observation, not causation: workload differs between windows, and that
  line says so in the output, not in a footnote nobody reads.
- Zero-data and single-window cases degrade to a clean "not enough data", never to
  a fabricated zero.

## §2. Waste classes (all already accumulated in `audit.ts`)

| Class | Source field | Named lever |
|---|---|---|
| whole-file reads never edited | `ghosts.exploratoryCalls/Tokens` | outline-first / symbol reads |
| repeat reads of unchanged files | `ghosts.repeatReadCalls/Tokens` | cache/dedup of tool output |
| oversized single results | `ghosts.oversizedCalls/Tokens` | slicing, `head`/`grep` before read |
| subagent-returned tokens | `agentReturned`, `compression` | tighter subagent contracts |

Classes overlap by construction (an oversized read can also be exploratory). The report
must say so and must **never sum them into a single "total waste"** — that would double
count and invent a headline number. Each class stands alone.

## §3. Surfaces

- `audit`: new `CONTEXT WASTE` section — one row per class: `count · tokens · lever`,
  sorted by tokens desc. Present only when transcripts exist.
- `--json`: `waste: { classes: [{ id, label, calls, tokens, lever }], note: string }`
  where `note` carries the no-causality disclaimer verbatim.
- `audit --compare <ISO>..<ISO>`: runs the existing scan twice with the two windows
  (`ScanContext.since/until` already supported), prints per-class `A → B (Δ, %)` plus
  the disclaimer line; `--json` gains `compare: { a: {…}, b: {…}, windows: {…} }`.
- README: one paragraph positioning — *tools that cut tokens are judges in their own
  case; this measures on your transcripts*.

## §4. Invariants

- Display-only: frozen 12-field submit payload, VIBE formula, D1 schema untouched.
- CLI keeps exactly one runtime dependency (`picocolors`).
- No new walk: reuse the fused single-pass walk from #22.
- Fail-open: any parse/collect failure degrades the section, never the audit.

## §5. Tests

1. Class accounting: fixture transcript with a known exploratory read, a repeat read,
   an oversized result → exact counts/tokens per class; overlapping event counted in
   every class it belongs to (and no total-sum field exists in the output).
2. Render: section present with data, absent when no transcripts; levers rendered.
3. `--compare` parses `A..B`, rejects malformed ranges with a clear error, runs two
   windows, prints deltas and the disclaimer; identical windows → zero deltas.
4. `--json` shapes for both modes; `note` string present.
5. Zero-data → "not enough data", no zeros pretending to be measurements.

## §6. Out of scope

Detecting installed optimizers (deferred — depends on third-party markers), any savings
estimate, board/payload changes, per-file waste listings (that is `--why`).
