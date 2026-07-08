# VibeRuler Release (Plan 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repo launch-ready: README-as-product-page with an animated SVG terminal, METHODOLOGY.md + PRIVACY.md, publish hardening (npm metadata, prepublishOnly, npm ci, types-drift guard), ledger follow-up fixes (GitHub pagination, og:title polish), vhs demo tape, and a LAUNCH.md runbook + Show HN / tweet drafts. Actual npm publish / CF deploy / domain are USER-GATED runbook steps, not tasks.

**Architecture:** Docs and assets live at repo root (GitHub product page); a short npm-facing README goes into packages/cli/. One code task fixes the two remaining runtime follow-ups with tests. Everything else is transcription of content specified verbatim here.

**Tech Stack:** hand-authored SMIL SVG (GitHub READMEs render SMIL animations via `<img>`), shields.io endpoint badge (wired to the live `/api/stats-badge`), charmbracelet vhs tape (recording deferred to launch), Markdown.

## Global Constraints

- No real deploy, no npm publish, no GitHub repo creation in ANY task — those are LAUNCH.md runbook steps executed with the owner.
- README tone: meme-maximalism on the surface, honest engineering underneath. Every factual claim in README/METHODOLOGY must match the code (formula weights, caps, price table, rank thresholds, achievement predicates).
- Badges reference `https://viberuler.dev/...` and the `master5d/viberuler` GitHub slug — they go live only after launch; that's expected (they render as "invalid" until then, fine).
- JetBrains Mono OFL credit required (vendored TTF).
- All tests stay green after every task: 70 CLI + 36 worker as of Plan 2 merge; Task 1 adds more.
- License: MIT (root LICENSE file, Sasha Mamaev 2026).

---

### Task 1: Publish hardening + follow-up fixes (code)

**Files:**
- Modify: `packages/cli/package.json` (metadata + prepublishOnly)
- Modify: `packages/cli/src/collectors/github.ts` (pagination)
- Modify: `packages/worker/src/routes/share.ts` (og:title `@login` prefix polish)
- Modify: `.github/workflows/ci.yml` (`npm ci`, types-drift guard)
- Create: `LICENSE`
- Test: `packages/cli/test/github.test.ts` (pagination case)

**Interfaces:**
- Consumes: existing `githubCollector` fetchImpl seam.
- Produces: `githubCollector` follows GitHub `Link: <...>; rel="next"` pagination up to 5 pages (500 repos), summing stars across pages; behavior for ≤100 repos unchanged.

- [ ] **Step 1: package.json metadata**

Add to `packages/cli/package.json` (keep existing fields):

```json
{
  "repository": { "type": "git", "url": "git+https://github.com/master5d/viberuler.git" },
  "homepage": "https://viberuler.dev",
  "bugs": "https://github.com/master5d/viberuler/issues",
  "author": "Sasha Mamaev (https://github.com/master5d)",
  "keywords": ["cli", "benchmark", "ai", "claude", "codex", "vibe-coding", "leaderboard", "tokens", "developer-tools"],
  "scripts": { "prepublishOnly": "npm run typecheck && npm test && npm run build" }
}
```

(`prepublishOnly` is ADDED to scripts, other scripts unchanged.)

- [ ] **Step 2: LICENSE (root)**

MIT license text, `Copyright (c) 2026 Sasha Mamaev`.

- [ ] **Step 3: failing pagination test**

Append to `packages/cli/test/github.test.ts` inside the describe:

```ts
it('follows Link rel=next pagination and sums stars across pages', async () => {
  const calls: string[] = [];
  githubCollector.fetchImpl = (async (url: RequestInfo | URL) => {
    const u = String(url);
    calls.push(u);
    if (!u.includes('page=2')) {
      return new Response(JSON.stringify([{ stargazers_count: 10 }]), {
        status: 200,
        headers: { link: '<https://api.github.com/users/master5d/repos?per_page=100&type=owner&page=2>; rel="next"' },
      });
    }
    return new Response(JSON.stringify([{ stargazers_count: 32 }]), { status: 200 });
  }) as typeof fetch;
  const r = await githubCollector.collect({ home: '/x', scanDirs: [], githubHandle: 'master5d' });
  expect(r.ghStars).toBe(42);
  expect(calls.length).toBe(2);
});
```

Run: `npx vitest run test/github.test.ts` — the new test FAILS (single-page implementation returns 10).

- [ ] **Step 4: implement pagination**

Rework `githubCollector.collect` loop (keep detect + warnings behavior):

```ts
async collect(ctx: ScanContext) {
  const doFetch = this.fetchImpl ?? fetch;
  try {
    let url: string | null =
      `https://api.github.com/users/${encodeURIComponent(ctx.githubHandle!)}/repos?per_page=100&type=owner`;
    let ghStars = 0;
    for (let page = 0; url && page < 5; page++) {
      const res: Response = await doFetch(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'viberuler' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { sources: ['github'], warnings: [`github: API returned ${res.status}`] };
      const repos = (await res.json()) as Array<{ stargazers_count?: number }>;
      ghStars += repos.reduce((sum, r) => sum + (r.stargazers_count ?? 0), 0);
      const link = res.headers.get('link') ?? '';
      url = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
    }
    return { ghStars, sources: ['github'] };
  } catch {
    return { sources: ['github'], warnings: ['github: request failed or timed out'] };
  }
}
```

Run: `npx vitest run test/github.test.ts` — all pass (4 tests).

- [ ] **Step 5: og:title polish (worker)**

In `packages/worker/src/routes/share.ts`, the non-sus page title must be `` `@${row.gh_login} — VIBE ${fmtInt(row.vibe_score)}` `` (restore the `@login` prefix dropped by the Plan 2 fix); sus title stays `` `@${row.gh_login} — under review` ``. Adjust/extend the existing share test only if an assertion breaks.

- [ ] **Step 6: CI — npm ci + types-drift guard**

In `.github/workflows/ci.yml`: replace `- run: npm install` with `- run: npm ci`. After the `npm run check -w viberuler-api` step add:

```yaml
      - run: npx wrangler types && git diff --exit-code worker-configuration.d.ts
        working-directory: packages/worker
        if: runner.os == 'Linux'
```

- [ ] **Step 7: verify + commit**

Root: `npm run typecheck && npm test` — green (CLI 71, worker 36). Run the drift guard once locally from packages/worker.

```bash
git add -A
git commit -m "chore(release): publish hardening, github pagination, ci npm ci + types guard"
```

---

### Task 2: Animated SVG terminal

**Files:**
- Create: `assets/viberuler-terminal.svg`

**Interfaces:** README (Task 3) embeds it as `<img src="assets/viberuler-terminal.svg" ...>`. SMIL only (GitHub camo-proxy renders SMIL, no scripts allowed).

- [ ] **Step 1: author the SVG**

`assets/viberuler-terminal.svg` — verbatim:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 460" font-family="ui-monospace,Consolas,Menlo,monospace" font-size="16">
  <rect width="760" height="460" rx="12" fill="#0b0e14"/>
  <rect width="760" height="34" rx="12" fill="#11151f"/>
  <circle cx="22" cy="17" r="6" fill="#ff5f56"/><circle cx="44" cy="17" r="6" fill="#ffbd2e"/><circle cx="66" cy="17" r="6" fill="#27c93f"/>
  <text x="380" y="22" fill="#666" text-anchor="middle" font-size="12">~ viberuler</text>

  <text x="24" y="70" fill="#69f0ae">$</text>
  <g>
    <clipPath id="type"><rect x="44" y="52" width="0" height="26">
      <animate attributeName="width" from="0" to="150" begin="0.5s" dur="1.2s" fill="freeze"/>
    </rect></clipPath>
    <text x="44" y="70" fill="#e6e6e6" clip-path="url(#type)">npx viberuler</text>
  </g>
  <rect x="196" y="54" width="9" height="20" fill="#69f0ae">
    <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="3"/>
    <animate attributeName="opacity" to="0" begin="2.2s" dur="0.1s" fill="freeze"/>
  </rect>

  <g opacity="0"><animate attributeName="opacity" to="1" begin="2.4s" dur="0.3s" fill="freeze"/>
    <text x="24" y="110" fill="#b388ff" font-weight="bold">VIBERULER v1.0 — scanning your rig…</text></g>
  <g opacity="0"><animate attributeName="opacity" to="1" begin="3.0s" dur="0.3s" fill="freeze"/>
    <text x="24" y="150" fill="#e6e6e6">⚡ <tspan font-weight="bold">47</tspan> projects · <tspan font-weight="bold">312,441</tspan> LoC shipped</text></g>
  <g opacity="0"><animate attributeName="opacity" to="1" begin="3.4s" dur="0.3s" fill="freeze"/>
    <text x="24" y="180" fill="#e6e6e6">🧠 <tspan font-weight="bold">1.2B</tspan> tokens · <tspan font-weight="bold">$184.20</tspan> burned</text></g>
  <g opacity="0"><animate attributeName="opacity" to="1" begin="3.8s" dur="0.3s" fill="freeze"/>
    <text x="24" y="210" fill="#ffd54f">💸 <tspan font-weight="bold">6.5M</tspan> tok/$ · TOP <tspan font-weight="bold">3%</tspan> GLOBAL</text></g>
  <g opacity="0"><animate attributeName="opacity" to="1" begin="4.2s" dur="0.3s" fill="freeze"/>
    <text x="24" y="240" fill="#e6e6e6">🔥 <tspan font-weight="bold">212</tspan>-day streak · <tspan font-weight="bold">8,921</tspan> commits</text></g>

  <g opacity="0"><animate attributeName="opacity" to="1" begin="4.8s" dur="0.4s" fill="freeze"/>
    <rect x="24" y="270" width="712" height="90" rx="8" fill="#11151f" stroke="#2a2f3a"/>
    <text x="44" y="305" fill="#e6e6e6">VIBE SCORE <tspan fill="#b388ff">▓▓▓▓▓▓▓▓▓▓▓▓▓░░░</tspan>  <tspan font-weight="bold" font-size="20">9,204</tspan></text>
    <text x="44" y="340" fill="#ff80ab" font-weight="bold" letter-spacing="2">RANK: GIGACHAD SHIPPER</text></g>

  <g opacity="0"><animate attributeName="opacity" to="1" begin="5.5s" dur="0.4s" fill="freeze"/>
    <text x="24" y="400" fill="#ffd54f">💰 Token Billionaire · 🗄️ Cache Whisperer · 🌙 3AM Committer</text></g>
  <g opacity="0"><animate attributeName="opacity" to="1" begin="6.0s" dur="0.4s" fill="freeze"/>
    <text x="24" y="435" fill="#666">→ viberuler.dev/u/you — what's YOUR score?</text></g>
</svg>
```

- [ ] **Step 2: validate**

`npx --yes xmllint-wasm --version 2>/dev/null || python -c "import xml.dom.minidom,sys;xml.dom.minidom.parse('assets/viberuler-terminal.svg');print('well-formed')"` — must print well-formed. Open in a browser once if available to sanity-check the animation.

- [ ] **Step 3: Commit**

```bash
git add assets/viberuler-terminal.svg
git commit -m "feat(release): animated SMIL terminal for the README hero"
```

---

### Task 3: README.md (root, product page) + npm short README

**Files:**
- Create: `README.md` (root)
- Create: `packages/cli/README.md` (short npm-facing)

**Interfaces:** references `assets/viberuler-terminal.svg`, shields endpoint `https://viberuler.dev/api/stats-badge`, files created in Task 4 (METHODOLOGY.md, PRIVACY.md — forward links are fine within this plan).

- [ ] **Step 1: write root README.md** — verbatim:

````markdown
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
| 🧠 tokens burned | Claude Code + Codex session logs | `1.2B tokens` |
| 💸 **tokens per dollar** | tokens ÷ spend (bundled price table) | `6.5M tok/$ — TOP 3%` |
| ⚡ LoC shipped | `git ls-files` across your repos | `312K LoC` |
| 📦 projects | repos where *you* authored commits | `47 projects` |
| 🔥 streak | consecutive commit days | `212-day streak` |
| 🏆 achievements | see below | `Token Billionaire` |

Then it prints a scorecard you'll screenshot before you can stop yourself.

**`tokens per dollar` is the headline stat.** Anyone can burn tokens. Burning them *efficiently* is the game.

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

GitHub device-flow login → your score goes live at `viberuler.dev/u/<you>` with an OG card built for flexing. Global rank. Efficiency percentile. Prefilled share links.

## Privacy (read this, HN)

- The default run makes **zero network calls**. Zero.
- `--submit` sends **aggregates only** — nine numbers and a list of achievement ids. No paths, no repo names, no prompts, no code. Ever.
- Before anything is sent, the CLI prints the **exact JSON payload** and asks.
- Don't trust us — read the ~40 lines: [`packages/cli/src/payload.ts`](packages/cli/src/payload.ts) and [`packages/cli/src/submit.ts`](packages/cli/src/submit.ts). Details: [PRIVACY.md](PRIVACY.md).

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

## Flags

```
npx viberuler                # scan + scorecard (100% local)
npx viberuler --submit       # push to the global leaderboard
npx viberuler payload        # show exactly what --submit WOULD send
npx viberuler --json         # machine-readable
npx viberuler --scan-dir ~/code --since 2026-01-01
npx viberuler --github <handle>   # add your stars (the only other network call)
```

## Roadmap — PRs welcome

- [x] Claude Code collector (tokens, cost, cache-hit dedup)
- [x] Codex collector
- [ ] Cursor collector — `good first issue`
- [ ] Gemini CLI collector — `good first issue`
- [ ] Windsurf / Aider / Cline collectors — `good first issue`
- [ ] Team leaderboards

A collector is one file implementing a 2-method interface: [`packages/cli/src/types.ts`](packages/cli/src/types.ts).

## Stack

TypeScript CLI (one runtime dep: `picocolors`). Backend: Cloudflare Worker + D1, OG images rendered in-worker by satori — [`packages/worker`](packages/worker). Font: JetBrains Mono (OFL). MIT.

---

<p align="center"><i>Your prompts never leave your machine. Your score never leaves the group chat.</i></p>
````

- [ ] **Step 2: packages/cli/README.md** (npm page) — verbatim:

````markdown
# viberuler

**The benchmark for vibe coders.**

```bash
npx viberuler
```

Scans your rig locally (Claude Code/Codex logs + git repos), computes your VIBE SCORE — LoC shipped, tokens burned, and the headline stat: **tokens per dollar** — and prints a scorecard built for screenshots.

- Zero network calls by default. `--submit` (opt-in) sends nine aggregate numbers to the global leaderboard at [viberuler.dev](https://viberuler.dev), after showing you the exact payload.
- Full docs, methodology, and the animated glory: [github.com/master5d/viberuler](https://github.com/master5d/viberuler)
````

- [ ] **Step 3: Commit**

```bash
git add README.md packages/cli/README.md
git commit -m "docs(release): README product page + npm readme"
```

---

### Task 4: METHODOLOGY.md + PRIVACY.md

**Files:**
- Create: `METHODOLOGY.md`
- Create: `PRIVACY.md`

Content requirements (write the full documents from these binding facts — copy numbers EXACTLY from code):

**METHODOLOGY.md sections:**
1. *Data sources* — Claude Code `~/.claude/projects/**/*.jsonl` (usage records, deduped by `message.id + requestId` so replayed sessions never double-count); Codex `~/.codex/sessions` (cumulative `token_count`, last record per session); git repos (LoC via `git ls-files`, code extensions only, files >1MB skipped; commits/streak via `git log --author=<your email>`); GitHub API (opt-in, stars only).
2. *Cost model* — bundled static table (USD/MTok): claude-opus 15/75 (cache write 18.75, read 1.5), claude-sonnet 3/15 (3.75/0.30), claude-haiku 1/5 (1.25/0.10), claude-fable = opus tier, codex-default 1.25/10 (read 0.125). Unknown Claude models fall back to sonnet tier. Subscription users: this is **API-equivalent value**, not what you paid — that's the point of the flex.
3. *The formula* — exact code from score.ts incl. the log components table, streak cap 365, 50 pts/achievement, efficiency = 800 × percentile; percentile is live from the leaderboard when submitting, otherwise a fixed offline curve (anchors: log₁₀(tok/$) 4→5%, 5→20%, 6→50%, 6.7→80%, 7.3→95%, 8→99%).
4. *Ranks* — thresholds ≥8000 Singularity Adjacent, ≥6500 GIGACHAD SHIPPER, ≥5000 Ship Machine, ≥3500 Context Goblin, ≥2000 Token Burner, ≥800 Vibe Apprentice, else Prompt Peasant.
5. *Anti-cheat, honestly* — self-reported benchmark; GitHub OAuth = one account one entry; sanity caps (LoC>50M, tokens>100B, >1M tokens under $0.01, tok/$>100M, VIBE>50K, unknown achievement) flag a submission `sus`: stored, hidden from board and public cards until reviewed. "We catch the blatant. We can't catch the clever. It's a meme benchmark — cheat and you're only lying to the group chat."
6. *Known limitations* — GitHub stars capped at 500 repos; price table refreshed per release; codex tokens costed at a fixed rate.

**PRIVACY.md sections:** what never leaves (paths, repo names, prompts, code, language mix); what `--submit` sends (the nine keys, verbatim JSON example); how to verify (payload command + permalinks to payload.ts/submit.ts); data deletion (open an issue / API endpoint TBD post-launch); the only two network paths (`--github`, `--submit`) and their exact endpoints.

- [ ] **Step: write both files, then commit**

```bash
git add METHODOLOGY.md PRIVACY.md
git commit -m "docs(release): methodology + privacy"
```

---

### Task 5: vhs demo tape + LAUNCH.md runbook + Show HN / tweet drafts

**Files:**
- Create: `assets/demo.tape`
- Create: `LAUNCH.md`
- Create: `docs/launch/show-hn.md`
- Create: `docs/launch/social.md`

- [ ] **Step 1: assets/demo.tape** (vhs script; recording happens at launch on a machine with vhs):

```
Output assets/demo.gif
Set FontSize 18
Set Width 900
Set Height 560
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Type "npx viberuler"
Sleep 500ms
Enter
Sleep 6s
Type "npx viberuler --submit"
Sleep 500ms
Enter
Sleep 8s
```

- [ ] **Step 2: LAUNCH.md** — the runbook (verbatim structure, expand each step with the exact commands):

1. `gh repo create master5d/viberuler --public --source . --push` (topics: `cli developer-tools ai benchmark vibe-coding`)
2. Cloudflare: `npx wrangler d1 create viberuler` → paste id into wrangler.jsonc → `npx wrangler d1 migrations apply viberuler --remote` → `npx wrangler deploy` → attach domain `viberuler.dev` (buy at registrar if not owned) → smoke `curl https://viberuler.dev/api/health`
3. GitHub OAuth App (device flow ON) → Client ID into wrangler.jsonc vars + `DEFAULT_CLIENT_ID` in packages/cli/src/submit.ts → redeploy + version bump
4. `npm publish` from packages/cli (`npm whoami` first; prepublishOnly runs gates)
5. Seed: `npx viberuler --submit` from the owner machine; verify `/u/master5d` + OG image render
6. Record demo.gif: `vhs assets/demo.tape`; swap into README under the SVG
7. Create the `good first issue` tickets (cursor/gemini/windsurf/aider/cline collectors) with the Collector interface snippet
8. Post: X thread (docs/launch/social.md) → Show HN (docs/launch/show-hn.md, Tue–Thu ~8am PT) → dev.to/reddit r/ClaudeAI later same day
9. Watch: shields badge flips live; leaderboard fills; triage sus queue via D1 console

- [ ] **Step 3: docs/launch/show-hn.md** — title `Show HN: Viberuler – npx one-liner that benchmarks your vibe coding (tokens per dollar)` + 8-12 line first comment: what it measures, zero-network default, aggregates-only submit with payload preview, formula published, self-reported disclaimer, ask for collector PRs.

- [ ] **Step 4: docs/launch/social.md** — 3-tweet thread draft + LinkedIn post: hook («I burned 8.9B tokens for $18K API-equivalent. My tokens-per-dollar puts me in the top N%. What's yours?»), the terminal SVG/gif, `npx viberuler`, leaderboard link; plus 2 reply-bait variants.

- [ ] **Step 5: Commit**

```bash
git add assets/demo.tape LAUNCH.md docs/launch
git commit -m "docs(release): launch runbook, vhs tape, show-hn + social drafts"
```

---

## Plan-level Definition of Done

- `npm run typecheck && npm test` green (71 CLI + 36 worker).
- README renders correctly on a local Markdown preview; SVG animates in a browser.
- Every number in README/METHODOLOGY cross-checked against pricing.ts / score.ts / validation.ts / achievements.ts.
- LAUNCH.md is executable top-to-bottom by the owner with no missing steps.

## Post-plan (user-gated, via LAUNCH.md)

GitHub repo push, CF deploy + domain, OAuth App, npm publish, seed submit, demo.gif recording, good-first-issues, Show HN.
