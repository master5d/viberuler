# Show HN draft

**Title:**
Show HN: Viberuler – npx one-liner that benchmarks your vibe coding (tokens per dollar)

**URL:** https://github.com/master5d/viberuler

**First comment (post immediately after submitting):**

Hi HN — I built a benchmark for the way a lot of us actually work now.

`npx viberuler` scans your machine locally — Claude Code and Codex session logs (tokens + API-equivalent cost), and your git repos (LoC, commits, streaks) — and computes a score. The headline metric is **tokens per dollar**: anyone can burn tokens, burning them efficiently is the interesting number. Cache-hit discipline is most of the game.

Things HN will (rightly) want to know:

- The default run makes zero network calls. `--submit` is opt-in, sends fourteen aggregate fields — stats, achievement ids, your commit streak, ship outcomes (features shipped / PRs merged), and the names of the coding agents in your home dir (opt-in toolchain flex) — and prints the exact JSON payload for confirmation before anything leaves your machine. `viberuler payload` shows the same without sending. The relevant code is ~140 lines total (payload.ts, submit.ts) and the backend (CF Worker + D1) is in the same repo.
- The formula, price table, and every threshold are published in METHODOLOGY.md, and yes — it's self-reported. Sanity caps catch the blatant; the clever are only lying to the group chat. Rank names are memes on purpose; the math underneath is not.
- Cost is API-equivalent value, so subscription users get the "extracted $18K of value from a $200 plan" flex — which felt like the honest way to frame it.

There's also `npx viberuler audit`, which scores your *setup* instead of your output — and it's the part I'd actually defend. It reads your Claude Code transcripts locally (sends nothing) and reports: your cache-hit rate and what prompt caching really saved you; **context amplification** — how many times a token you admit into context gets re-fed to the model (1088× on my rig, main-thread only: pooling in short-lived subagent contexts halves that and lies to you); how hard subagents compress (15×, while honestly costing ~18% overhead — the pitch isn't "free", it's "pay 18% to dodge a 1000× multiplier"); and **dead weight**: MCP servers that load every session, spawn processes, inject schemas, and get called *zero* times. On my own machine it found two burning 1.5 GB across 76 processes for 0 calls in 10,700 sessions. I'd been paying for them for months. Measuring beats vibes, which is a funny thing for this tool to conclude.

One runtime dependency (picocolors). Collectors are a 2-method plugin interface — Claude Code, Codex, Cursor, Gemini CLI, Cline/Roo/Kilo already ship; Windsurf and Aider are open `good first issue`s if you want your tool on the board.

Happy to answer anything about the JSONL parsing (Claude Code's replay dedup was the fun bug), the D1 percentile queries, or rendering OG PNGs with satori inside a Worker.
