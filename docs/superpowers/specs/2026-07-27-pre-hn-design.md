# Pre-HN slice — shareable card, time on the card, frictionless submit

> Owner 2026-07-27: «сначала фичи, потом Show HN». Diagnosis first: the leaderboard
> shows one user because D1 holds 7 rows / 1 user / 0 sus — nobody ever reached
> `--submit`. npm shows ~1019 downloads since launch, so the funnel breaks between
> "ran the CLI" and "put myself on the board". These three features attack that gap.

## §0. Goals

1. A person who runs the CLI can **share a real artifact** without OAuth, without
   `--submit`, and without a populated leaderboard.
2. The most quotable number the tool owns — **your own hours** — is on the main card,
   not buried in `audit`.
3. The path from "ran it" to "on the board" costs one obvious step, with the
   scan-dir footgun defused.

## §1. Hard constraint discovered before building

`packages/cli` has exactly **one runtime dependency** (`picocolors`) and that is a
project principle. Local PNG rendering (satori + resvg) is therefore **rejected** —
it would multiply install weight for a tool whose pitch is "npx it, nothing leaves
your machine".

**Decision (F1): render the shareable image server-side, from data in the URL.**
The worker already runs `workers-og`/satori and owns the Bureau visual identity.
New route `GET /card?d=<base64url(payload-subset)>` renders the same certificate
layout with two differences:
- a visible **`SELF-REPORTED · UNVERIFIED`** band, and
- **no rank, no percentile, no VIBE-vs-others claim** (those require the board).
Nothing is written to D1. The CLI prints the URL after the card. This keeps the
zero-dependency CLI, keeps the honesty contract (unverified data is labelled as such),
and turns every local run into a shareable link that lands on viberuler.dev.

## §2. Features

### F1 — `viberuler --share` (URL to a self-reported card)
- CLI builds the existing payload (already implemented for `--submit`), takes the
  display subset (`vibe_score, tok_per_usd, tok_per_loc, loc, streak_days, agents,
  achievements` + new `hours`), base64url-encodes compact JSON, prints:
  `https://viberuler.dev/card?d=…` plus X/LinkedIn/Bluesky share links (reuse
  `shareLinks()`).
- Guard: if the encoded string exceeds 1800 chars, drop `achievements` then `agents`
  (URL length safety), never silently truncate numbers.
- Worker `/card` validates with a zod schema mirroring the subset, clamps absurd
  values (reuse the existing sanity caps), and renders. Invalid/oversized → 400 with
  a plain message, never a broken image.

### F2 — time on the main card and on `/card`
- `renderCard` gains one line, above the achievements block:
  `⏱ 12.4h of your attention · 31.0h wall` (only when time data exists).
- Needs `runAudit`'s time report available to the card path: call the existing
  `createTimeAccumulator` walk from the main scan (the walk is already fused —
  reuse `collectTime(ctx, gapMs)`); fail-open, card renders without the line.
- `hours` (attention, rounded to 0.1) rides in the `/card` payload subset.
- **NOT** added to the submit payload / D1 / leaderboard in this slice: that is a
  schema+migration decision, deferred.

### F3 — submit friction
- After the card, print a concrete two-line CTA with the **already-resolved**
  scan dir, e.g.
  `share it:   viberuler --share` and
  `join the board:  viberuler --scan-dir <resolved> --submit`.
- Scan-dir footgun (#6 class): when the resolved scan produced `projects === 0` and
  the cwd is inside a git repo that itself contains repos, print one hint line
  naming the likely correct `--scan-dir` (the parent that holds the nested repos).
- Device-flow token reuse: if a token from a previous successful submit is cached
  (check whether `submit.ts` already caches; if not, cache it under the existing
  config home with 0600-equivalent perms), skip the device flow on later submits and
  say so. If caching does not already exist, implement it minimally — token in a
  local file, never printed, never in the payload.

## §3. Invariants

- CLI runtime deps stay at exactly one (`picocolors`).
- Default run stays zero-network. `--share` prints a URL; it does **not** call it.
- Honesty: `/card` output carries the unverified band and no rank; the verified
  certificate (`/u/:login`) stays the only ranked surface.
- Frozen submit payload (12 fields), VIBE formula, D1 schema untouched.

## §4. Tests

1. `--share` prints a URL; decoding its `d` yields the expected subset; oversize
   payload drops achievements first, then agents.
2. Card renders the time line when time exists; omits it cleanly when absent.
3. `--scan-dir` hint fires only on `projects === 0` inside a nested-repo layout.
4. Token cache: second submit path does not invoke the device flow (mocked).
5. Worker `/card`: valid `d` → 200 image; malformed/oversized → 400 text; no D1 write
   (assert via a DB stub that no query runs).

## §5. Out of scope

Board/percentile changes, adding hours to the submit payload, team leaderboards,
any new CLI dependency.
