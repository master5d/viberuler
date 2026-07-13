# Show HN — launch sheet

## Where

**https://news.ycombinator.com/submit**

- **URL:** `https://github.com/master5d/viberuler` — the repo, not the site. Show HN wants the thing itself; a landing page reads like marketing.
- Leave the **text field empty**. HN lets you have a URL *or* text, not both. The write-up goes in as your **own first comment**, immediately after submitting.

## Title (≤ 80 chars — HN truncates silently)

Pick one. My recommendation is **A**: understated, concrete, and it doesn't oversell — HN punishes a title that promises more than the first comment delivers.

| | Title | chars |
|---|---|---|
| **A** ✅ | `Show HN: Viberuler – an npx one-liner that benchmarks your AI coding` | 68 |
| B | `Show HN: I audited my AI coding rig and found 1.5GB of MCPs I never called` | 74 |
| C | `Show HN: Viberuler – benchmark your AI coding, then audit what your rig costs` | 77 |

B is the highest-ceiling title and the highest-variance one: it leads with the finding rather than the tool, which can read as blogspam if the repo underdelivers. It doesn't — but that's the risk.

## When

**Tuesday, Wednesday or Thursday, 08:00–09:00 PT** = **10:00–11:00 your time (Nashville, CT)**.

That's when the US morning crowd arrives and the front page is still soft. Avoid Friday–Sunday (thin traffic, and your post ages out before Monday). Avoid Monday (backlog of weekend submissions).

## The first comment (post it within 60 seconds of submitting)

> Hi HN — I built a benchmark for the way a lot of us actually work now.
>
> `npx viberuler` scans your machine locally — Claude Code / Codex / Cursor / Gemini / Cline session logs (tokens + API-equivalent cost) and your git repos — and computes a score. The headline is **tokens per dollar**: anyone can burn tokens; burning them efficiently is the interesting number.
>
> The part I'd actually defend is what happened when I pointed it at myself.
>
> **It was inflating my own score.** LoC was the size of my repo trees (`git ls-files`), which meant it credited me with vendored code I never touched and with every line a compiler emitted — one `wrangler types` run writes a 548KB `.d.ts`. I changed it to count only lines I added in my own commits, generated output excluded. My headline number dropped 17% (393,750 → 328,419) and I shipped the smaller one. A benchmark that flatters its author is the one thing this can't be.
>
> The excluded lines aren't thrown away, they're reported: **33% of everything I committed was machine output** — regenerated types, bundles, lockfiles. Not scored, never sent. A number you can't see is a number you can't reduce.
>
> Then there's `npx viberuler audit`, which scores your *setup* instead of your output. It reads your Claude Code transcripts locally (sends nothing) and reports:
>
> - **Context amplification** — how many times a token you admit into context gets re-fed to the model. **1088×** on my rig. Main-thread only: pooling short-lived subagent contexts halves that number and lies to you.
> - **Subagent compression** — 15×, at an honest ~18% overhead. The pitch isn't "free", it's "pay 18% to dodge a 1000× multiplier."
> - **Cold context** — 50K tokens before you type a word, re-paid on every subagent spawn.
> - **Dead weight** — MCP servers that load every session, spawn processes, inject schemas, and get called *zero* times. It found two burning 1.5GB across 76 processes for 0 calls in 10,700 sessions. I'd been paying for them for months.
>
> Privacy, since it's the first thing I'd ask: the default run makes **zero network calls**. `--submit` is opt-in, sends fourteen aggregate fields, and prints the exact JSON before anything leaves the machine (`viberuler payload` shows the same without sending). Tool names and MCP config are a fingerprint of how you work — they are not in the payload and never will be. Backend (CF Worker + D1) is in the same repo.
>
> One runtime dependency (picocolors). Collectors are a two-method interface; Windsurf and Aider are open `good first issue`s if you want your tool on the board.
>
> Happy to go into the JSONL replay dedup (Claude Code replays >50% of its usage records — miss it and every number doubles), the D1 percentile queries, or rendering OG images with satori inside a Worker.

## First hour — this is where it's won or lost

1. **Stay at the keyboard for 2–3 hours.** Reply to every comment, fast. Response latency is the single biggest thing you control.
2. **Never ask for upvotes.** Not on X, not in Slack, not to friends. HN detects voting rings and will bury the post silently. Sharing the *link* is fine; asking for votes is not.
3. **Agree with good criticism, out loud.** The self-reported-data objection is coming — don't get defensive, just concede it: sanity caps catch the blatant, the clever are only lying to the group chat. The LoC story is your proof you'll fix things when they're wrong.
4. **Expect "vanity metric" pushback.** Your answer is the honest-LoC change and the audit — both are cases of the tool telling its own author something he didn't want to hear.
5. If it lands flat with **zero comments**, HN permits **one** repost days later, ideally with a different title. Don't repost something that got engagement and died — that reads as gaming.

## Pre-flight (all ✅ as of v0.6.0)

- [x] `npx viberuler` works from a cold cache — verified against the published 0.6.0
- [x] README demo gifs re-rendered on 0.6.0 (they showed the old inflated LoC)
- [x] 3-OS CI green
- [x] LICENSE present
- [x] METHODOLOGY explains every number, including what LoC still *can't* see
- [ ] LinkedIn Post Inspector — flush the cached og:image (it holds the pre-honesty certificate)
