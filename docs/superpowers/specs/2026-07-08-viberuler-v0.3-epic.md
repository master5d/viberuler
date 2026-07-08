# Epic: v0.3 «Sharpshooter» — efficiency + integrity release

**Thesis (from 2026-07-08 deep research):** tokscale (~4.2k ⭐) ranks by token volume, viberank ranks by dollars spent, WakaTime serves teams. Nobody measures *efficiency and shipped results*. VibeRuler v0.3 doubles down on the one axis competitors can't copy without re-architecting: **tokens vs. code that actually shipped**, plus the most trustworthy leaderboard in the category. Positioning line: *they rank whales, we rank sharpshooters.*

**Out of scope (explicitly):** Windsurf & Aider collectors (no prior art anywhere — pure reverse-engineering, stays in backlog as #3/#4); sponsorware/monetization (post-v0.3); collector-count parity with tokscale (a race we skip on purpose).

Slices are independently shippable; order below = recommended sequence. Each slice gets its own plan via writing-plans before implementation.

---

## S1 · Pricing hygiene (S)

The foundation every token metric stands on. From ccusage's own bug tracker: applying *current* prices retroactively drifts historical scores; Claude Code mostly uses 1-hour (2×) cache writes while naive tables assume 5-min (1.25×).

- Snapshot the PRICES table per release; state the snapshot date in METHODOLOGY.
- Handle cache-write tiers explicitly (1h×2 vs 5min×1.25) or document the chosen simplification.
- Regression test: known usage fixture → exact expected cost.

**Acceptance:** METHODOLOGY «Cost model» has a price-snapshot date + cache-write policy; tests pin costs.
**Deps:** none. **Do first** — S2/S3/S6 all price through this table.

## S2 · Cline-family collector (M) — 1 parser, 3 agents

Highest-ROI collector: Cline, Roo Code, KiloCode share one on-disk format. Verified 3-0 against tokscale + codeburn + Cline's own source.

- Parse `globalStorage/<ext-id>/tasks/<taskId>/ui_messages.json`: entries `type:"say", say:"api_req_started"`, token payload is **JSON-inside-JSON** in the `text` field (tokensIn/tokensOut/cacheReads/cacheWrites/cost).
- Extension IDs: `saoudrizwan.claude-dev`, `cline.cline` (?verify), `rooveterinaryinc.roo-cline`, `kilocode.kilo-code`; VS Code + Insiders + VSCodium storage roots; also `~/.cline/data`.
- Storage root injectable via env (multi-root story, #9) so tests are OS-independent.
- Cost: trust logged `cost`, else price table (S1).

**Acceptance:** real tokens from a fixture mirroring the real layout; 3-OS-safe tests; PRIVACY/METHODOLOGY rows.
**Deps:** S1. **Note:** PR #7 in flight — review already points the contributor at exactly this; shepherd it or supersede with credit.

## S3 · Gemini CLI collector (S/M) — closes #2

Format verified on a live machine.

- `${GEMINI_DATA_DIR:-~/.gemini}/tmp/<project>/chats/session-*.jsonl` — **.jsonl, NOT .json** (a `.json` glob matches zero files); subagent sessions nest in UUID subdirs → recursive walk.
- Token objects per session: input/output/cached/thoughts/tool/total; thoughts bill as output.
- Distinguish from Antigravity (`.gemini/antigravity-cli`) — agents-roster already does; collector must not double-read.

**Acceptance:** fixture-based tests incl. nested UUID dirs; agents-roster and collector agree on detection.
**Deps:** S1.

## S4 · Shipped-efficiency metric: tokens-per-committed-line (M/L)

The differentiator. Tokens (all collectors) ÷ LoC you actually committed (git collector) — computable 100% locally; competitors have no git layer.

- CLI: compute `tokPerLoc` (guard: div-by-zero → null like tokPerUsd); card line (e.g. `🎯 84K tok per shipped line` — wording TBD in plan); `--json` field.
- Formula: **display-only in v0.3** (no VIBE weight yet — collect a release of real data first; revisit in v0.4).
- Payload/worker: extend payload with optional `tok_per_loc` (zod `.optional()`, backwards-compatible with 0.2 clients), D1 migration 0002, show on share/OG pages.
- METHODOLOGY: honest caveats (LoC is a state metric vs tokens a flow metric; `--since` interplay).

**Acceptance:** card+JSON+payload+share page all show it; 0.2 clients still submit fine; migration applied remote-first per DEPLOY.md.
**Deps:** S1; ship the payload change together with S5's server work to keep ONE schema bump.

## S5 · Verified tier + server-side plausibility (M/L)

The integrity story while the window is open (tokscale = «Level 1» validation only, viberank accepts unverified rows). Prior art: monkeytype's open-source anti-cheat.

- Server-side plausibility scoring on submit: token rate vs. GitHub account age / wall-clock since first submit, per-agent token ceilings, cross-field consistency (tokens vs cost vs breakdown), delta-vs-previous-submit velocity.
- `sus_reason` persisted + visible in a (new) moderation query; sus stays stored-not-ranked (existing invariant).
- Public METHODOLOGY «Anti-cheat» section upgrade: document exactly what's checked (transparency IS the marketing).
- Board copy: «every entry GitHub-verified» — we already require device flow; say it out loud on the homepage.

**Acceptance:** fixture submits that violate each heuristic get sus=1 with reasons; honest ones pass; docs updated.
**Deps:** S4 (share one migration/schema bump).

## S6 · Cursor collector with `estimated` flag (M) — closes #1

Feasible but structurally lossy — ship honestly labeled.

- Source: `state.vscdb` SQLite in Cursor globalStorage (`cursorDiskKV`: `composerData:`/`bubbleId:` records; input tokens at `composerData.promptTokenBreakdown`). We already ship node:sqlite plumbing (litellm collector).
- **Only input tokens are recorded locally**; output estimated from reply text length (~chars/4), cache tokens unavailable → mark the whole contribution `estimated`.
- CLI: warning line + card shows Cursor in the stable; payload: estimated contributions **excluded from tok/$** (or flagged — decide in plan; protect cross-agent fairness).

**Acceptance:** parses a fixture vscdb; estimated flag surfaces in warnings + METHODOLOGY; tok/$ fairness decision documented and tested.
**Deps:** S1, S5 (fairness/sus interplay).

## S7 · Vibe Wrapped — monthly recap (M)

Virality mechanic on infra we already own (OG pipeline). WakaTime validates yearly (January timing); **nobody does monthly**.

- CLI: `viberuler wrapped [--month YYYY-MM]` → recap card (tokens, cost, tok/$, top model, busiest day, streak, new achievements this month) — all local.
- Worker: `/wrapped/:login/:YYYY-MM` share page + OG PNG variant (needs per-month aggregates in payload v2 OR render purely client-side from CLI → static share via existing /u/ page; decide in plan — default to CLI-side to avoid storing time series).
- Timing hook: ship late in a month; post «first monthly Vibe Wrapped» as its own launch beat.

**Acceptance:** recap card renders from local logs for an arbitrary month; share surface exists; zero new raw data leaves the machine.
**Deps:** none hard; nicer after S4 (can feature tok/line).

---

## Sequence & sizing

| # | Slice | Issue | Size | Closes | Depends on |
|---|-------|-------|------|--------|-----------|
| S1 | Pricing hygiene | [#12](https://github.com/master5d/viberuler/issues/12) | S | — | — |
| S2 | Cline-family collector | [#13](https://github.com/master5d/viberuler/issues/13) | M | #5 | S1 |
| S3 | Gemini CLI collector | [#14](https://github.com/master5d/viberuler/issues/14) | S/M | #2 | S1 |
| S4 | Tokens-per-committed-line | [#15](https://github.com/master5d/viberuler/issues/15) | M/L | — | S1 |
| S5 | Verified tier + plausibility | [#16](https://github.com/master5d/viberuler/issues/16) | M/L | — | S4 (shared migration) |
| S6 | Cursor collector (estimated) | [#17](https://github.com/master5d/viberuler/issues/17) | M | #1 | S1, S5 |
| S7 | Vibe Wrapped monthly | [#18](https://github.com/master5d/viberuler/issues/18) | M | — | — (best after S4) |

Milestone: [v0.3 Sharpshooter](https://github.com/master5d/viberuler/milestone/1).

Release cut: S1–S5 = v0.3 core; S6–S7 can trail as 0.3.x if momentum demands an earlier release.

## Research provenance

Deep-research run 2026-07-08: 22 sources, 25 claims adversarially verified (22 confirmed / 3 refuted). Key refuted claims that CHANGE implementation: Codex per-turn reconstruction via cumulative diffs is unreliable (keep take-LAST); ccusage does NOT already cover our open collector list. Open question before Show HN: mine HN thread 44499890 (CCLeaderboard) for sentiment on spend-bragging vs efficiency framing.
