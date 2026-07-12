# Privacy

Short version: **the scanner reads your machine so that nothing else has to.**

## What never leaves your machine

- File paths, directory names, repo names
- Your prompts, your conversations, your code — any content of any file
- Your language mix, per-repo stats, commit messages, email address
- Anything at all, on a default run: `npx viberuler` makes **zero network calls**. You can verify with any traffic monitor, or by reading the code — every network call in the CLI lives behind the `--github` and `--submit` flags.

## `viberuler audit` reads your transcripts — and keeps them

`audit` is the most invasive thing this tool does: it reads your Claude Code
transcripts (`~/.claude/projects/**/*.jsonl`) and your MCP config. Those files
contain your actual conversations.

It reads them **entirely locally**, prints aggregates, and sends **nothing** —
`audit` makes zero network calls and has no `--submit` path. Your tool names,
session contents, and MCP setup are a fingerprint of how you work; none of it is
part of the submit payload and none of it ever will be. The audit exists to show
*you* what your rig costs *you*.

## What `--submit` sends

Exactly fourteen fields — aggregates only. This is the complete, real shape (built in [`packages/cli/src/payload.ts`](packages/cli/src/payload.ts), ~30 lines):

```json
{
  "client_version": "0.4.1",
  "vibe_score": 3101,
  "loc": 312441,
  "projects": 47,
  "tokens": 1200000000,
  "cost_usd": 184.2,
  "tok_per_usd": 6500000,
  "tok_per_loc": 8400,
  "streak_days": 32,
  "feats_shipped": 57,
  "prs_merged": 12,
  "agents": ["Claude Code", "Codex", "Gemini CLI"],
  "achievements": ["token-billionaire", "cache-whisperer"],
  "breakdown": { "volume": 1000, "leverage": 1500, "efficiency": 300, "breadth": 101, "streak": 100, "achievements": 100 }
}
```

`streak_days` is your current daily-commit streak (an integer). `feats_shipped`
and `prs_merged` are counts derived from `git log` across all your scanned repos
(conventional `feat:` commits, and merge / squash-merged PRs) — aggregate
integers, no messages or repo names. `agents` is the list of coding-agent
**names** detected on your machine (e.g. `Claude Code`, `Codex`, `Cline`,
`Gemini CLI`, `Cursor`) — a display-only toolchain flex shown on your
certificate. No file paths, repo names, code, or prompts are ever sent.
Older clients omit the newer fields; the server stores them as null.

The server validates this shape **strictly** ([`packages/worker/src/validation.ts`](packages/worker/src/validation.ts)) — a payload with any extra key is rejected, so even a modified client can't smuggle more data into our database.

Identity comes from GitHub device-flow OAuth: we store your GitHub login, numeric id, avatar URL, and account-creation date — the things your public GitHub profile already shows.

## How to verify, not trust

1. `npx viberuler payload` — prints the exact JSON that `--submit` *would* send. Nothing is sent.
2. Even during `--submit`, the CLI prints that same JSON under the banner **"This is EVERYTHING that leaves your machine"** and requires confirmation (`--yes` or an interactive y/N) before any request is made.
3. Read the two files that do all the talking: [`packages/cli/src/payload.ts`](packages/cli/src/payload.ts) and [`packages/cli/src/submit.ts`](packages/cli/src/submit.ts). The whole backend is open source in [`packages/worker`](packages/worker).

## The only network paths

| Flag | Endpoint(s) | Purpose |
|---|---|---|
| `--github <handle>` | `api.github.com/users/<handle>/repos` | Public star counts (opt-in) |
| `--submit` | `viberuler.dev/api/percentile` · `github.com/login/device/code` + `github.com/login/oauth/access_token` · `viberuler.dev/api/submit` | Live percentile · device-flow login · the ten-field payload |

No telemetry, no analytics, no "anonymous usage statistics", no phone-home version check.

## Data deletion

Open an issue at [github.com/master5d/viberuler/issues](https://github.com/master5d/viberuler/issues) with your GitHub handle and we'll delete your rows. A self-serve `DELETE /api/me` endpoint is on the roadmap.
