# Show HN — launch sheet

> Rewritten 2026-07-27 for **v0.7.0** (time metrics, `--share`, waste oracle).
> **0.8.0 (2026-09-28) adds reply ammo, same theme as the LoC story:** the Codex
> collector had been adding `cached_input_tokens` on top of `input_tokens`, though
> cached is *part of* input — every cached token counted twice, once at the full
> input rate. Fixing it (plus per-model Codex pricing and the new Opus 5.5 / Fable 5.1
> cache rates) took the author's lifetime API-equivalent from **$19.5K to $14.6K**,
> Codex alone from $1,260 to $487. Shipped the smaller number again.
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

### The casino angle (ammo for replies, not for the title)

Tokens are priced like casino chips: a denomination designed so spending them doesn't
feel like spending money. Agents make it worse — the burn happens off-screen while the
wheel spins. And notice that every celebrated new workflow (vibe-code it, ramble at the
model, hand the agent an idea file) lowers the effort per attempt and raises the tokens
per attempt. None of that is a conspiracy; it's just incentives — the vendors sell
tokens, and the ecosystem's advice trends toward burning more of them.

Viberuler's role in that frame: **the cashier's window**. It converts chips back into
dollars (API-equivalent, total and per platform) and shows the growth multiple between
two windows as a plain fact. Use this angle when someone asks "why measure at all?" or
"isn't this just a vanity metric?" — the vanity metric is the *unconverted* chip count.
Don't use it to accuse any vendor; the tool measures, it doesn't editorialize.

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
> sends nothing. On my rig, over the transcripts still on disk (**1,839 sessions, last 44 days**): context
> amplification **1634×**
> (how many times an admitted token gets re-fed — main-thread only, because pooling
> short-lived subagent contexts halves the number and lies to you), plus cold context
> before you type a word (68K tokens median, re-paid by every subagent spawn), and MCP servers that load every
> session and get called *zero* times — 3 of my 7 right now.
>
> **3. The part I care about most: it measures context waste without promising savings.**
> There's a well-shared list of ~10 repos promising to cut Claude Code tokens by up to
> 90%. All real projects; none publishes a methodology. So `audit` prints named waste
> classes with calls, tokens, and the *lever* that would shrink each one. Mine right now:
>
> ```
> oversized single results          5.8M tok · 2,763 calls  → slice / grep before read
> whole-file reads never edited     542K tok ·   874 calls  → outline-first / symbol reads
> subagent-returned tokens          429K tok · 1,619 calls  → tighter subagent contracts
> repeat reads of unchanged files   8.8K tok ·    42 calls  → cache tool output
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
> watching your screen. Mine: **616 hours of attention across 2,197 hours of
> wall-clock** (44 days). And `--share` prints a card URL you can post without signing into
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

**Re-measured 2026-10-07 (v0.8.0, comment above updated):** sessions 1,839 over 44 days of transcripts on disk ·
amplification 1634× · attention 615.6h / wall 2,197.0h · waste: oversized 5.8M, exploratory 542K, subagent-returned
429K, repeat 8.8K · cold context 68.1K median · 3 of 7 MCP surfaces never called. The July session count was larger
because older transcripts are no longer on disk — say so if asked; do not quote the July numbers.

## Posted 2026-10-08 — what happened (read before any repost)

Posted 17:48 UTC as `daocat` (karma 1) with title A: https://news.ycombinator.com/item?id=50009232.
The ~4,000-char first comment (`first-comment-2026-10-08.txt`) was **auto-killed within 75 seconds**
(`dead: true` in the Firebase API; the author still sees it as normal). The fix is an email to the moderators
(Contact link in the HN footer) with both links — **never re-post the comment**, a duplicate reads as spam.
Next time from a low-karma account: a short first comment (what it is + one honest number + link to README),
and check `https://hacker-news.firebaseio.com/v0/item/<comment id>.json` for `dead` right after posting.
HN renders no markdown: `**bold**` and backticks stay literal, paragraphs need a blank line, code = 2-space indent.

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
5. **"How is this different from CodexBar?"** (steipete/CodexBar, MIT, ~22k★ — the
   neighbour HN will name first). Different job, no fight: CodexBar
   is a live **monitor** — menu bar, remaining 5h/weekly limits and reset times across
   ~87 providers, some of them reached through optional browser-cookie / Keychain access.
   Viberuler is a **mirror and an audit** — history, tokens per dollar, git-side output,
   waste classes — with zero network calls by default and no credentials read. Use both;
   credit it by name, never knock it.
6. **"Isn't the time tracking creepy?"** — derived from timestamps already in your
   transcripts; nothing watches your screen, nothing leaves the machine.
7. **"1634× amplification, really?"** — explain the definition before defending the
   number: tokens re-fed ÷ tokens admitted, main thread only, and the code is right there.
8. If it lands with **zero comments**, HN permits **one** repost days later with a
   different title. Don't repost something that got engagement and died.
