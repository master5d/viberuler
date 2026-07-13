import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname, join } from 'node:path';
import type { Collector, ScanContext } from '../types.js';
import { longestStreak } from '../streak.js';

const exec = promisify(execFile);
const MAX_DEPTH = 5;
// Dotted dirs are skipped by the walker already (.cache, .cargo, .rustup...).
// These are the ones that are NOT dotted and still hold nothing a human wrote:
// on Windows every home has AppData\Local\Temp stuffed with half-finished clones,
// which produced a screenful of "failed to scan" and drowned the real repos.
const SKIP_DIRS = new Set([
  'node_modules', '.venv', 'venv', 'dist', 'build', 'target', 'out', 'vendor',
  'AppData', 'Application Data', // Windows
  'Library',                     // macOS
  'Temp', 'tmp',
]);

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.rb': 'Ruby',
  '.cs': 'C#', '.cpp': 'C++', '.cc': 'C++', '.h': 'C/C++', '.hpp': 'C++', '.c': 'C',
  '.swift': 'Swift', '.kt': 'Kotlin', '.php': 'PHP', '.sh': 'Shell', '.ps1': 'PowerShell',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'CSS', '.sql': 'SQL', '.vue': 'Vue', '.svelte': 'Svelte',
};

function escapeGitAuthorPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function classifyExt(filePath: string): string | null {
  return LANG_BY_EXT[extname(filePath).toLowerCase()] ?? null;
}

// Each log line is "<YYYY-MM-DD> <HH>\t<subject>" (pretty=%ad\t%s). We derive
// commit dates + late-night count, plus outcome signals from the subject:
// conventional `feat:` commits (features shipped) and PR merges (merge commits
// or GitHub squash-merges ending in `(#123)`).
const FEAT_RE = /^feat(\([^)]*\))?!?:/i;
const PR_RE = /^merge pull request #\d+|\(#\d+\)\s*$/i;

export function parseGitLog(out: string): { dates: string[]; lateNight: number; feats: number; prs: number } {
  const dates: string[] = [];
  let lateNight = 0, feats = 0, prs = 0;
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t');
    const head = (tab === -1 ? line : line.slice(0, tab)).trim();
    const subject = tab === -1 ? '' : line.slice(tab + 1);
    const m = head.match(/^(\d{4}-\d{2}-\d{2}) (\d{2})$/);
    if (!m) continue;
    dates.push(m[1]!);
    if (Number(m[2]) < 5) lateNight++;
    if (FEAT_RE.test(subject)) feats++;
    if (PR_RE.test(subject)) prs++;
  }
  return { dates, lateNight, feats, prs };
}

async function findRepos(root: string, depth = 0, acc: string[] = []): Promise<string[]> {
  if (depth > MAX_DEPTH) return acc;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  // A repo here does NOT end the walk: people keep project repos inside an outer
  // repo (a workspace root that is itself versioned), and stopping at the first
  // .git silently collapsed all of them into one project. Descending is safe
  // because every figure comes from that repo's own `git log` — a nested repo has
  // its own history, invisible to its parent, so nothing is counted twice.
  if (entries.some((e) => e.name === '.git' && e.isDirectory())) acc.push(root);

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    await findRepos(join(root, e.name), depth + 1, acc);
  }
  return acc;
}

async function authorEmail(ctx: ScanContext): Promise<string | null> {
  if (ctx.authorEmail) return ctx.authorEmail;
  try {
    const { stdout } = await exec('git', ['config', '--get', 'user.email']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Files a machine wrote. Counting these as "code you shipped" is how a benchmark
 * lies to the person holding it: regenerating one types file can be worth more
 * than a month of real work.
 */
const GENERATED = [
  /(^|\/)(dist|build|out|target|vendor|third_party|generated|__generated__)\//i,
  /(^|\/)node_modules\//,
  /\.min\.(js|css)$/i,
  /\.d\.ts$/i, // overwhelmingly emitted by a compiler or `wrangler types`
  /\.(pb|generated)\.(ts|js|go|py|cs)$/i,
  /_pb2(_grpc)?\.py$/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum|Gemfile\.lock)$/i,
  /\.(snap|lock)$/i,
];

export function isGenerated(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return GENERATED.some((re) => re.test(p));
}

/**
 * Lines the author actually committed, per language.
 *
 * The old measure was the size of the repo's tree: every tracked file with a code
 * extension, whoever wrote it. Clone a big project, commit a typo, and it credited
 * you with the whole thing — and it counted generated output as authorship. So it
 * measured "how large are the repos you have on disk", while calling itself "lines
 * of code shipped".
 *
 * This counts additions in commits BY YOU (`git log --numstat`), skipping merges so
 * a merge commit cannot re-count the branch it absorbs. Rewriting the same file
 * repeatedly does add up — that is churn, and it is real work you committed; what
 * it is not is other people's code.
 */
async function authoredLoc(
  repo: string,
  email: string,
  since?: Date,
  until?: Date,
): Promise<Record<string, number>> {
  const byLang: Record<string, number> = {};
  const args = [
    '-C', repo, 'log',
    '--regexp-ignore-case',
    `--author=${escapeGitAuthorPattern(email)}`,
    '--no-merges',
    '--numstat',
    '--diff-filter=ACMR',
    '--pretty=format:',
  ];
  if (since) args.push(`--since=${since.toISOString()}`);
  if (until) args.push(`--until=${until.toISOString()}`);

  const { stdout } = await exec('git', args, { maxBuffer: 128 * 1024 * 1024 });
  for (const line of stdout.split('\n')) {
    // "<added>\t<deleted>\t<path>"; binaries report "-\t-\t<path>"
    const m = /^(\d+)\t(\d+)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    const added = Number(m[1]);
    const path = m[3]!;
    if (isGenerated(path)) continue;
    const lang = classifyExt(path);
    if (!lang) continue;
    byLang[lang] = (byLang[lang] ?? 0) + added;
  }
  return byLang;
}

export const gitCollector: Collector = {
  id: 'git',
  async detect() {
    try {
      await exec('git', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
  async collect(ctx) {
    const email = await authorEmail(ctx);
    if (!email) return { sources: ['git'], warnings: ['git: no user.email configured — skipping repo scan'] };

    const repos: string[] = [];
    for (const root of ctx.scanDirs) await findRepos(root, 0, repos);

    let projects = 0, commits = 0, lateNightCommits = 0, historyRewrites = 0;
    let featsShipped = 0, prsMerged = 0;
    let locTotal = 0, maxRepoLoc = 0;
    const locByLang: Record<string, number> = {};
    const allDates: string[] = [];
    const warnings: string[] = [];

    for (const repo of repos) {
      try {
        const logArgs = [
          '-C',
          repo,
          'log',
          '--regexp-ignore-case',
          `--author=${escapeGitAuthorPattern(email)}`,
          '--date=format:%Y-%m-%d %H',
          '--pretty=format:%ad%x09%s',
        ];
        if (ctx.since) logArgs.push(`--since=${ctx.since.toISOString()}`);
        if (ctx.until) logArgs.push(`--until=${ctx.until.toISOString()}`);
        const { stdout } = await exec('git', logArgs, { maxBuffer: 64 * 1024 * 1024 });
        const { dates, lateNight, feats, prs } = parseGitLog(stdout);
        if (dates.length === 0) continue; // not our repo

        projects++;
        commits += dates.length;
        lateNightCommits += lateNight;
        featsShipped += feats;
        prsMerged += prs;
        allDates.push(...dates);

        try {
          const { stdout: reflog } = await exec('git', ['-C', repo, 'reflog', '--format=%gs'], { maxBuffer: 16 * 1024 * 1024 });
          historyRewrites += reflog.split('\n').filter((l) => /^(rebase|reset: moving)/.test(l)).length;
        } catch { /* fresh clone without reflog — fine */ }

        const byLang = await authoredLoc(repo, email, ctx.since, ctx.until);
        let repoLoc = 0;
        for (const [lang, n] of Object.entries(byLang)) {
          locByLang[lang] = (locByLang[lang] ?? 0) + n;
          repoLoc += n;
        }
        locTotal += repoLoc;
        if (repoLoc > maxRepoLoc) maxRepoLoc = repoLoc;
      } catch (err) {
        // The basename alone is useless: several repos share one, and it hides
        // WHY. Say which path and what git actually said — this is local stderr,
        // it is never part of the submit payload.
        const why = err instanceof Error ? err.message.split('\n')[0] : String(err);
        warnings.push(`git: failed to scan ${repo} — ${why}`);
      }
    }

    let busiestDay: string | null = null;
    let busiestDayCount = 0;
    const dayCounts = new Map<string, number>();
    for (const d of allDates) {
      const n = (dayCounts.get(d) ?? 0) + 1;
      dayCounts.set(d, n);
      if (n > busiestDayCount) { busiestDayCount = n; busiestDay = d; }
    }

    return {
      projects, commits, featsShipped, prsMerged, streakDays: longestStreak(allDates), lateNightCommits, historyRewrites,
      locTotal, locByLang, maxRepoLoc, sources: ['git'], warnings,
      busiestDay, busiestDayCount,
    };
  },
};
