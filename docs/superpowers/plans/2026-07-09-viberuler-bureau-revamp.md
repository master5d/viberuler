# VibeRuler "Bureau of Vibe Measurement" Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin VibeRuler's public surfaces (favicon, landing, share image, /u/:login, CLI card) into the deadpan "Bureau of Vibe Measurement" identity, driven by one shared brand module. Presentation only.

**Architecture:** A new pure-string module `packages/worker/src/brand.ts` is the single source of truth for the identity (palette, VR seal SVG, guilloché CSS, vibe gauge, rank title, certify line). The four worker route handlers import it; the CLI card gets a parallel light-touch copy change (no cross-package import). No scoring, payload, DB, or collector code changes.

**Tech Stack:** TypeScript ESM, Cloudflare Workers (HTML-string SSR), `workers-og` (satori) for the OG image, vitest + `@cloudflare/vitest-pool-workers` for the worker, plain vitest for the CLI.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-07-09-viberuler-bureau-revamp-design.md`). Every task's requirements implicitly include this section.

- **Palette (hex, exact):** base `#0b0e14`; surface `#11151f`; violet `#b388ff`; green `#69f0ae`; notary amber `#ffd54f`; stamp red `#ff5252`; certificate ivory `#c9c2ad`; hairline `#2a2f3a`; muted `#666`.
- **Font stack everywhere:** `'JetBrains Mono', ui-monospace, Consolas, monospace`. Letterhead text is `text-transform:uppercase` with wide `letter-spacing`.
- **Signature fixtures (identical across surfaces, verbatim strings):**
  - Seal ring text: `BUREAU OF VIBE MEASUREMENT` (arced) + `CERTIFIED · 2026` (straight, amber).
  - Certificate sign-off: `— The Bureau · calibrated to ±0.001 vibes`
  - Disclaimer: `This measurement is scientifically meaningless. Notarized anyway.`
  - Trust line: `Every certificate is GitHub-notarized (device-flow OAuth).`
  - Watermark / CTA: `npx viberuler`
  - Certify line: `The Bureau certifies: <RANK>` (rank uppercased).
- **Gauge scale labels (fixed, left→right):** `hello world` · `a CRUD app` · `a wrapper` · `another wrapper` · `an AI startup` · `AGI (by accident)`.
- **Gauge fill math (shared with CLI bar):** `filled = clamp(round(vibe / 8000 * cells), 0, cells)`.
- **Sus invariant:** on every surface `row.sus` hides the numeric score (`—`) and shows the `UNDER REVIEW` stamp — score, tok/$, tok/line all suppressed. Never regress.
- **Frozen — do NOT touch:** VIBE formula, submit payload (10 keys), zod validation, D1 schema/migrations, plausibility scoring, every `collectors/*`, and the existing `RANK_TABLE` in `packages/cli/src/score.ts` (reframed in Bureau voice, never renamed).
- **Privacy:** default `viberuler` run stays zero-network. Render-only change.
- **Green bar:** existing worker + CLI suites stay green; `npm run typecheck` passes before merge (vitest is transpile-only).
- **Canonical seal art:** `design/drafts/seal-notary.svg` (variation A, approved). `SEAL_SVG` reproduces it.

---

### Task 1: `brand.ts` — the shared identity module

**Files:**
- Create: `packages/worker/src/brand.ts`
- Test: `packages/worker/test/brand.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2–5):
  - `PALETTE: Readonly<Record<'base'|'surface'|'violet'|'green'|'amber'|'stamp'|'ivory'|'hairline'|'muted', string>>`
  - `SEAL_SVG(size: number, opts?: { ring?: boolean }): string` — full seal when `ring` (default true); bold-VR + dashed tick bezel, no ring text, when `ring:false` (favicon-legible).
  - `guillocheCss(): string` — returns a CSS string defining `.paper { ... }`.
  - `gaugeHtml(vibe: number, opts?: { sus?: boolean }): string` — satori-safe inline-styled HTML (explicit px, `display:flex` on every div).
  - `rankForVibe(vibe: number): string` — thresholds copied verbatim from `score.ts` `RANK_TABLE`.
  - `certifyLine(rank: string): string` → `The Bureau certifies: ${rank.toUpperCase()}`.
  - `SCALE_LABELS: readonly string[]` and `GAUGE_CELLS = 16`.

- [ ] **Step 1: Write failing tests** `packages/worker/test/brand.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { PALETTE, SEAL_SVG, guillocheCss, gaugeHtml, rankForVibe, certifyLine, SCALE_LABELS, GAUGE_CELLS } from '../src/brand.js';

const filled = (v: number) => Math.max(0, Math.min(GAUGE_CELLS, Math.round((v / 8000) * GAUGE_CELLS)));

describe('brand', () => {
  it('palette has the frozen hexes', () => {
    expect(PALETTE.violet).toBe('#b388ff');
    expect(PALETTE.green).toBe('#69f0ae');
    expect(PALETTE.amber).toBe('#ffd54f');
    expect(PALETTE.base).toBe('#0b0e14');
  });

  it('full seal carries ring text and a gradient', () => {
    const svg = SEAL_SVG(200);
    expect(svg).toContain('<svg');
    expect(svg).toContain('BUREAU OF VIBE MEASUREMENT');
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('CERTIFIED');
  });

  it('favicon seal drops ring text but keeps the VR mark', () => {
    const svg = SEAL_SVG(64, { ring: false });
    expect(svg).toContain('>VR<');
    expect(svg).not.toContain('BUREAU OF VIBE MEASUREMENT');
  });

  it('guilloche css defines the paper class', () => {
    expect(guillocheCss()).toContain('.paper');
  });

  it('gauge fill count tracks the shared math', () => {
    for (const v of [0, 2000, 5343, 8000, 12000]) {
      const html = gaugeHtml(v);
      const cells = (html.match(/data-cell="fill"/g) ?? []).length;
      expect(cells).toBe(filled(v));
    }
  });

  it('sus gauge shows the review band and no number', () => {
    const html = gaugeHtml(5343, { sus: true });
    expect(html).toContain('UNDER REVIEW');
    expect(html).not.toContain('5,343');
    expect(html).not.toContain('5343');
  });

  it('gauge renders the fixed absurd scale', () => {
    const html = gaugeHtml(5343);
    for (const label of SCALE_LABELS) expect(html).toContain(label);
    expect(SCALE_LABELS[0]).toBe('hello world');
    expect(SCALE_LABELS[SCALE_LABELS.length - 1]).toBe('AGI (by accident)');
  });

  // RANK_TABLE thresholds duplicated here as fixture — SOURCE OF TRUTH is
  // packages/cli/src/score.ts RANK_TABLE. If this drifts, fix brand.ts to match score.ts.
  it('rankForVibe agrees with score.ts RANK_TABLE at boundaries', () => {
    expect(rankForVibe(8000)).toBe('Singularity Adjacent');
    expect(rankForVibe(6500)).toBe('GIGACHAD SHIPPER');
    expect(rankForVibe(5000)).toBe('Ship Machine');
    expect(rankForVibe(3500)).toBe('Context Goblin');
    expect(rankForVibe(2000)).toBe('Token Burner');
    expect(rankForVibe(800)).toBe('Vibe Apprentice');
    expect(rankForVibe(0)).toBe('Prompt Peasant');
  });

  it('certify line uppercases the rank', () => {
    expect(certifyLine('Ship Machine')).toBe('The Bureau certifies: SHIP MACHINE');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd packages/worker && npx vitest run test/brand.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `packages/worker/src/brand.ts`**

Use the canonical seal art in `design/drafts/seal-notary.svg` for the `ring:true` branch (parameterize the outer `viewBox`/size; keep the internal 0 0 200 200 coordinate system via `viewBox` and set width/height to `size`). For `ring:false`, emit: dark disc, violet outer ring, amber dashed tick bezel (`stroke-dasharray="1 8"`), and a bold gradient `VR` — no `<textPath>`. Escape the `·` as `&#183;` inside SVG text. Key shape:

```ts
export const PALETTE = Object.freeze({
  base: '#0b0e14', surface: '#11151f', violet: '#b388ff', green: '#69f0ae',
  amber: '#ffd54f', stamp: '#ff5252', ivory: '#c9c2ad', hairline: '#2a2f3a', muted: '#666',
});

export const GAUGE_CELLS = 16;
export const SCALE_LABELS = [
  'hello world', 'a CRUD app', 'a wrapper', 'another wrapper', 'an AI startup', 'AGI (by accident)',
] as const;

// SOURCE OF TRUTH: packages/cli/src/score.ts RANK_TABLE. Keep in lockstep (guarded by brand.test.ts).
const RANK_TABLE: Array<[number, string]> = [
  [8000, 'Singularity Adjacent'], [6500, 'GIGACHAD SHIPPER'], [5000, 'Ship Machine'],
  [3500, 'Context Goblin'], [2000, 'Token Burner'], [800, 'Vibe Apprentice'],
];
export function rankForVibe(vibe: number): string {
  for (const [min, name] of RANK_TABLE) if (vibe >= min) return name;
  return 'Prompt Peasant';
}
export const certifyLine = (rank: string) => `The Bureau certifies: ${rank.toUpperCase()}`;

function gaugeFill(vibe: number): number {
  return Math.max(0, Math.min(GAUGE_CELLS, Math.round((vibe / 8000) * GAUGE_CELLS)));
}
```

`gaugeHtml` renders `GAUGE_CELLS` cells; the first `gaugeFill(vibe)` cells carry `data-cell="fill"` and a violet→green background, the rest a surface background; the score sits at the right as `toLocaleString('en-US')`; `SCALE_LABELS` render underneath in a flex row. When `sus`, render an empty track with a centered `— UNDER REVIEW —` band and NO number. Every div uses `display:flex` and explicit px (satori-safe). `SEAL_SVG`/`guillocheCss` are plain template strings.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/brand.test.ts` → PASS. Then `cd packages/worker && npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `git add packages/worker/src/brand.ts packages/worker/test/brand.test.ts && git commit -m "feat(worker): brand.ts — Bureau identity module (seal, gauge, palette, ranks)"`

---

### Task 2: favicon → VR seal

**Files:**
- Modify: `packages/worker/src/routes/favicon.ts`
- Test: `packages/worker/test/favicon.test.ts` (create if absent)

**Interfaces:** Consumes `SEAL_SVG` from Task 1.

- [ ] **Step 1: Write failing test** — assert the favicon response is `image/svg+xml`, status 200, body contains `>VR<` and does NOT contain `BUREAU OF VIBE MEASUREMENT` (favicon uses `ring:false`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — replace `FAVICON_SVG` with `SEAL_SVG(64, { ring: false })`; keep the exact response headers and both `/favicon.svg` + `/favicon.ico` routing already wired in the router.
- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(worker): favicon = VR notary seal`.

---

### Task 3: landing page → Bureau letterhead

**Files:**
- Modify: `packages/worker/src/routes/home.ts`
- Test: `packages/worker/test/home.test.ts` (extend existing if present)

**Interfaces:** Consumes `SEAL_SVG`, `guillocheCss`, `PALETTE`, `rankForVibe` from Task 1.

- [ ] **Step 1: Write failing tests** — seed rows via the existing worker test harness (`applyD1Migrations`, `env.DB`); assert the response HTML contains: `THE INTERNATIONAL BUREAU OF VIBE MEASUREMENT`, `OFFICIAL STANDINGS`, the disclaimer string, the trust line string, a `.paper` style block, and — for a seeded row — its `rankForVibe` title in the standings. Assert an empty board still renders the empty-state line.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — rebuild `HOME_CSS` from `PALETTE` + `guillocheCss()`; hero = centered `SEAL_SVG(96)` + letterhead + sub `The official, peer-reviewed-by-nobody standard for how hard you actually vibe.`; `npx viberuler` copy card with sub `submit your rig for certification`; totals reframed `${users} coder(s) certified · ${tokens} tokens on record`; trust line; `OFFICIAL STANDINGS` heading; the existing top-25 table gains a `certified as` column = `rankForVibe(r.vibe_score)`; footer disclaimer + existing links. Keep all data queries and the `fmtCompact`/`fmtInt` helpers unchanged.
- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(worker): Bureau letterhead landing + OFFICIAL STANDINGS`.

---

### Task 4: OG image → certificate

**Files:**
- Modify: `packages/worker/src/routes/og.ts`
- Test: `packages/worker/test/og.test.ts` (extend existing if present)

**Interfaces:** Consumes `gaugeHtml`, `rankForVibe`, `certifyLine`, `PALETTE` from Task 1.

- [ ] **Step 1: Write failing tests** — for a seeded non-sus row assert the handler returns 200 `image/png` (the existing test pattern); for a sus row assert the composed HTML branch shows `UNDER REVIEW` and not the number. (Assert on the pre-satori HTML string if the handler is refactored to build it via a testable helper; otherwise assert status/content-type and keep a helper-level unit test for the certificate HTML.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — recompose the satori HTML as `CERTIFICATE OF VIBE MEASUREMENT`: guilloché-tone border, `subject: @login`, large VIBE (`PALETTE.green`), `gaugeHtml(vibe)`, `GLOBAL RANK #N` (`PALETTE.stamp`), `certifyLine(rankForVibe(vibe))` (`PALETTE.amber`), sign-off line, `npx viberuler` watermark. Preserve the sus branch (`—`, `UNDER REVIEW`) and the exact `ImageResponse` + font-loading mechanism. Keep satori rules (explicit px, `display:flex` on every div).
- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(worker): OG image = certificate of vibe measurement`.

---

### Task 5: /u/:login → certificate page

**Files:**
- Modify: `packages/worker/src/routes/share.ts`
- Test: `packages/worker/test/share.test.ts` (extend existing if present)

**Interfaces:** Consumes `SEAL_SVG`, `guillocheCss`, `gaugeHtml`, `rankForVibe`, `certifyLine`, `PALETTE` from Task 1.

- [ ] **Step 1: Write failing tests** — non-sus row: HTML contains the certificate framing (`subject`), `certifyLine` title, `.paper`, and preserves the OG meta tags. Sus row: contains `UNDER REVIEW`, hides the number and tok/$ and tok/line. Missing row: 404 with `subject not on file` (Bureau-voice, replacing "NPC detected"). Assert the `npx viberuler` CTA remains.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — restyle `PAGE_CSS` from `PALETTE` + `guillocheCss()`; card becomes a certificate: `SEAL_SVG(78)`, `subject: @login`, VIBE, `gaugeHtml`, `certifyLine(rankForVibe(vibe))`, sign-off; keep the sus branch, the OG `<meta>` wiring, and the 404 branch (reworded). Keep the `escapeHtml` export (imported elsewhere) intact.
- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(worker): /u/:login = certificate page`.

---

### Task 6: CLI card → Bureau voice (light touch)

**Files:**
- Modify: `packages/cli/src/render.ts`, `packages/cli/src/wrapped.ts`
- Test: `packages/cli/test/render.test.ts`, `packages/cli/test/wrapped.test.ts`

**Interfaces:** No import from the worker package. The certify-line wording is duplicated here as a spec value: `THE BUREAU CERTIFIES: <RANK>`.

- [ ] **Step 1: Write failing tests** — `render.test.ts`: for a data-bearing report the card contains a dim sub-line `· bureau of vibe measurement` and the line `THE BUREAU CERTIFIES: ` followed by the uppercased rank (replacing the old `RANK:` line); the NPC branch is unchanged; every rendered line still fits `WIDTH`. `wrapped.test.ts`: recap contains the letterhead sub-line and the sign-off; achievement-filtering behavior unchanged.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in `render.ts` add the dim sub-line under the version header; replace the `RANK: X` line with `THE BUREAU CERTIFIES: ${rankDisplay}` when data exists (NPC branch keeps its own line). Keep `bar()`, all stat lines, emojis, and `WIDTH=46`. In `wrapped.ts` add the same dim sub-line and a sign-off `— The Bureau · calibrated to ±0.001 vibes`. Copy only; no data changes.
- [ ] **Step 4: Run → PASS** — `cd packages/cli && npx vitest run` and `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(cli): Bureau voice on the score card + wrapped`.

---

## Post-tasks (controller, after all task reviews clean)

1. Bump `packages/cli/package.json` version to `0.3.1` (card output changed).
2. Root `npm run -ws typecheck` (or per-package) + full `npm test` both packages.
3. Final whole-branch review (opus) via requesting-code-review.
4. DesOps `/design-audit` semantics: run `lint-design.ps1 -Path packages` (expect clean — .ts), do a WCAG contrast check on the palette pairings (violet/green/amber/ivory on `#0b0e14`; muted `#666` on surface — verify ≥ 4.5:1 for body, ≥ 3:1 for large/UI; if `#666` on `#0b0e14` fails body contrast, lift muted to the smallest passing value and note it in `DESIGN.md`), and append `2026-07-09 design-audit: bureau revamp — <result>` to `logs/desops.log`.
5. `finishing-a-development-branch`: deploy worker (`npx wrangler deploy`, no migration), then the npm publish (0.3.1) is owner-gated (passkey).

## Self-Review notes
- Spec coverage: favicon (T2), home (T3), og (T4), share (T5), CLI (T6), shared module incl. gauge/seal/rank/certify (T1) — all spec surfaces mapped.
- Rank duplication is guarded by a boundary test in T1; `score.ts` remains the single source of truth.
- Sus invariant asserted in T3? (board doesn't show per-row sus scores) — sus is a per-submission flag surfaced on og/share; T4 and T5 assert it. Home shows only ranked rows, unaffected.
- `#666` muted-on-dark contrast is the one real risk; the post-task WCAG step catches and fixes it rather than baking a failing value.
