# Contributing

The most useful thing you can add is a **collector** — support for a coding agent
we don't read yet. Windsurf ([#3](https://github.com/master5d/viberuler/issues/3))
and Aider ([#4](https://github.com/master5d/viberuler/issues/4)) are open and
labelled `good first issue`. Each is about 70 lines plus a test.

```bash
git clone https://github.com/master5d/viberuler && cd viberuler
npm install
npm test --workspace packages/cli        # 188 tests, ~10s
```

## Add a collector in three steps

A collector answers two questions: *is this agent on the machine?* and *what did
it burn?* That's the whole interface.

```ts
export interface Collector {
  id: string;
  detect(ctx: ScanContext): Promise<boolean>;   // false → silently skipped
  collect(ctx: ScanContext): Promise<Partial<RawStats>>;
}
```

**1. Declare where the agent lives — do not join `ctx.home` by hand.**

People relocate their agents (`C:\agents\Claude\.claude`, `~/work/codex`), and
most agents ship an env var to say so. `resolveRoots` searches every known home
plus that env var, and dedups the result, so mounting the same logs twice cannot
double-count them:

```ts
import { resolveRoots, type RootSpec } from '../roots.js';

const LOGS: RootSpec = {
  under: ['.windsurf', 'sessions'],   // relative to each agent home
  env: 'WINDSURF_HOME',               // the agent's own relocation var, if it has one
  envUnder: ['sessions'],             // …and the sub-path under it
};

async detect(ctx) {
  return (await resolveRoots(ctx, LOGS)).length > 0;
}
```

**2. Parse defensively, and export the parser.**

Keep the pure function separate from the filesystem walk — that is what the tests
call, with fixtures, and it means a malformed line can never take the run down:

```ts
export function parseWindsurfLog(content: string): TokenUsage | null { … }
```

A single unparseable line must be skipped, not thrown. Users have gigabytes of
half-written JSONL and a crash on line 4,000,000 is a bug report, not a signal.

**3. Return only what you know.**

`collect` returns a `Partial<RawStats>` — usually just `tokens`, `costUsd`, and
`sources: ['windsurf']`. Everything is merged and totalled for you. Price tokens
through [`pricing.ts`](packages/cli/src/pricing.ts); if the model isn't in the
table, add it there rather than hardcoding a number in your collector.

Then register it in `COLLECTORS` in [`cli.ts`](packages/cli/src/cli.ts), and add
a display name to `SOURCE_LABELS` if your collector reports a source without an
agent name.

## The rules that actually get PRs rejected

- **Zero network calls.** The default run is offline and stays offline. The only
  network paths in the whole CLI are `--github` and `--submit`.
- **Never widen the submit payload.** It is fourteen aggregate fields, frozen,
  and the server rejects a payload with any extra key. Tool names, file paths,
  and repo names are a fingerprint of how someone works — they do not leave the
  machine. See [PRIVACY.md](PRIVACY.md).
- **Absent agent → silent skip.** `detect` returns false; no warning, no output.
  Nobody wants to be told they don't have Aider installed.
- **Tests use sacrificial temp dirs.** `mkdtemp(join(tmpdir(), 'vibe-…'))` — never
  the real `~/.claude`, never a real repo. A test that writes to a user's actual
  agent home is an automatic no.
- **No new runtime dependencies.** The CLI ships one (`picocolors`) and that's the
  point — `npx viberuler` should stay instant.

## Numbers must be defensible

This is a benchmark, so a wrong number is worse than a missing one. If you add a
statistic, [METHODOLOGY.md](METHODOLOGY.md) must be able to explain how it is
derived. Two traps that already bit us, both worth knowing before you parse
anyone's logs:

- **Claude Code replays entries in its JSONL.** More than half the usage records
  on a real 10k-session corpus are duplicates. Dedup by `message.id + requestId`
  or every number you print is roughly double the truth.
- **A pooled average lies.** Context amplification looked like 382× until the
  subagent chains were separated out; the main thread's real figure was 1088×.
  When two populations behave differently, report them separately.

## Style

Match the file you're in. Comments explain *why*, never *what* — if a line needs a
comment to say what it does, rename something instead. Commit messages say what
changed and why it mattered; the diff already says how.
