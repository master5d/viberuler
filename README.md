<p align="center">
  <img src="assets/viberuler-terminal.svg" width="760" alt="npx viberuler demo">
</p>

<h1 align="center">viberuler</h1>
<p align="center"><b>The benchmark for vibe coders.</b><br>How hard do you actually vibe? There's only one way to find out:</p>

```bash
npx viberuler
```

<p align="center">
  <a href="https://www.npmjs.com/package/viberuler"><img src="https://img.shields.io/npm/v/viberuler?color=blueviolet" alt="npm"></a>
  <a href="https://github.com/master5d/viberuler/actions"><img src="https://img.shields.io/github/actions/workflow/status/master5d/viberuler/ci.yml" alt="ci"></a>
  <img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fviberuler.dev%2Fapi%2Fstats-badge" alt="tokens benchmarked">
  <img src="https://img.shields.io/badge/network%20calls-zero%20by%20default-69f0ae" alt="zero network">
</p>

---

## What it does

`viberuler` scans your machine — locally, in seconds — and computes your **VIBE SCORE**:

| Signal | Source | Flex |
|---|---|---|
| 🧠 tokens burned | Claude Code + Codex session logs (+ your LiteLLM gateway, opt-in) | `1.2B tokens` |
| 💸 **tokens per dollar** | tokens ÷ spend (bundled price table) | `6.5M tok/$ — TOP 3%` |
| ⚡ LoC shipped | `git ls-files` across your repos | `312K LoC` |
| 📦 projects | repos where *you* authored commits | `47 projects` |
| 🔥 streak | consecutive commit days | `212-day streak` |
| 🏆 achievements | see below | `Token Billionaire` |
| 🤖 agents in the stable | marker dirs of known coding agents in your home | `4 agents · Claude Code · Codex · Antigravity` |

Then it prints a scorecard you'll screenshot before you can stop yourself.

**`tokens per dollar` is the headline stat.** Anyone can burn tokens. Burning them *efficiently* is the game.

<p align="center">
  <img src="assets/demo.gif" width="700" alt="viberuler scanning locally and printing the scorecard: projects, LoC, tokens, tokens-per-dollar, streak, rank">
</p>

## The ranks

`Prompt Peasant` → `Vibe Apprentice` → `Token Burner` → `Context Goblin` → `Ship Machine` → `GIGACHAD SHIPPER` → `Singularity Adjacent`

(No data? You get `NPC (no vibes detected)`. We're sorry. We're not sorry.)

## Achievements

| | | |
|---|---|---|
| 💰 **Token Billionaire** — ≥1B tokens | 🪦 **Free Tier Martyr** — ≥1M tokens under $1 | 🗄️ **Cache Whisperer** — >90% cache reads |
| 🌐 **Polyglot** — 5+ languages | 🐘 **Monorepo Menace** — a 100K+ LoC repo | 🔥 **Streak Freak** — 100-day streak |
| 🌙 **3AM Committer** — 10+ night commits | 💥 **YOLO Force Pusher** — 20+ history rewrites | |

## The leaderboard

```bash
npx viberuler --submit
```

GitHub device-flow login → your score goes live at `viberuler.dev/u/<you>` as a **Certificate of Vibe Measurement** (LoC · tok/$ · streak · agents · rank · title), built for flexing. Global rank. Efficiency percentile. Prefilled share links — X · LinkedIn · Facebook · Bluesky.

**Share to Stories** — the certificate page also renders a vertical 9:16 **story card** (Spotify-Wrapped-style stat reveal) and a *Share to Stories* button. On mobile it hands the card straight to your phone's native share sheet — Instagram, WhatsApp, Facebook, Messenger; on desktop it downloads the card to post. (Stories are app-only, so this is the only way in — same mechanism Wrapped uses.)

## Privacy (read this, HN)

- The default run makes **zero network calls**. Zero.
- `--submit` sends **aggregates only** — fourteen fields: aggregate stats, achievement ids, your coding-agent names, commit streak, and ship outcomes (features shipped / PRs merged). No paths, no repo names, no prompts, no code. Ever.
- Before anything is sent, the CLI prints the **exact JSON payload** and asks.
- Don't trust us — read the ~140 lines: [`packages/cli/src/payload.ts`](packages/cli/src/payload.ts) and [`packages/cli/src/submit.ts`](packages/cli/src/submit.ts). Details: [PRIVACY.md](PRIVACY.md).

## The math

Full formula, price table, normalization and honest disclaimers in [METHODOLOGY.md](METHODOLOGY.md). Short version:

```
VIBE = 1000·log₁₀(1 + LoC/1000)          # shipping volume
     +  500·log₁₀(1 + tokens/1M)         # AI leverage
     +  800·efficiency_percentile        # tokens/$ vs the world
     +  300·log₁₀(1 + projects·10)       # breadth
     +  min(streak, 365) + 50·achievements
```

Logarithms everywhere — whales get compressed, newcomers have room to climb.

## Monthly recap

```bash
npx viberuler wrapped --month 2026-06
```

Your **Vibe Wrapped** for the month — commits, busiest day, streak, top language, and Claude Code tokens/cost for that window. 100% local; screenshot and flex.

## Flags

```
npx viberuler                # scan + scorecard (100% local)
npx viberuler audit          # audit your rig — see below
npx viberuler --submit       # push to the global leaderboard
npx viberuler payload        # show exactly what --submit WOULD send
npx viberuler --json         # machine-readable
npx viberuler --scan-dir ~/code --since 2026-01-01
npx viberuler --scan-dir ~/work --scan-dir ~/oss   # repeatable — scans ALL repos under each root
npx viberuler --github <handle>   # add your stars (the only other network call)
```

A bare run scans every git repo under your **home dir**. If your code lives elsewhere (or in several places), point `--scan-dir` at each root — it's repeatable, and every metric (LoC, commits, features, PRs) is summed across all repos found, so your certificate reflects your whole body of work, not one project.

## Rig audit

```bash
npx viberuler audit
```

Your **tokens per dollar** score says how efficiently you burn tokens. `audit` says how efficiently your *rig* is set up. 100% local, reads your Claude Code transcripts:

<p align="center">
  <img src="assets/demo-audit.gif" width="700" alt="viberuler audit: cache economy, context amplification, subagent compression, cold context, ghost tokens, and dead MCP weight">
</p>


- **Token economy** — cache-hit rate, and what prompt caching actually saved you in API-equivalent dollars.
- **Context amplification** — how many times the average token you admit gets re-read on later turns. Measured on the **main thread alone**: pooling in short-lived subagent contexts halves the number and understates what a token really costs in the thread you live in. (On a real rig: **1088×**.)
- **Subagents** — how hard they compress: work pulled in *inside* a subagent vs the summary handed back. They aren't free (they cost real overhead), but at 1000× amplification, keeping tokens out of the main thread is the whole game.
- **🧊 Cold context** — what a session costs *before you type a word*: system prompt, tool names, agent and skill descriptions, memory. Every subagent spawn re-pays it. (On a real rig: **50.2K tokens** at session start, **33.1K** re-paid on each of 3,234 spawns.)
- **👻 Ghost tokens** — the tokens an output-rewriting plugin promises to save you, measured instead of promised. Oversized results (>4KB) were **54%** of everything admitted; the famous "dedupe repeat reads" trick was worth **2%**.
- **Top tools** — which tools are actually filling your context, ranked by calls and by tokens.
- **☠️ Dead weight** — MCP servers and plugins that load on every session, spawn a process, inject their tool schemas… and get **called zero times**.

That last one is the point. On the author's rig it found two MCP servers burning **1.5 GB of RAM across 76 processes** for **0 calls in 10,700+ sessions**. Removing them dropped the median cold context from 49.9K to 41.1K tokens — a **17.5%** discount on every session since, and proof that deferred tool schemas do *not* make an unused server free.

Measuring beats guessing, which is an awkward conclusion for a tool that scores you on vibes.

## Statusline

Put your score where your ego lives — ready-to-paste snippets for **Claude Code**, **Starship**, **oh-my-posh**, **tmux**, and raw shell prompts in [`integrations/statusline/`](integrations/statusline/). One cache file, sub-millisecond reads:

```
Fable 5 · ⚡3982 Context Goblin · 481.5K tok/$
```

## Roadmap — PRs welcome

- [x] Claude Code collector (tokens, cost, cache-hit dedup)
- [x] Codex collector
- [x] Cursor collector (input-side lower bound, estimated)
- [x] Gemini CLI collector
- [x] Cline / Roo Code / KiloCode collectors (one parser, three forks)
- [x] Multi-agent rigs — repeatable `--agent-home`, plus `CODEX_HOME` / `CLAUDE_CONFIG_DIR`
- [ ] **[Windsurf](https://github.com/master5d/viberuler/issues/3)** / **[Aider](https://github.com/master5d/viberuler/issues/4)** collectors — `good first issue`
- [x] Vibe Wrapped — monthly recap card
- [ ] Team leaderboards

**Want your agent on the board?** A collector is ~70 lines and a test: two methods,
*is this agent here* and *what did it burn*. [CONTRIBUTING.md](CONTRIBUTING.md) walks
through it, including the two parsing traps that already bit us. Draft PRs are fine —
you don't have to finish it before asking.

### Multi-agent rigs

If your agents don't live in your home directory, point at them — every extra root
is searched, and mounting the same logs twice never double-counts:

```bash
npx viberuler --agent-home C:\agents\Claude --agent-home C:\agents\codex
```

`CODEX_HOME` and `CLAUDE_CONFIG_DIR` are honoured automatically, so if you already
relocate your agents the normal way, there is nothing to pass.

## Stack

TypeScript CLI (one runtime dep: `picocolors`). Backend: Cloudflare Worker + D1, OG images rendered in-worker by satori — [`packages/worker`](packages/worker). Font: JetBrains Mono (OFL). MIT.

---

<p align="center"><i>Your prompts never leave your machine. Your score never leaves the group chat.</i></p>
