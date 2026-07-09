# VibeRuler — "Bureau of Vibe Measurement" Design Revamp

**Status:** approved concept, spec for review
**Date:** 2026-07-09
**Scope:** presentation layer only (worker HTML/SVG/OG surfaces + CLI card copy). No scoring, payload, DB, or collector changes.

## Goal

Give VibeRuler a signature, instantly-recognizable visual identity so its share
screens read as a coherent brand rather than a plain leaderboard. The identity is
a **deadpan metrology institute** — "The International Bureau of Vibe Measurement"
— that certifies, with the utmost pomp, a metric that is scientifically
meaningless. Gravity applied to nonsense is the joke. It looks official, so it
stays trustworthy (Trust matters: entries are GitHub-notarized).

## Non-Goals (frozen — do NOT touch)

- The VIBE formula and every component of it (`score.ts` breakdown math).
- The submit payload (10 frozen keys) and its zod validation.
- The D1 schema, migrations, and server-side plausibility scoring.
- Any collector (`collectors/*`).
- The existing `RANK_TABLE` in `score.ts`. The established ranks
  (`Prompt Peasant` → `Vibe Apprentice` → `Token Burner` → `Context Goblin` →
  `Ship Machine` → `GIGACHAD SHIPPER` → `Singularity Adjacent`, plus the
  `NPC (no vibes detected)` sentinel) are shipped, tested, and already on the
  board. The revamp **reframes** them in Bureau voice; it does not rename them.
  This keeps one source of truth for ranks.

## Global Constraints (bind every task, verbatim values)

- **Palette:** base `#0b0e14`; violet `#b388ff`; green `#69f0ae`; notary amber
  `#ffd54f`; stamp red `#ff5252`; certificate ivory `#c9c2ad`; hairline
  `#2a2f3a`; muted text `#666`.
- **Typography:** `'JetBrains Mono', ui-monospace, Consolas, monospace`
  everywhere. Letterhead text is `text-transform:uppercase` with wide
  `letter-spacing`.
- **Signature fixtures (used identically across surfaces):**
  - Seal ring text: `BUREAU OF VIBE MEASUREMENT · CERTIFIED · 2026`
  - Certificate sign-off: `— The Bureau · calibrated to ±0.001 vibes`
  - Meaningless-anyway disclaimer: `This measurement is scientifically meaningless. Notarized anyway.`
  - Trust line: `Every certificate is GitHub-notarized (device-flow OAuth).`
  - Watermark / CTA: `npx viberuler`
- **Gauge scale labels (fixed, decorative, left→right):**
  `hello world` · `a CRUD app` · `a wrapper` · `another wrapper` ·
  `an AI startup` · `AGI (by accident)`
- **Gauge fill math (shared with the existing CLI bar):** `filled =
  clamp(round(vibe / 8000 * cells), 0, cells)`.
- **Sus invariant:** on every surface, `row.sus` hides the numeric score
  (`—`) and shows the `UNDER REVIEW` stamp — score, tok/$, tok/line all
  suppressed. Never regress this on any surface.
- **Privacy invariant:** default `viberuler` run is zero-network; nothing new
  phones home. The revamp is render-only.
- Existing tests must stay green; `npm run typecheck` must pass; the worker
  test suite and CLI suite both run in CI on Node 22 / 3 OS.

## Shared module: `packages/worker/src/brand.ts` (new)

Single source of truth for the identity, imported by `favicon.ts`, `home.ts`,
`og.ts`, `share.ts`. Pure functions returning strings — no I/O, no request
state. Exports:

- `PALETTE` — the hex constants above as a frozen object.
- `SEAL_SVG(size: number): string` — the circular VR seal: dark tile, VR
  monogram whose `R` leg extends into a tick-marked ruler, violet→green
  gradient, ring text `BUREAU OF VIBE MEASUREMENT · CERTIFIED · 2026` placed
  on a `<textPath>` around a circle. Deterministic; no external refs.
- `guillochéCss(): string` — a CSS snippet (a `repeating-linear-gradient`
  + faint radial) producing the security-paper texture for card backgrounds.
  Named class `.paper`.
- `gaugeHtml(vibe: number, opts?: {sus?: boolean}): string` — the horizontal
  ruler-gauge as inline-styled HTML (satori-safe: explicit px, `display:flex`
  on every div, no `%` widths on the satori root). Renders ticks, a filled
  segment to `filled/cells`, and the fixed scale labels underneath. When
  `sus`, renders an empty gauge with a `— UNDER REVIEW —` band. Web/OG only —
  the full labeled gauge needs horizontal room the 46-char CLI card lacks.
- `certifyLine(rank: string): string` — `The Bureau hereby certifies this
  subject as: ${rank.toUpperCase()}` (rank comes from the CLI/DB, unchanged).

`brand.ts` has no worker-runtime dependency and is unit-testable in the worker
vitest pool without a request.

## Surfaces

### 1. `favicon.ts`
Replace the current ad-hoc ruler mark with `SEAL_SVG(64)`. Keep the same
response headers and the `/favicon.svg` + `/favicon.ico` routing. The `.ico`
path returns the same SVG bytes (documented existing behavior).

### 2. `home.ts` — the Bureau letterhead landing
- `.paper` guilloché background on the hero card and the standings table
  container.
- Hero: centered `SEAL_SVG` mark, then letterhead
  `THE INTERNATIONAL BUREAU OF VIBE MEASUREMENT`, sub
  `The official, peer-reviewed-by-nobody standard for how hard you actually vibe.`
- Copy-to-clipboard `npx viberuler` card, sub `submit your rig for certification`.
- Existing totals line reframed: `${users} coder(s) certified · ${tokens} tokens on record`.
- Trust line (Global Constraints value).
- Section header `OFFICIAL STANDINGS`, then the existing top-25 table with a new
  `title` column showing each row's rank (compute rank from `vibe_score` via a
  worker-local copy of the rank thresholds — see "Rank on the server" below).
- Footer: disclaimer line + existing GitHub/Methodology/Privacy/API links.

### 3. `og.ts` — the certificate share image (1200×630)
Recompose as `CERTIFICATE OF VIBE MEASUREMENT`: guilloché-style border, seal in
a corner, `subject: @login`, large VIBE number, `gaugeHtml`, `GLOBAL RANK #N`,
the certified rank title, sign-off line, `npx viberuler` watermark. Preserve the
sus branch (`UNDER REVIEW`, `—`) and the font-loading mechanism exactly.

### 4. `share.ts` — `/u/:login` as a certificate page
Restyle the card as a certificate: `.paper` background, seal, `subject` framing,
`gaugeHtml`, certified rank, sign-off. Keep the OG meta wiring, the 404 "NPC"
branch (reworded to Bureau voice: `404 — subject not on file`), and the sus
branch. Keep the `npx viberuler` CTA.

### Rank on the server
The board/OG/share need a rank title from a `vibe_score`, but the canonical
`RANK_TABLE` lives in the CLI package (`score.ts`). To avoid a cross-package
import, add a tiny `rankForVibe(vibe: number): string` to `brand.ts` whose
thresholds/labels are copied verbatim from `score.ts` `RANK_TABLE`, with a
comment pointing at the source and a test asserting the two tables agree
(the worker test imports the CLI `RANK_TABLE` as fixture data only, or the
values are duplicated in the test). One source of truth stays `score.ts`; the
copy is guarded by a test so drift fails CI.

### 5. CLI `render.ts` + `wrapped.ts` — Bureau voice (light touch)
- Header line gains a small letterhead flavor without breaking width: keep
  `VIBERULER v${version}` but add a dim sub-line `· bureau of vibe measurement`.
- Keep the existing `bar()` gauge as-is — it fits `WIDTH=46` and works. The
  labeled signature gauge is web/OG only; the CLI card stays compact.
- `RANK: X` line becomes the certify line `THE BUREAU CERTIFIES: <RANK>` when
  data exists; NPC branch unchanged.
- Keep all existing stat lines and emojis; this is copy, not data.
- `wrapped.ts` recap gains the same letterhead sub-line and sign-off; its
  achievement-filtering honesty behavior is unchanged.

The CLI change is cosmetic string output and needs no shared module — it edits
its own literals in `render.ts`/`wrapped.ts`. The CLI must not import from the
worker package. The certify-line copy is duplicated as a spec value here; a CLI
test pins the rendered wording.

## Voice / copy bank (deadpan-official)
- Landing sub: `The official, peer-reviewed-by-nobody standard for how hard you actually vibe.`
- Disclaimer: `This measurement is scientifically meaningless. Notarized anyway.`
- Certificate sign-off: `— The Bureau · calibrated to ±0.001 vibes`
- 404: `404 — subject not on file. This coder has not submitted for certification.`
- Submit CTA: `submit your rig for certification`

## Testing

- `brand.test.ts` (worker): `SEAL_SVG` returns well-formed SVG containing the
  ring text and a gradient; `gaugeHtml` fill count matches the shared math for
  representative scores incl. 0 and ≥8000 (clamped); `gaugeHtml(sus)` shows the
  review band and no number; `rankForVibe` agrees with `score.ts` `RANK_TABLE`
  at every threshold boundary; `certifyLine` uppercases.
- `home`, `share`, `og` route tests: assert the sus branch still suppresses the
  score; assert the letterhead/seal/disclaimer strings render; assert the
  standings `title` column appears. Reuse the existing worker route test
  harness (`applyD1Migrations`, `env.DB`, seeded rows).
- CLI `render.test.ts` / `wrapped.test.ts`: assert the card still fits width,
  the certify line renders the rank, the letterhead sub-line appears, and the
  NPC branch is unchanged. Width assertions as the existing tests do.
- Full `npm run typecheck` before merge (vitest is transpile-only — the
  recorded lesson).

## Deploy

Worker surfaces: `npx wrangler deploy` from `packages/worker` after CI green
(no migration — presentation only). CLI copy ships in the next npm publish
(patch bump, owner-gated passkey). Version: bump CLI to `0.3.1` since the card
output changes; worker needs no version.

## Out of scope / deferred
- Animated gauge fill, sound, or interactivity — YAGNI for launch.
- New rank titles — deferred; existing ladder reframed, not replaced.
- Light-theme variant — the brand commits to the dark instrument look.
