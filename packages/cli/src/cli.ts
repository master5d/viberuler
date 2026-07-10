import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import type { Collector, ScanContext, RawStats } from './types.js';
import { emptyStats, mergeStats, totalTokens } from './merge.js';
import { claudeCodeCollector } from './collectors/claude-code.js';
import { codexCollector } from './collectors/codex.js';
import { clineCollector } from './collectors/cline.js';
import { geminiCollector } from './collectors/gemini.js';
import { cursorCollector } from './collectors/cursor.js';
import { litellmCollector } from './collectors/litellm.js';
import { agentsCollector } from './collectors/agents.js';
import { gitCollector } from './collectors/git.js';
import { githubCollector } from './collectors/github.js';
import { computeScore } from './score.js';
import { renderCard } from './render.js';
import { renderWrapped } from './wrapped.js';
import { buildPayload } from './payload.js';
import { DEFAULT_API, DEFAULT_CLIENT_ID, githubDeviceFlow, fetchPercentile, submitScore, shareLinks } from './submit.js';

const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector, clineCollector, geminiCollector, cursorCollector, litellmCollector, agentsCollector, gitCollector, githubCollector];

const USAGE = `viberuler — the benchmark for vibe coders

Usage: viberuler [payload] [options]

Commands:
  (default)            scan + render your scorecard (100% local)
  payload              print the exact JSON that --submit WOULD send (nothing is sent)
  wrapped              monthly recap card — needs --month YYYY-MM (Claude Code + git)

Options:
  --scan-dir <path>    git scan root, repeatable        (default: your home dir)
  --since <date>       only count activity since YYYY-MM-DD
  --month <YYYY-MM>    the month for \`wrapped\`
  --github <handle>    also pull public GitHub stars    (the only network call)
  --json               machine-readable full report
  --no-color           plain output
  --submit             push your score to the global leaderboard (GitHub device flow)
  --yes                skip the submit confirmation
  --version            print version
  --help               this help

Env (opt-in): LITELLM_SPEND_DB=<sqlite path> or LITELLM_BASE_URL(+LITELLM_API_KEY)
  count tokens your self-built agents burned through a LiteLLM gateway
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  return pkg.version as string;
}

export async function collectAll(
  ctx: ScanContext,
  warn: (s: string) => void,
  collectors: Collector[] = COLLECTORS,
): Promise<RawStats> {
  let stats = emptyStats();
  for (const collector of collectors) {
    try {
      if (!(await collector.detect(ctx))) continue;
      const res = await collector.collect(ctx);
      stats = mergeStats(stats, res);
      // Per-agent token attribution for the distribution strip. Token-bearing
      // collectors report either a single agent name or just a source; map the
      // source to a friendly label when no agent name is emitted.
      const tt = res.tokens ? totalTokens(res.tokens) : 0;
      if (tt > 0) {
        const label =
          res.agents && res.agents.length === 1
            ? res.agents[0]!
            : (res.sources && res.sources[0] && SOURCE_LABELS[res.sources[0]]) || res.sources?.[0] || 'other';
        stats.tokensByAgent[label] = (stats.tokensByAgent[label] ?? 0) + tt;
      }
    } catch (err) {
      warn(`[viberuler] ${collector.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}

// Friendly labels for the token collectors that report only a source (no agent
// display name). cline/gemini emit their own agent name, so they skip this.
const SOURCE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  cline: 'Cline',
  gemini: 'Gemini CLI',
  litellm: 'LiteLLM gateway',
};

export async function main(
  argv: string[],
  out: (line: string) => void = console.log,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'scan-dir': { type: 'string', multiple: true },
        since: { type: 'string' },
        month: { type: 'string' },
        github: { type: 'string' },
        json: { type: 'boolean' },
        'no-color': { type: 'boolean' },
        submit: { type: 'boolean' },
        yes: { type: 'boolean' },
        version: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
  } catch {
    process.stderr.write(USAGE);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.version) { out(version()); return 0; }
  if (values.help) { out(USAGE); return 0; }

  const command = positionals[0] ?? 'card';
  if (command !== 'card' && command !== 'payload' && command !== 'wrapped') {
    process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
    return 1;
  }

  const home = process.env.VIBERULER_HOME ?? homedir();
  const since = values.since ? new Date(`${values.since}T00:00:00Z`) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    process.stderr.write('Invalid --since date, expected YYYY-MM-DD\n');
    return 1;
  }

  if (command === 'wrapped') {
    const month = values.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      process.stderr.write('wrapped requires --month YYYY-MM\n');
      return 1;
    }
    const monthStart = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(monthStart.getTime())) {
      process.stderr.write('invalid --month, expected YYYY-MM\n');
      return 1;
    }
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const wctx: ScanContext = {
      home,
      scanDirs: values['scan-dir'] ?? [home],
      since: monthStart,
      until: nextMonth,
      authorEmail: process.env.VIBERULER_AUTHOR_EMAIL,
      env: process.env,
    };
    const wstats = await collectAll(wctx, (s) => process.stderr.write(s + '\n'), [claudeCodeCollector, gitCollector]);
    for (const w of wstats.warnings) process.stderr.write(`[viberuler] ${w}\n`);
    const colors = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !values['no-color'];
    out(renderWrapped(computeScore(wstats), month, { colors, version: version() }));
    return 0;
  }

  const ctx: ScanContext = {
    home,
    scanDirs: values['scan-dir'] ?? [home],
    since,
    githubHandle: values.github,
    authorEmail: process.env.VIBERULER_AUTHOR_EMAIL,
    env: process.env,
  };

  const stats = await collectAll(ctx, (s) => process.stderr.write(s + '\n'));
  for (const w of stats.warnings) process.stderr.write(`[viberuler] ${w}\n`);
  let report = computeScore(stats);

  if (values.submit) {
    const apiBase = process.env.VIBERULER_API ?? DEFAULT_API;
    const clientId = process.env.VIBERULER_GITHUB_CLIENT_ID ?? DEFAULT_CLIENT_ID;

    if (report.tokPerUsd !== null) {
      const live = await fetchPercentile(apiBase, report.tokPerUsd, deps.fetchImpl);
      if (live !== null) report = computeScore(stats, live);
    }

    const colors = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !values['no-color'];
    out(renderCard(report, { colors, version: version() }));

    const payload = buildPayload(report, version());
    out('');
    out('This is EVERYTHING that leaves your machine:');
    out(JSON.stringify(payload, null, 2));

    if (!values.yes) {
      if (!process.stdin.isTTY) {
        process.stderr.write('refusing to submit without --yes in non-interactive mode\n');
        return 1;
      }
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const answer = (await rl.question('Submit to the global leaderboard? [y/N] ')).trim().toLowerCase();
      rl.close();
      if (answer !== 'y' && answer !== 'yes') { out('aborted.'); return 1; }
    }

    try {
      const token = await githubDeviceFlow(clientId, { fetchImpl: deps.fetchImpl, out });
      const result = await submitScore(apiBase, token, payload, deps.fetchImpl);
      if (!result.ok) {
        process.stderr.write(`submit failed (${result.status}): ${result.error ?? 'unknown'}\n`);
        return 1;
      }
      out('');
      out(`  LIVE: ${result.url}${result.rank ? `  ·  GLOBAL RANK #${result.rank}` : ''}${result.sus ? '  (under review)' : ''}`);
      const links = shareLinks(result.url ?? apiBase, payload);
      out('');
      out('  Flex it:');
      out(`    X:        ${links.x}`);
      out(`    LinkedIn: ${links.linkedin}`);
      out(`    Facebook: ${links.facebook}`);
      out(`    Bluesky:  ${links.bluesky}`);
      out('');
      out(`  📲 Stories: open ${result.url} on your phone → "Share to Stories" (Instagram · WhatsApp · Facebook)`);
      return 0;
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  if (command === 'payload') {
    out(JSON.stringify(buildPayload(report, version()), null, 2));
    return 0;
  }
  if (values.json) {
    out(JSON.stringify(report, null, 2));
    return 0;
  }
  const colors = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !values['no-color'];
  out(renderCard(report, { colors, version: version() }));
  return 0;
}
