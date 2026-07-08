# Show HN draft

**Title:**
Show HN: Viberuler – npx one-liner that benchmarks your vibe coding (tokens per dollar)

**URL:** https://github.com/master5d/viberuler

**First comment (post immediately after submitting):**

Hi HN — I built a benchmark for the way a lot of us actually work now.

`npx viberuler` scans your machine locally — Claude Code and Codex session logs (tokens + API-equivalent cost), and your git repos (LoC, commits, streaks) — and computes a score. The headline metric is **tokens per dollar**: anyone can burn tokens, burning them efficiently is the interesting number. Cache-hit discipline is most of the game.

Things HN will (rightly) want to know:

- The default run makes zero network calls. `--submit` is opt-in, sends nine aggregate numbers + achievement ids, and prints the exact JSON payload for confirmation before anything leaves your machine. `viberuler payload` shows the same without sending. The relevant code is ~70 lines total (payload.ts, submit.ts) and the backend (CF Worker + D1) is in the same repo.
- The formula, price table, and every threshold are published in METHODOLOGY.md, and yes — it's self-reported. Sanity caps catch the blatant; the clever are only lying to the group chat. Rank names are memes on purpose; the math underneath is not.
- Cost is API-equivalent value, so subscription users get the "extracted $18K of value from a $200 plan" flex — which felt like the honest way to frame it.

One runtime dependency (picocolors). Collectors are a 2-method plugin interface — Cursor/Gemini/Windsurf/Aider collectors are open `good first issue`s if you want your tool on the board.

Happy to answer anything about the JSONL parsing (Claude Code's replay dedup was the fun bug), the D1 percentile queries, or rendering OG PNGs with satori inside a Worker.
