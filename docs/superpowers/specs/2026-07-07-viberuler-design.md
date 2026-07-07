# VibeRuler — Design Spec

**Date:** 2026-07-07
**Status:** approved design, pre-implementation
**One-liner:** `npx viberuler` — scan your rig, get your Vibe Score, flex it on the global leaderboard. The benchmark for vibe coders: LoC shipped, projects, tokens burned, and the headline metric — **tokens per dollar**.

## Goals

1. Top GitHub trending ("project of the day") via a geek-maximalist release.
2. Self-sustaining virality loop: run → score card → share → viewer runs it.
3. Honest, transparent methodology (meme facade, auditable math).

## Decisions (locked)

| Decision | Choice |
|---|---|
| Form factor | CLI: `npx viberuler` (TypeScript, Node ≥18) |
| Data sources v1 | Claude Code logs, local git repos, Codex/Cursor/Gemini (best-effort), GitHub API (optional) |
| Leaderboard | Global, opt-in submit of aggregates only; CF Worker + D1 |
| Identity | GitHub Device Flow OAuth (1 account = 1 entry) |
| Tone | Meme-maximalism (ranks, achievements) + strict METHODOLOGY.md |
| Repo layout | Single public monorepo: `packages/cli` + `packages/worker` |

## 1. Product core

### Metrics

| Metric | Source | Card flex |
|---|---|---|
| `projects` | git scan (+GitHub API) | "47 projects" |
| `loc_shipped` | `git ls-files` + line counts per language | "312K LoC" |
| `commits`, `streak_days` | `git log --author=<user.email>` across repos | "212-day streak" |
| `tokens_total` | Claude Code JSONL usage (+Codex/Cursor/Gemini) | "1.2B tokens" |
| `cost_usd` | tokens × model price table (ccusage-style) | "$184 burned" |
| `tokens_per_dollar` | tokens_total / cost_usd | **headline benchmark**: "6.5M tok/$" |

### Score formula (published in METHODOLOGY.md)

```
VIBE = 1000 · log10(1 + LoC/1000)        // shipping volume
     +  500 · log10(1 + tokens/1M)       // AI leverage
     +  800 · efficiency_percentile      // tokens/$ percentile vs global D1 data (0..1)
     +  300 · log10(1 + projects·10)     // breadth
     +  streak_bonus                     // min(streak_days, 365)
     +  achievement_sum                  // 50 pts per achievement
```

Logarithms compress whales and leave headroom for newcomers. `efficiency_percentile` comes from the leaderboard API when online; offline fallback = fixed reference curve baked into the CLI (updated each release).

### Ranks (by VIBE score, thresholds tuned during implementation on real data)

`Prompt Peasant → Vibe Apprentice → Token Burner → Context Goblin → Ship Machine → GIGACHAD SHIPPER → Singularity Adjacent`

Zero data detected → rank `NPC (no vibes detected)` + hints on what the scanner looks for.

### Achievements (computed locally, shown as badges)

`3AM Committer`, `YOLO Force Pusher` (force-push found in reflog/log), `Cache Whisperer` (>90% cache-read ratio), `Polyglot` (5+ languages), `Token Billionaire` (≥1B tokens), `Free Tier Martyr` (<$1 total spend with ≥1M tokens), `Monorepo Menace` (repo >100K LoC), `Streak Freak` (≥100-day streak). Extensible list; each = id + emoji + predicate over RawStats.

### Virality loop

1. `npx viberuler` → ANSI card in terminal (screenshot-bait).
2. `--submit` → GitHub device flow → aggregates pushed → personal URL `viberuler.dev/u/<login>` with OG image, global rank, percentile.
3. CLI prints prefilled share intents (X / LinkedIn / Bluesky): "I burned 1.2B tokens for $184. What's your Vibe Score? npx viberuler".
4. Share page has a giant copy-button `npx viberuler` → GOTO 1.

## 2. CLI (`packages/cli`)

**Stack:** TypeScript, Node ≥18, bundled to a single file with `tsup`. Startup <2 s. Minimal deps: `picocolors` + tiny arg parsing (no heavy frameworks) — small supply-chain surface.

### Collector plugin architecture

```ts
interface Collector {
  id: 'claude-code' | 'codex' | 'cursor' | 'gemini' | 'git' | 'github';
  detect(): Promise<boolean>;              // data present on this machine?
  collect(ctx: ScanContext): Promise<Partial<RawStats>>;
}
```

- **claude-code**: scan `~/.claude/projects/**/*.jsonl`; read `message.usage` (input / output / cache_creation / cache_read tokens, model id); cost from a bundled price table (LiteLLM-style JSON, refreshed per release). Dedup by `message.id + requestId` (replayed sessions must not double-count).
- **codex**: `~/.codex/sessions/**` JSONL token counts.
- **cursor / gemini**: best-effort local log parsers; absent logs → collector silently disabled.
- **git**: walk from `--scan-dir` (default `~`, depth-limited, skip nested `node_modules`); per repo: `git log --author=<user.email>` for commits/streaks; `git ls-files` + line counts with language split by extension. Only repos where the user has authored commits count.
- **github**: strictly optional (`--github <handle>` or ambient `gh` token): public repos, stars. Network calls have hard timeouts.

### Privacy (front-door claim, HN-proof)

- Default run = **zero network calls** (exceptions: explicit `--github`, explicit `--submit`).
- `--submit` sends **aggregates only**: numeric stats + achievement ids. No paths, no repo names, no prompt content.
- Before sending, CLI prints the exact JSON payload ("this is everything that leaves your machine").
- `--dry-run` / `viberuler payload` show the payload without sending.
- README links directly to the ~40-line submit source file.

### Commands

```
npx viberuler                    # scan + ANSI card (local only)
npx viberuler --submit           # + device flow + push aggregates + share links
npx viberuler --json             # machine-readable output
npx viberuler --scan-dir <path>  # git scan root (repeatable)
npx viberuler --since <date>     # time-window stats
```

### Error handling

Each collector is isolated: failure/no-data → stderr warning, card renders from the rest. Total absence of data → `NPC` rank with guidance. Never crash on malformed JSONL lines (skip + count them).

## 3. Backend (`packages/worker`) — CF Worker + D1

Single Worker `viberuler-api` serving API + minimal HTML pages (no framework). Domain: `viberuler.dev` (pre-launch fallback: `*.workers.dev`).

### D1 schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  gh_id INTEGER UNIQUE NOT NULL,
  gh_login TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE scores (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  vibe_score REAL NOT NULL,
  loc INTEGER, projects INTEGER, tokens INTEGER,
  cost_usd REAL, tok_per_usd REAL,
  achievements TEXT,      -- JSON array of ids
  breakdown TEXT,         -- JSON score components
  sus INTEGER DEFAULT 0,  -- failed sanity caps → hidden pending review
  client_version TEXT,
  submitted_at TEXT NOT NULL
);
```

Latest score per user is shown; history kept.

### Endpoints

- `POST /api/auth/device` — GitHub device-flow proxy (client secret lives on the Worker).
- `POST /api/submit` — Bearer GitHub token → verify via GitHub API → upsert. Zod validation + sanity caps (LoC < 50M, tokens < 100B, cost consistency: tokens > 1M ⇒ cost > $0.01, tok/$ within plausible price bounds). Cap breach ⇒ `sus=1`, excluded from board until manual review.
- `GET /api/leaderboard?page=` — top by vibe_score + percentiles; edge-cached 60 s.
- `GET /api/percentile?tok_per_usd=` — efficiency percentile for CLI scoring.
- `GET /u/:login` — HTML share page: card, rank, place, giant `npx viberuler` copy button.
- `GET /og/:login.png` — OG image via `workers-og` (satori): dark neon terminal-style card.
- `GET /api/stats-badge` — shields.io endpoint JSON ("tokens benchmarked" live counter for README).

### Anti-cheat (v1 honest tier)

GitHub OAuth (1 account = 1 entry); sanity caps; accounts <30 days old flagged on the board; `client_version` allows revoking compromised versions. METHODOLOGY.md states plainly: self-reported benchmark, only blatant cheating is filtered.

### Rate limits

`POST /api/submit` — 5/hour/account. Leaderboard edge-cache 60 s.

## 4. Release ("geekiest ever")

**README as the product page:**
- Animated SVG terminal header (SMIL typing effect, renders inside GitHub README) replaying an `npx viberuler` run.
- First content line: the command itself.
- Flex badges: npm downloads + live "tokens benchmarked" counter (shields endpoint → our Worker).
- ROADMAP checklist + `good first issue` collectors (Windsurf, Aider, Cline…) as community fuel.
- METHODOLOGY.md: formula, normalization, price table, honest disclaimer.
- PRIVACY section: "Your prompts never leave your machine. Read the 40 lines of submit code yourself" + permalink.

**Launch assets:** demo GIF via `vhs` (charmbracelet), OG cards, prefilled tweets, Show HN text, Product Hunt draft.

**Launch day sketch:** npm publish + Worker deploy → owner's own submit seeds the board → X post with card → Show HN morning PT (Tue–Thu) → GitHub topics `cli`, `developer-tools`, `ai`, `benchmark`.

**Package name:** verify `viberuler` availability on npm during planning; fallback `vibe-ruler`.

## 5. Testing

- **CLI:** vitest. Fixture JSONL sets per collector (valid, corrupt, empty). Golden test for ANSI card render. Table-driven tests for score formula + rank thresholds + achievement predicates. Dedup test (duplicated message.id counted once).
- **Worker:** vitest + miniflare; zod schema round-trips; sanity-cap boundary tests; rate-limit test.
- **CI:** GitHub Actions matrix (windows/macos/ubuntu) — path handling is a first-class risk.

## Non-goals (v1)

- No raw-data upload, ever.
- No web-only score generation (CLI is the sole entry).
- No paid tiers, no accounts beyond GitHub OAuth.
- No moderation dashboard (manual D1 queries suffice at v1 scale).
