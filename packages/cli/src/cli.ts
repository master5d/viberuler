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
import { createColors } from 'picocolors';
import { runAudit, runAuditCompare } from './audit.js';
import { renderAudit } from './render-audit.js';
import { buildPayload } from './payload.js';
import {
  DEFAULT_API,
  DEFAULT_CLIENT_ID,
  githubDeviceFlow,
  fetchPercentile,
  submitScore,
  shareLinks,
  readCachedToken,
  saveCachedToken,
  clearCachedToken,
  type SubmitResult,
} from './submit.js';
import { parseHomeList, isInsideGitRepo } from './roots.js';
import { shareCardUrl, type ShareCardData } from './share-card.js';
import { collectTime, type TimeReport } from './time-collect.js';

const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector, clineCollector, geminiCollector, cursorCollector, litellmCollector, agentsCollector, gitCollector, githubCollector];

/**
 * Colour by TTY, but honour the two env conventions everyone else honours:
 * NO_COLOR to force it off, FORCE_COLOR to force it on. Without FORCE_COLOR a
 * piped run is always grey — which silently ruins captured output (demo
 * recordings, CI logs, anything reading us through a pipe).
 */
export function shouldColor(noColorFlag: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (noColorFlag || env.NO_COLOR) return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0';
  return Boolean(process.stdout.isTTY);
}

export function parseCompareRange(rangeStr: string): {
  windowA: { since: Date; until: Date };
  windowB: { since: Date; until: Date };
} | null {
  if (typeof rangeStr !== 'string') return null;
  const parts = rangeStr.split('..');
  if (parts.length !== 2) return null;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(parts[0]!) || !dateRegex.test(parts[1]!)) return null;

  const start = new Date(`${parts[0]}T00:00:00Z`);
  const end = new Date(`${parts[1]}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (!start.toISOString().startsWith(parts[0]!) || !end.toISOString().startsWith(parts[1]!)) return null;
  if (start.getTime() >= end.getTime()) return null;

  const duration = end.getTime() - start.getTime();
  const bUntil = new Date(end.getTime() + duration);

  return {
    windowA: { since: start, until: end },
    windowB: { since: end, until: bUntil },
  };
}

const USAGE = `viberuler — the benchmark for vibe coders

Usage: viberuler [payload] [options]

Commands:
  (default)            scan + render your scorecard (100% local)
  payload              print the exact JSON that --submit WOULD send (nothing is sent)
  wrapped              monthly recap card — needs --month YYYY-MM (Claude Code + git)
  audit                audit your rig: cache economy, context amplification,
                       and MCP tools that are loaded but never called (dead weight)
                       (add --why for root-cause attribution)

Options:
  --scan-dir <path>    git scan root, repeatable        (default: your home dir)
  --agent-home <path>  extra agent home, repeatable — for rigs that keep their
                       agents outside the OS home (C:\\agents\\Claude, ...).
                       CODEX_HOME / CLAUDE_CONFIG_DIR are honoured automatically.
  --since <date>       only count activity since YYYY-MM-DD
  --compare A..B       two windows: the range, then the equally long span after it
  --month <YYYY-MM>    the month for \`wrapped\`
  --idle-gap <min>     max pause before idle, in minutes (default: 3)
  --github <handle>    also pull public GitHub stars    (the only network call)
  --api <url>          custom API base URL              (default: https://viberuler.dev)
  --json               machine-readable full report
  --no-color           plain output
  --share              print a shareable card URL (nothing is sent)
  --submit             push your score to the global leaderboard (GitHub device flow)
  --yes                skip the submit confirmation
  --version            print version
  --help               this help

Env (opt-in): LITELLM_SPEND_DB=<sqlite path> or LITELLM_BASE_URL(+LITELLM_API_KEY)
  count tokens your self-built agents burned through a LiteLLM gateway
Env: VIBERULER_AGENT_HOMES=<path list>  same as repeating --agent-home
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
        'agent-home': { type: 'string', multiple: true },
        since: { type: 'string' },
        compare: { type: 'string' },
        month: { type: 'string' },
        'idle-gap': { type: 'string', default: '3' },
        github: { type: 'string' },
        json: { type: 'boolean' },
        'no-color': { type: 'boolean' },
        submit: { type: 'boolean' },
        share: { type: 'boolean' },
        api: { type: 'string' },
        yes: { type: 'boolean' },
        why: { type: 'boolean' },
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
  if (command !== 'card' && command !== 'payload' && command !== 'wrapped' && command !== 'audit') {
    process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
    return 1;
  }

  if (values.compare !== undefined && command !== 'audit') {
    process.stderr.write('--compare is only used by audit\n');
  }

  const home = process.env.VIBERULER_HOME ?? homedir();
  // Multi-agent rigs relocate agents out of the OS home entirely. Extra roots
  // come from --agent-home (repeatable) or VIBERULER_AGENT_HOMES (a path list).
  const agentHomes = [
    ...(values['agent-home'] ?? []),
    ...parseHomeList(process.env.VIBERULER_AGENT_HOMES),
  ];
  const since = values.since ? new Date(`${values.since}T00:00:00Z`) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    process.stderr.write('Invalid --since date, expected YYYY-MM-DD\n');
    return 1;
  }

  const idleGapStr = values['idle-gap'] ?? '3';
  const idleGapMin = Number(idleGapStr);
  if (!Number.isFinite(idleGapMin) || idleGapMin <= 0) {
    process.stderr.write('Invalid --idle-gap, expected positive number of minutes\n');
    return 1;
  }
  const gapMs = idleGapMin * 60 * 1000;

  if (command === 'audit') {
    if (values.compare !== undefined) {
      if (values.since !== undefined) {
        process.stderr.write('--since is ignored when --compare is given\n');
      }
      const range = parseCompareRange(values.compare);
      if (!range) {
        process.stderr.write('Invalid --compare range, expected YYYY-MM-DD..YYYY-MM-DD\n');
        return 1;
      }
      const actx: ScanContext = { home, agentHomes, scanDirs: [], authorEmail: undefined, env: process.env };
      const compare = await runAuditCompare(actx, range.windowA, range.windowB, gapMs);
      for (const w of compare.warnings ?? []) {
        if (!w.includes('extends past now')) {
          process.stderr.write(`[viberuler] ${w}\n`);
        }
      }
      if (values.json) { out(JSON.stringify(compare, null, 2)); return 0; }
      const colors = shouldColor(Boolean(values['no-color']));
      out(renderAudit({ compare } as any, { colors, version: version() }));
      return 0;
    }
    const actx: ScanContext = { home, agentHomes, scanDirs: [], since, authorEmail: undefined, env: process.env };
    actx.why = Boolean(values.why);
    const report = await runAudit(actx, gapMs);
    for (const w of report.warnings) process.stderr.write(`[viberuler] ${w}\n`);
    if (values.json) { out(JSON.stringify(report, null, 2)); return 0; }
    const colors = shouldColor(Boolean(values['no-color']));
    out(renderAudit(report, { colors, version: version() }));
    return 0;
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
      agentHomes,
      scanDirs: values['scan-dir'] ?? [home],
      since: monthStart,
      until: nextMonth,
      authorEmail: process.env.VIBERULER_AUTHOR_EMAIL,
      env: process.env,
    };
    const wstats = await collectAll(wctx, (s) => process.stderr.write(s + '\n'), [claudeCodeCollector, gitCollector]);
    for (const w of wstats.warnings) process.stderr.write(`[viberuler] ${w}\n`);
    const colors = shouldColor(Boolean(values['no-color']));
    out(renderWrapped(computeScore(wstats), month, { colors, version: version() }));
    return 0;
  }

  const ctx: ScanContext = {
    home,
    agentHomes,
    scanDirs: values['scan-dir'] ?? [home],
    since,
    githubHandle: values.github,
    authorEmail: process.env.VIBERULER_AUTHOR_EMAIL,
    env: process.env,
  };

  const stats = await collectAll(ctx, (s) => process.stderr.write(s + '\n'));
  for (const w of stats.warnings) process.stderr.write(`[viberuler] ${w}\n`);
  let report = computeScore(stats);

  let timeReportPromise: Promise<TimeReport | undefined> | null = null;
  const getTimeReport = (): Promise<TimeReport | undefined> => {
    if (!timeReportPromise) {
      timeReportPromise = collectTime(ctx, gapMs).catch(() => undefined);
    }
    return timeReportPromise;
  };

  if (values.submit) {
    const apiBase = values.api ?? process.env.VIBERULER_API ?? DEFAULT_API;
    const clientId = process.env.VIBERULER_GITHUB_CLIENT_ID ?? DEFAULT_CLIENT_ID;

    if (report.tokPerUsd !== null) {
      const live = await fetchPercentile(apiBase, report.tokPerUsd, deps.fetchImpl);
      if (live !== null) report = computeScore(stats, live);
    }

    const colors = shouldColor(Boolean(values['no-color']));
    const timeReport = await getTimeReport();
    out(renderCard(report, { colors, version: version(), timeReport }));

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
      let token = await readCachedToken(home);
      let result: SubmitResult;

      if (token) {
        out('using saved GitHub auth');
        result = await submitScore(apiBase, token, payload, deps.fetchImpl);
        if (!result.ok && (result.status === 401 || result.status === 403)) {
          await clearCachedToken(home);
          token = await githubDeviceFlow(clientId, { fetchImpl: deps.fetchImpl, out });
          await saveCachedToken(token, home);
          result = await submitScore(apiBase, token, payload, deps.fetchImpl);
        }
      } else {
        token = await githubDeviceFlow(clientId, { fetchImpl: deps.fetchImpl, out });
        await saveCachedToken(token, home);
        result = await submitScore(apiBase, token, payload, deps.fetchImpl);
      }

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
  const colors = shouldColor(Boolean(values['no-color']));
  const timeReport = await getTimeReport();
  out(renderCard(report, { colors, version: version(), timeReport }));

  if (values.share) {
    const apiBase = values.api ?? process.env.VIBERULER_API ?? DEFAULT_API;
    const payload = buildPayload(report, version());
    const cardData: ShareCardData = {
      v: payload.client_version,
      s: payload.vibe_score,
      tpu: payload.tok_per_usd,
      tpl: payload.tok_per_loc,
      loc: payload.loc,
      streak: payload.streak_days,
      agents: payload.agents,
      ...(timeReport && timeReport.totalActiveMs > 0
        ? { hours: Number((timeReport.totalActiveMs / 3600000).toFixed(1)) }
        : {}),
    };
    const cardUrl = shareCardUrl(apiBase, cardData);
    const links = shareLinks(cardUrl, payload);
    out('');
    out('share your card:');
    out(cardUrl);
    out('');
    out('  Flex it:');
    out(`    X:        ${links.x}`);
    out(`    LinkedIn: ${links.linkedin}`);
    out(`    Facebook: ${links.facebook}`);
    out(`    Bluesky:  ${links.bluesky}`);
    out('');
    out(`  📲 Stories: open ${cardUrl} on your phone → "Share to Stories" (Instagram · WhatsApp · Facebook)`);
  }

  const c = createColors(colors);
  const formattedScanDirs = ctx.scanDirs.map((d) => (/\s/.test(d) ? `"${d}"` : d)).join(' ');
  out('');
  out(c.dim('share:  viberuler --share'));
  out(c.dim(`board:  viberuler --scan-dir ${formattedScanDirs} --submit`));

  if (stats.projects === 0 && (await isInsideGitRepo(ctx.scanDirs))) {
    out(
      c.dim(
        'hint: no projects found — if your repos live under an outer repo, point --scan-dir at the folder that holds them',
      ),
    );
  }

  return 0;
}

