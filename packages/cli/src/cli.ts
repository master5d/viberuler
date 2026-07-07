import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Collector, ScanContext, RawStats } from './types.js';
import { emptyStats, mergeStats } from './merge.js';
import { claudeCodeCollector } from './collectors/claude-code.js';
import { codexCollector } from './collectors/codex.js';
import { gitCollector } from './collectors/git.js';
import { githubCollector } from './collectors/github.js';
import { computeScore } from './score.js';
import { renderCard } from './render.js';
import { buildPayload } from './payload.js';

const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector, gitCollector, githubCollector];

const USAGE = `viberuler — the benchmark for vibe coders

Usage: viberuler [payload] [options]

Commands:
  (default)            scan + render your scorecard (100% local)
  payload              print the exact JSON that --submit WOULD send (nothing is sent)

Options:
  --scan-dir <path>    git scan root, repeatable        (default: your home dir)
  --since <date>       only count activity since YYYY-MM-DD
  --github <handle>    also pull public GitHub stars    (the only network call)
  --json               machine-readable full report
  --no-color           plain output
  --version            print version
  --help               this help
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  return pkg.version as string;
}

export async function collectAll(ctx: ScanContext, warn: (s: string) => void): Promise<RawStats> {
  let stats = emptyStats();
  for (const collector of COLLECTORS) {
    try {
      if (!(await collector.detect(ctx))) continue;
      stats = mergeStats(stats, await collector.collect(ctx));
    } catch (err) {
      warn(`[viberuler] ${collector.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}

export async function main(argv: string[], out: (line: string) => void = console.log): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'scan-dir': { type: 'string', multiple: true },
        since: { type: 'string' },
        github: { type: 'string' },
        json: { type: 'boolean' },
        'no-color': { type: 'boolean' },
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
  if (command !== 'card' && command !== 'payload') {
    process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
    return 1;
  }

  const home = process.env.VIBERULER_HOME ?? homedir();
  const since = values.since ? new Date(`${values.since}T00:00:00Z`) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    process.stderr.write('Invalid --since date, expected YYYY-MM-DD\n');
    return 1;
  }
  const ctx: ScanContext = {
    home,
    scanDirs: values['scan-dir'] ?? [home],
    since,
    githubHandle: values.github,
    authorEmail: process.env.VIBERULER_AUTHOR_EMAIL,
  };

  const stats = await collectAll(ctx, (s) => process.stderr.write(s + '\n'));
  for (const w of stats.warnings) process.stderr.write(`[viberuler] ${w}\n`);
  const report = computeScore(stats);

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
