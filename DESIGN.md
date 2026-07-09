# viberuler — DESIGN.md

> Наследует `GLOBAL_DESIGN.md` NAUTILUS (C:\telo\Efforts\Ongoing\NAUTILUS\core\desops\GLOBAL_DESIGN.md).
> Локальные расширения фиксируют ФАКТИЧЕСКУЮ визуальную ДНК проекта; core brand
> identity не переопределяется без justification (DesOps-Standard.md §4 File Organization).

## Inherited
- Structural doctrine only: `philosophy` (Meta-Designer), `roles` (Arbiter of Taste = owner),
  `ethics` (§Nerdsignalling / OG Persona), `hypermedia` (SSR HTML-string surfaces).
- Tokens NOT inherited: viberuler is a **deliberate off-SOVRN spoke** (desops-architect §6 —
  "own DESIGN.md identity → lint against ITS token set, do not repaint into SOVRN cyan").
  The NAUTILUS seed `#00D1FF` is intentionally absent. Do not flag the palette below as drift.

## Local Identity — "Bureau of Vibe Measurement"

Deadpan-metrology brand: a pompous institute certifying a scientifically meaningless
metric. Gravity applied to nonsense. Looks official → stays trustworthy (entries are
GitHub-notarized). Doctrine anchor: `ethics.md` §Nerdsignalling — design as a tribal
identity flag for the vibe-coder niche.

### Palette (token source of truth: `packages/worker/src/brand.ts` `PALETTE`)
| Token | Hex | Role |
|---|---|---|
| `base` | `#0b0e14` | page background (dark instrument) |
| `surface` | `#11151f` | card / certificate body |
| `violet` | `#b388ff` | primary — letterhead, brand mark |
| `green` | `#69f0ae` | score / VIBE / positive metric |
| `amber` | `#ffd54f` | notary / certified accent |
| `stampRed` | `#ff5252` | `UNDER REVIEW` / rank stamp |
| `ivory` | `#c9c2ad` | certificate paper text |
| `hairline` | `#2a2f3a` | borders / rules |
| `muted` | `#666` | secondary text |

Deliberate remap vs GLOBAL_DESIGN: primary cyan `#00D1FF` → violet `#b388ff`;
accent `#FF2A6D` → green `#69f0ae` / amber `#ffd54f`. This is identity, not debt.

### Typography
- Single family everywhere: `'JetBrains Mono', ui-monospace, Consolas, monospace`
  (inherited mono token, promoted to display). No sans. Reinforces "technical instrument".
- Letterhead = UPPERCASE + wide letter-spacing. Small-caps subheads. Document hairline rules.

### Signature elements (differentiated-design hooks)
- **VR seal** — circular notary stamp, VR monogram whose R-leg is a tick-marked ruler,
  ring text `BUREAU OF VIBE MEASUREMENT · CERTIFIED · 2026`, violet→green gradient.
- **Vibe gauge** — horizontal ruler; fill = `clamp(round(vibe/8000·cells),0,cells)`;
  fixed absurd scale `hello world → a CRUD app → a wrapper → another wrapper →
  an AI startup → AGI (by accident)`.
- **Guilloché paper** — CSS security-paper texture (`.paper`) on cards/certificates.

### Density / stance
Content-first, screenshot-optimized (share screens are the viral asset). Dark theme
only — the brand commits to the instrument look; no light variant.

### Surfaces
Cloudflare Worker HTML-string SSR (`packages/worker/src/routes/*` + `brand.ts`) and a
46-char monospace CLI card (`packages/cli/src/render.ts`). No React/Tailwind — `ui-kit`
primitives N/A; the "semantic token" rule is satisfied by centralizing hex in `brand.ts`.

Spec: `docs/superpowers/specs/2026-07-09-viberuler-bureau-revamp-design.md`.
