# Methodology

The meme is the interface. The math is real. This document is the full, honest account of how your VIBE SCORE is computed — every weight, every price, every cap. If a number on your card can't be traced to this page and the source files it cites, that's a bug.

## 1. Data sources

Everything is read **locally**. The scanner never uploads raw data (see [PRIVACY.md](PRIVACY.md)).

| Source | What we read | Notes |
|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` — per-message `usage` records (input / output / cache-write / cache-read tokens, model id) | Deduplicated by `message.id + requestId`, so replayed or resumed sessions are never double-counted. Malformed lines are skipped and counted, never crash the scan. Source: [`packages/cli/src/collectors/claude-code.ts`](packages/cli/src/collectors/claude-code.ts) |
| **Codex** | `~/.codex/sessions/**/*.jsonl` — `token_count` events | These are **cumulative** per session, so we take the *last* record per file, not the sum. Source: [`packages/cli/src/collectors/codex.ts`](packages/cli/src/collectors/codex.ts) |
| **Cline family** | `…/globalStorage/<ext-id>/tasks/<taskId>/ui_messages.json` for Cline (`saoudrizwan.claude-dev`, `cline.cline`), Roo Code (`rooveterinaryinc.roo-cline`), KiloCode (`kilocode.kilo-code`), across VS Code / Insiders / VSCodium and `~/.cline/data` | Token counts come from `say:"api_req_started"` messages (a JSON object encoded inside the `text` string). Cost uses Cline's own logged `cost` when present, else the sonnet-tier table. Tasks synced across installs are de-duplicated by task id. Override the search roots with `VIBERULER_CLINE_STORAGE`. Source: [`packages/cli/src/collectors/cline.ts`](packages/cli/src/collectors/cline.ts) |
| **Gemini CLI** | `${GEMINI_DATA_DIR:-~/.gemini}/tmp/<project>/chats/**/*.jsonl` — assistant-message `tokens` objects | Session logs replay the full message array, so tokens are de-duplicated by message id. Buckets map input→input, output+thoughts+tool→output, cached→cache-read. Priced at API-equivalent Gemini rates (flash/2.5-pro). Antigravity's own `~/.gemini/antigravity-cli` tree is never read (its agentic transcripts carry no token counts); but because Antigravity reuses the `~/.gemini` home, when it is present these `tmp/chats` sessions are attributed to **Antigravity** rather than Gemini CLI. Source: [`packages/cli/src/collectors/gemini.ts`](packages/cli/src/collectors/gemini.ts) |
| **Cursor** (estimated) | `state.vscdb` (SQLite) in Cursor's globalStorage — `cursorDiskKV` rows keyed `composerData:*`, input tokens at `promptTokenBreakdown` | **Input-side lower bound only**: output and cache tokens aren't stored locally, so Cursor contributes input tokens (priced API-equivalent at the sonnet tier) with an `estimated` warning. Override the search dir with `VIBERULER_CURSOR_STORAGE`; needs Node 22.5+ (`node:sqlite`). Source: [`packages/cli/src/collectors/cursor.ts`](packages/cli/src/collectors/cursor.ts) |
| **git** | Repos discovered under `--scan-dir` (default: your home dir, depth ≤ 5, `node_modules`/`.venv`/`dist`-style dirs skipped) | **LoC = lines you added in your own commits** — `git log --author=<your git user.email> --no-merges --numstat`, summed over files with a recognized code extension, minus [generated output](#loc-is-what-you-wrote). Merges are excluded so a merge commit cannot re-count the branch it absorbs. Commits/streaks come from the same log — only repos where **you** authored commits count, **aggregated across every repo** under the scan root(s). Ship outcomes too: `feats_shipped` = commits with a conventional `feat:` subject, `prs_merged` = merge commits + squash-merged PRs (`… (#123)`). `--since` now filters LoC as well, since LoC became a flow metric. Source: [`packages/cli/src/collectors/git.ts`](packages/cli/src/collectors/git.ts) |
| **GitHub** (opt-in) | Public repos of `--github <handle>` — star counts only | The only network call outside `--submit`. Paginated up to 5 pages (500 repos). Source: [`packages/cli/src/collectors/github.ts`](packages/cli/src/collectors/github.ts) |
| **LiteLLM gateway** (opt-in) | Spend logs of your self-hosted gateway — tokens your *self-built* agents burned | Activates only when you set `LITELLM_SPEND_DB` (SQLite path, needs Node 22.5+) or `LITELLM_BASE_URL` + `LITELLM_API_KEY` (`GET /spend/logs`). Cost: logged `spend` when present, else the price table below for known model prefixes, else **$0 with a printed warning** — free-tier tokens are honestly free, and yes, that inflates your tok/$. Source: [`packages/cli/src/collectors/litellm.ts`](packages/cli/src/collectors/litellm.ts) |
| **Agents roster** | Marker dirs/files in your home (`.claude/projects`, `.codex/sessions`, `.cursor`, `.gemini/antigravity-cli`, …) | Pure local `stat` probes → the `🤖 N agents in the stable` card line. Antigravity reuses the `~/.gemini` home, so when it is present it **supersedes** a leftover `Gemini CLI` marker. Your agent **names**, commit streak, and ship outcomes (features shipped / PRs merged) are part of the submit payload (they render on your certificate) — that's the only roster detail sent; no paths or per-agent data. Source: [`packages/cli/src/collectors/agents.ts`](packages/cli/src/collectors/agents.ts) |

Collectors are plugins behind a 2-method interface (`detect` / `collect`). Windsurf, Aider: PRs welcome — see the README roadmap.

## 2. Cost model

Costs are computed from a **bundled static price table** (USD per million tokens), snapshotted **2026-07-08** (`PRICES_SNAPSHOT_DATE`) and refreshed together with its date each release. Historical usage is priced at the snapshot rates — we do not model per-date price history, so month-old tokens are valued at today's prices (same tradeoff as ccusage; keeps the scan dependency-free and offline). Source: [`packages/cli/src/pricing.ts`](packages/cli/src/pricing.ts).

| Model family (prefix match) | Input | Output | Cache write | Cache read |
|---|---|---|---|---|
| `claude-opus` | 15 | 75 | 18.75 | 1.50 |
| `claude-sonnet` | 3 | 15 | 3.75 | 0.30 |
| `claude-haiku` | 1 | 5 | 1.25 | 0.10 |
| `claude-fable` | 15 | 75 | 18.75 | 1.50 |
| `codex-default` | 1.25 | 10 | 1.25 | 0.125 |
| `gemini-2.5-pro` | 1.25 | 10 | 1.25 | 0.31 |
| `gemini` (flash/default) | 0.30 | 2.50 | 0.30 | 0.075 |

- **Cache writes are tiered.** The Claude rows' cache-write column is the 5-minute (1.25× input) rate. When Claude Code logs carry the `usage.cache_creation` breakdown, the 1-hour portion is billed at **2× input** (`ephemeral_1h_input_tokens`). Legacy logs without the breakdown fall back to the 5-minute rate, which **undercounts** 1h-heavy sessions — a documented, conservative-for-your-wallet simplification.
- Unknown Claude models fall back to the **sonnet** tier.
- Codex tokens are costed at the fixed `codex-default` rate.
- **If you're on a subscription**, this is *API-equivalent value*, not what you actually paid. That's deliberate — "I extracted $18,000 of API value from a $200 subscription" **is** the flex, and tokens-per-dollar rewards exactly that.

## 3. The formula

Source of truth: [`packages/cli/src/score.ts`](packages/cli/src/score.ts).

```
volume       = 1000 · log₁₀(1 + LoC / 1000)
leverage     =  500 · log₁₀(1 + tokens / 1,000,000)
efficiency   =  800 · efficiency_percentile          (0 if total cost is $0)
breadth      =  300 · log₁₀(1 + projects · 10)
streak       =  min(streak_days, 365)
achievements =  50 · achievements_earned

VIBE = round(volume + leverage + efficiency + breadth + streak + achievements)
```

Why logarithms: a 10M-LoC whale should not be untouchable, and a newcomer's first 10K lines should feel like progress. Log compression keeps the ladder climbable at both ends.

**Efficiency percentile.** `tokens_per_dollar = total_tokens / total_cost`. When you `--submit`, the percentile is computed **live** against the actual leaderboard. Offline, we use a fixed reference curve, linearly interpolated over log₁₀(tok/$):

| log₁₀(tok/$) | 4 | 5 | 6 | 6.7 | 7.3 | 8 |
|---|---|---|---|---|---|---|
| percentile | 5% | 20% | 50% | 80% | 95% | 99% |

Offline scores are labeled `(est.)` on the card for exactly this reason.

### LoC is what you wrote

This is the number a benchmark is most tempted to lie about, so here is exactly what it is.

**LoC = lines you added, in commits authored by you, in files a human wrote.**

It used to be the size of your repos' trees (`git ls-files`), and that was wrong in two ways that both flattered you:

- **It credited you with other people's code.** Clone a large project, fix a typo, and the whole tree counted as yours. A fork of something famous would have out-scored a career.
- **It counted machine output as authorship.** Regenerating one types file can add more "lines" than a month of real work. On the author's own machine a single `wrangler types` run writes a 548 KB `.d.ts`.

So we now read `git log --author=<you> --no-merges --numstat` and sum the **additions**, skipping paths that are plainly generated: `dist/`, `build/`, `vendor/`, `node_modules/`, `*.min.js`, `*.d.ts`, `*.pb.go`, `_pb2.py`, lockfiles, snapshots. Merges are excluded so a merge commit cannot re-count the branch it absorbs. On the author's rig this took LoC from 393,750 to **328,419** — the tool's own headline number was inflated by 17%, and we would rather publish the smaller true one.

**What it still is not, stated plainly:** it counts churn. Rewrite the same file five times and all five rewrites count, because you did commit them. It is not "surviving lines" — that would need `git blame` over every file in every repo, which is minutes of work per scan. And a `feat:` that deletes 500 lines of cruft scores zero here, which is why **ship outcomes** (`features shipped`, `PRs merged`) exist alongside it: deletion is work that LoC structurally cannot see.

### Shipped efficiency (tokens per line)

Your card also shows **`tok / line shipped`** = total tokens ÷ your LoC (§1). It's the "did the tokens actually produce code?" axis: lower is leaner. It is **display-only** — it does **not** feed the VIBE score in this version (we're collecting a release of real data before deciding its weight). It's `—`/omitted when you have no scanned LoC. Both numerator and denominator now honour `--since`, so a bounded window no longer distorts the ratio. Source: [`packages/cli/src/score.ts`](packages/cli/src/score.ts).

### Vibe Wrapped (`wrapped --month`)

`viberuler wrapped --month YYYY-MM` renders a monthly recap from the two sources that can be **accurately time-windowed locally**: git activity (`git log --since/--until`) and Claude Code tokens (per-message timestamps). Cumulative or timeless sources (Codex, Cline, Cursor, Gemini, LiteLLM) are **excluded** from the monthly view — their month splits aren't reliably reconstructable on your machine. It reports flow metrics (commits, streak, busiest day, late-night, tokens, cost, tok/$). LoC is now a flow metric too (lines you added in that window) and is a candidate for the monthly card; it is left off for now rather than shipped untested. Achievements shown are only the ones the month's flow can honestly earn (token badges, `3am-committer`); the state/history-based badges (`polyglot`, `monorepo-menace`, `yolo-force-pusher`) are excluded from the monthly card because they're computed from your all-time repo composition and reflog, not the month. The one intentionally-labeled exception is **top language overall**, shown as a bit of flavor and marked *overall* precisely because it reflects your current repo mix rather than the month.

### Rig audit (`audit`)

`viberuler audit` scores your **setup**, not your output. It reads your Claude Code transcripts and MCP config locally and sends nothing (see [PRIVACY.md](PRIVACY.md)). Six numbers, and how each is derived:

**Deduplication comes first, or every figure is wrong.** Claude Code replays entries in its JSONL — on a real 10k-session corpus **more than half of all usage records are duplicates**. The audit dedups exactly like the claude-code collector (`message.id` + `requestId`), and tool blocks by their own ids. Skip this and you double every number; we did, and caught it by cross-checking against the collector.

- **Cache economy.** Actual cost is priced per message model from the bundled table (§2). The counterfactual re-prices every cached token as fresh input through the *same* table — so "caching saved $X" is a price-table subtraction, not a guess.
- **Context amplification** = a chain's input-side traffic (`input + cache_write + cache_read`) ÷ the tool-result tokens admitted into it. It answers: *how many times does a token I let into context get re-fed to the model?* It is reported for the **main thread alone**. Subagent turns (`isSidechain`) live in short contexts that die quickly; pooling them drags the average down and understates the thread you actually work in — on the author's rig, 382× pooled vs **1088× main-thread**.
- **Subagent compression** = tokens admitted *inside* subagent contexts ÷ tokens their results handed back to the parent. Subagents are **not free** — the report states their share of total spend outright (≈18% on the author's rig). The claim is not "subagents are cheaper"; it is "you pay ~18% overhead to avoid a ~1000× multiplier."
- **Cold context** = the **earliest assistant turn's** total input (`input + cache_write + cache_read`). At that instant no work has happened, so that number *is* the fixed overhead: system prompt, tool names, agent/skill descriptions, CLAUDE.md, memory. It is reported for main threads and subagent spawns separately, because every spawn re-pays it — 50.2K median at session start on the author's rig, 33.1K re-paid on each of 3,234 spawns. This is the cost that uninstalling actually fixes: removing two never-called MCP servers moved the median from 49.9K to 41.1K (**−17.5%**), even though tool schemas were already deferred — the tool *names* and server instructions load regardless.
- **Ghost tokens** = the three things an output-rewriting plugin claims to fix, measured rather than assumed. *Oversized results* (>4 KB) were **54%** of everything admitted to the author's main thread. *Repeat reads* (same path, identical result size, same session — so the file did not change) were **2%**: the marquee "dedupe your re-reads" trick is nearly worthless on a disciplined rig, which is exactly the sort of claim this section exists to check. *Exploratory reads* = whole-file reads of a path never edited anywhere in that session. That is not proof of waste — you often read to decide **not** to change something — but it is the pool an outline-first policy could shrink (2.2M tokens on the author's rig).
- **Dead weight** = MCP surfaces configured *and enabled* that were **never called**. Detection is deliberately narrow: a plugin only counts if it actually ships an MCP server (`.mcp.json` in its cache dir), so skill-only plugins are never falsely flagged. And the output says plainly that a plugin's **hooks and skills may still be working** while its MCP tools sit idle — a semgrep plugin whose hook lints every edit is not dead just because its MCP tools are.

Tool-result sizes are converted at 4 chars/token — a standard rough conversion, good enough for ratios, not exact. Source: [`packages/cli/src/audit.ts`](packages/cli/src/audit.ts).

## 4. Ranks

| VIBE | Rank |
|---|---|
| ≥ 8000 | Singularity Adjacent |
| ≥ 6500 | GIGACHAD SHIPPER |
| ≥ 5000 | Ship Machine |
| ≥ 3500 | Context Goblin |
| ≥ 2000 | Token Burner |
| ≥ 800 | Vibe Apprentice |
| < 800 | Prompt Peasant |
| no data | NPC (no vibes detected) |

## 5. Achievements

Source: [`packages/cli/src/achievements.ts`](packages/cli/src/achievements.ts). Each earned badge adds 50 points.

| Badge | Predicate |
|---|---|
| 💰 Token Billionaire | total tokens ≥ 1,000,000,000 |
| 🪦 Free Tier Martyr | ≥ 1M tokens **and** total cost < $1 |
| 🗄️ Cache Whisperer | cache-read share of all tokens > 90% |
| 🌐 Polyglot | 5+ languages in your LoC mix |
| 🐘 Monorepo Menace | a single repo > 100,000 LoC |
| 🔥 Streak Freak | commit streak ≥ 100 days |
| 🌙 3AM Committer | ≥ 10 commits between 00:00–04:59 |
| 💥 YOLO Force Pusher | ≥ 20 rebase/reset entries in your reflogs |

## 6. Anti-cheat, honestly

This is a **self-reported benchmark**. Here is exactly what we enforce and what we don't:

- **One GitHub account = one leaderboard entry.** Submits go through GitHub device-flow OAuth.
- **Sanity caps.** A submission is flagged `sus` (stored, but hidden from the board, the rank, and the public share/OG cards until reviewed) if any of these trip: LoC > 50,000,000 · tokens > 100,000,000,000 · more than 1M tokens claimed under $0.01 · tok/$ > 100,000,000 · VIBE > 50,000 · unknown achievement id. Source: [`packages/worker/src/validation.ts`](packages/worker/src/validation.ts).
- **Server-side plausibility scoring.** Beyond the static caps, each submit is checked against your GitHub account and history; tripping any of these stores the row as `sus` with a reason (hidden from the board until reviewed). Source: [`packages/worker/src/validation.ts`](packages/worker/src/validation.ts).
  - `inconsistent-breakdown` — the score components don't sum to the claimed VIBE (±max(50, 5%)).
  - `inconsistent-efficiency` — `tok_per_usd` doesn't match `tokens ÷ cost` (±10%).
  - `new-account-volume` — a GitHub account younger than 7 days claiming over 1B tokens.
  - `token-rate` — more than 2B tokens per day of account age (superhuman accumulation).
  - `velocity` — a jump of over 5B tokens versus your previous submit less than 24h earlier.
- **Rate limit:** 5 submits per hour per account.

We catch the blatant — client-side and now server-side, cross-checked against your GitHub account. We still can't catch the truly clever: a determined liar can hand-craft internally-consistent aggregates, and no benchmark can prevent that without shipping spyware, which we will not do. It's a meme benchmark: cheat and you're only lying to the group chat. Every leaderboard entry is GitHub-verified (device-flow OAuth), so at least the name attached to a lie is real.

## 7. Known limitations

- GitHub stars are capped at 500 repos (5 pages × 100).
- The price table is a snapshot; provider price changes land with the next release.
- Codex costs use one fixed rate regardless of the underlying model.
- LoC counts tracked text files by extension — generated code that you commit counts (we can't tell your `dist/` from your poetry; `.gitignore` it like an adult).
- Offline percentile is a curve fit, not the real distribution — submit to get the real one.
- Repos nested *inside* another git repo are not scanned (the walker stops at the first `.git` it meets). If your projects live under one umbrella repo, pass `--scan-dir` pointing below it (e.g. `--scan-dir ~/lab/projects`). Tracked as [#6](https://github.com/master5d/viberuler/issues/6).
- Cursor figures are an **estimated lower bound** — only per-conversation input tokens are stored locally (`state.vscdb`); output and server-side cache tokens are not, so a Cursor-heavy user is undercounted. The collector invents nothing (it counts only real input tokens, priced at a conservative sonnet-tier rate ≈ 333K tok/$); it can't fabricate cheap tokens. One honest nuance: since Cursor's counted ratio is ~333K tok/$, mixing it into your aggregate nudges tok/$ *toward* that value — so if your other tools already run leaner than ~333K tok/$, adding Cursor slightly lowers your displayed efficiency, and if they run richer, it slightly raises it. Either way it's a conservative real number, never a fabricated one.
