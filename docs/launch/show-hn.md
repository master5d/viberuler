# Show HN — launch sheet

> Rewritten 2026-07-27 for **v0.7.0** (time metrics, `--share`, waste oracle).
> All figures below were measured on the author's rig on 2026-07-27 — re-measure
> the morning of the post and replace them if they moved.

## The line (why this post exists now)

A widely-shared list names ~10 GitHub repos promising to "cut Claude Code tokens by up
to 90%". All of them are real projects. **None publishes a methodology behind its
percentage.** They treat; nobody measures. That is the post:

> **Don't take anyone's 90% — including mine. Measure it on your own transcripts.**

Every honesty rule in the tool (no savings estimates, no total-waste sum, deltas labelled
observation-not-causation, empty windows degrade instead of flattering) exists to earn
that sentence. Lead with it, defend it in replies.

## Where

**https://news.ycombinator.com/submit**

- **URL:** `https://github.com/master5d/viberuler` — the repo, not the site. Show HN
  wants the thing itself; a landing page reads like marketing.
- Leave the **text field empty**. HN allows a URL *or* text, not both. The write-up is
  your **own first comment**, posted immediately after submitting.

## Title (≤ 80 chars — HN truncates silently)

| | Title | chars |
|---|---|---|
| **A** ✅ | `Show HN: Viberuler – measure where your AI coding context actually goes` | 71 |
| B | `Show HN: Everyone sells 90% token savings; this measures yours instead` | 70 |
| C | `Show HN: Viberuler – an npx one-liner that benchmarks your AI coding` | 68 |

**A** recommended: concrete, promises no percentage, survives the first skeptical reply.
**B** has the highest ceiling and the highest variance — it picks a fight with a whole
category in the title, so use it only if you'll defend methodology for three hours
straight. **C** is the old title: safe, undersells what the tool now does.

## When

**Tue / Wed / Thu, 08:00–09:00 PT** = **10:00–11:00 Nashville**. US morning crowd, soft
front page. Avoid Fri–Sun (thin traffic, ages out before Monday) and Mon (weekend backlog).

## The first comment (post within 60 seconds of submitting)

> Hi HN — I built a benchmark for the way a lot of us work now, and then it started
> telling me things I didn't want to hear.
>
> `npx viberuler` scans locally — Claude Code / Codex / Cursor / Gemini / Cline session
> logs (tokens + API-equivalent cost) plus your git repos — and scores you. The headline
> is **tokens per dollar**: anyone can burn tokens; burning them efficiently is the
> interesting part.
>
> Three things I'd actually defend:
>
> **1. It caught me inflating my own score.** LoC was the size of my repo trees
> (`git ls-files`), so it credited me with vendored code I never touched and every line a
> compiler emitted — one `wrangler types` run writes a 548KB `.d.ts`. I changed it to
> count only lines I added in my own commits. My headline dropped 17%
> (393,750 → 328,419) and I shipped the smaller number. The excluded lines aren't hidden,
> they're reported: **33% of everything I committed was machine output**. A number you
> can't see is a number you can't reduce.
>
> **2. `viberuler audit` scores your setup, not your output.** Reads transcripts locally,
> sends nothing. On my rig, across **11,801 sessions**: context amplification **1378×**
> (how many times an admitted token gets re-fed — main-thread only, because pooling
> short-lived subagent contexts halves the number and lies to you), plus cold context
> before you type a word, and MCP servers that load every session and get called *zero*
> times — it found two burning 1.5GB across 76 processes for 0 calls.
>
> **3. The part I care about most: it measures context waste without promising savings.**
> There's a well-shared list of ~10 repos promising to cut Claude Code tokens by up to
> 90%. All real projects; none publishes a methodology. So `audit` prints named waste
> classes with calls, tokens, and the *lever* that would shrink each one. Mine right now:
>
> ```
> oversized single results          5.7M tok · 2,555 calls  → slice / grep before read
> subagent-returned tokens          2.2M tok · 4,068 calls  → tighter subagent contracts
> whole-file reads never edited     1.9M tok · 3,394 calls  → outline-first / symbol reads
> repeat reads of unchanged files   199K tok ·   301 calls  → cache tool output
> ```
>
> And that's where it stops:
>
> - **No "you would save N%".** The counterfactual is unknowable: a read that changed
>   nothing may be the read that told you *not* to change something.
> - **No total-waste sum.** Those classes overlap by construction, so a sum would
>   double-count and manufacture a headline. The output says so on screen.
> - `audit --compare A..B` puts two windows side by side — install an optimizer, compare
>   before/after on your own logs — and labels the delta an observation, not causation,
>   because workload differs between windows. A window with no sessions prints "not
>   enough data" instead of a flattering zero. That guard exists because review caught it
>   rendering an empty *future* window as a −2.3K "improvement" — exactly the lie the
>   feature was built to refute.
>
> Also new: **your own hours**, derived from transcript timestamps — no daemon, nothing
> watching your screen. Mine: **1,001 hours of attention across 3,136 hours of
> wall-clock**. And `--share` prints a card URL you can post without signing into
> anything; that card is branded SELF-REPORTED · UNVERIFIED and carries no rank — the
> leaderboard stays GitHub-verified.
>
> Privacy, since it's the first thing I'd ask: default run makes **zero network calls**.
> `--submit` is opt-in, sends fourteen aggregate fields, and prints the exact JSON before
> anything leaves the machine (`viberuler payload` shows the same without sending). Tool
> names and MCP config are a fingerprint of how you work — not in the payload, ever.
> Backend (CF Worker + D1) is in the same repo.
>
> One runtime dependency (picocolors). Collectors are a two-method interface; Windsurf
> and Aider are open `good first issue`s.
>
> Happy to go into the JSONL replay dedup (Claude Code replays >50% of its usage records
> — miss it and every number doubles), why I refuse to print a savings percentage, or
> rendering OG images with satori inside a Worker.

## Re-measure before posting

Run these the morning of the post; if a number moved, edit the comment before submitting.
The whole thesis is measurement — never post a figure you haven't just re-taken.

```bash
npx viberuler@latest audit          # amplification, waste classes, hours
npx viberuler@latest --share        # card URL, sanity-check it renders
```

Measured 2026-07-27: sessions 11,801 · amplification 1378× · attention 1,001h / wall
3,136h · waste: oversized 5.7M, subagent-returned 2.2M, exploratory 1.9M, repeat 199K.

## First hour — this is where it's won or lost

1. **Stay at the keyboard 2–3 hours.** Reply fast; latency is the one thing you control.
2. **Never ask for upvotes.** Sharing the link is fine; asking is a silent bury.
3. **Concede good criticism out loud.** Self-reported data: sanity caps catch the
   blatant; clever cheaters are only lying to their group chat. The LoC story is proof
   you fix things that flatter you.
4. **The category fight is coming** ("another vanity metric" / "why not just use $TOOL
   that saves 90%"). Answer with the constraints, not with claims: no savings estimate,
   no total sum, deltas are observations. You're not competing with those tools — you're
   the instrument that checks them.
5. **"Isn't the time tracking creepy?"** — derived from timestamps already in your
   transcripts; nothing watches your screen, nothing leaves the machine.
6. **"1378× amplification, really?"** — explain the definition before defending the
   number: tokens re-fed ÷ tokens admitted, main thread only, and the code is right there.
7. If it lands with **zero comments**, HN permits **one** repost days later with a
   different title. Don't repost something that got engagement and died.
