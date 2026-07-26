# Time metrics — transcript-derived session time (issue #21)

> Zero-touch, cross-platform, no daemons: viberuler already reads agent transcripts;
> the same files carry timestamps, so time comes for free. Implementer: **agy**
> (Antigravity headless) under controller review — first live trial of the delegate.

## §0. One-sentence goal

`viberuler audit` shows how many hours of the owner's attention the sessions actually
took — wall-clock and attention-time, by day and by project — from data it already reads.

## §1. Decisions

1. **v1 scope = Claude Code transcripts only** (richest timestamps + `cwd` per entry);
   collector-agnostic core so other agents follow later. Codex/Gemini = follow-up.
2. **Two honest numbers**: `wallMs` (first→last timestamp per session, summed) and
   `activeMs` (sum of inter-event intervals ≤ idle gap; longer gaps = owner away, not
   counted). Default gap **3 min**, flag `--idle-gap <minutes>`.
3. **Agent-vs-human split is v2** — a fair attribution needs message-role analysis;
   do not ship a dishonest heuristic in v1 (METHODOLOGY «честность» rule).
4. **Display-only**: audit card section + `--json` field `time`. The submit payload
   (frozen 12 fields), VIBE formula, D1 schema — untouched.
5. Project attribution = `cwd` field of transcript entries → basename; day bucketing
   = local midnight (owner-facing, consistent with wrapped.ts style).

## §2. Architecture

```
packages/cli/src/time.ts          — pure core: analyzeTimestamps(ts[], gapMs) → {wallMs, activeMs};
                                    timeEventsFromClaudeJsonl(content) → {ts, cwd|null}[]
packages/cli/src/collectors/... reuse: walk ~/.claude/projects JSONL (same PROJECTS roots
                                    as claude-code.ts) → per-file events → per-day/per-project
audit.ts                          — collectTime(ctx, gapMs) wired in; render-audit.ts section;
bin/cli                           — --idle-gap flag; --json adds `time`
```

## §3. Invariants

- Payload/scoring untouched (display-only) — the S4 tokPerLoc precedent.
- Never negative intervals (clock skew → clamp to 0); sessions spanning midnight split
  at local midnight for the day buckets.
- Fail-open: unreadable file/line → skip, never crash audit.
- No new runtime deps (picocolors stays the only one).

## §4. Tests (vitest, fixtures in-line)

1. analyzeTimestamps: dense chain → active≈wall; gap > threshold excluded; single
   event → 0/0; unsorted input sorted; negative skew clamped.
2. timeEventsFromClaudeJsonl: extracts ts+cwd, skips malformed lines, ignores
   entries without timestamp.
3. Day split across local midnight; project attribution by cwd basename.
4. audit --json contains `time` with expected shape; card renders hours.

## §5. Out of scope (v1)

Codex/Gemini/Cursor time, agent-vs-human split, board/payload/OG surfaces,
Vibe Wrapped integration.
