import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, collectAll } from '../src/cli.js';
import type { Collector } from '../src/types.js';
import { decodeShareCard } from '../src/share-card.js';

const fixture = fileURLToPath(new URL('./fixtures/claude/session-a.jsonl', import.meta.url));

let home: string;
let repoDir: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'vibe-cli-'));
  // fake ~/.claude/projects
  const proj = join(home, '.claude', 'projects', 'p1');
  await mkdir(proj, { recursive: true });
  await copyFile(fixture, join(proj, 's.jsonl'));
  // sacrificial git repo
  repoDir = join(home, 'code', 'proj1');
  await mkdir(repoDir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-C', repoDir, ...a]);
  git('init');
  git('config', 'user.email', 'vibe@test.local');
  git('config', 'user.name', 'V');
  await writeFile(join(repoDir, 'a.ts'), 'let x = 1;\n');
  git('add', '-A');
  git('commit', '-m', 'x');
  process.env.VIBERULER_HOME = home;
  process.env.VIBERULER_AUTHOR_EMAIL = 'vibe@test.local';
  // Pin the Cline collector dormant: it derives VS Code globalStorage from the
  // real APPDATA (correct in prod, but escapes this fake home), which would flip
  // the token assertions red on a dev box that has used Cline/Roo/Kilo.
  process.env.VIBERULER_CLINE_STORAGE = join(home, 'no-cline');
});

afterAll(() => {
  delete process.env.VIBERULER_HOME;
  delete process.env.VIBERULER_AUTHOR_EMAIL;
  delete process.env.VIBERULER_CLINE_STORAGE;
});

async function run(args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await main(args, (l) => lines.push(l));
  return { code, lines };
}

describe('collectAll per-agent token attribution', () => {
  const mk = (id: string, part: object): Collector => ({
    id,
    detect: async () => true,
    collect: async () => part as never,
  });

  it('attributes tokens to the agent name, falling back to a source label', async () => {
    const collectors = [
      // no agent name → mapped from source 'claude-code'
      mk('a', { tokens: { input: 600, output: 0, cacheWrite: 0, cacheRead: 0 }, sources: ['claude-code'] }),
      // explicit agent name wins over the source
      mk('b', { tokens: { input: 300, output: 0, cacheWrite: 0, cacheRead: 0 }, sources: ['gemini'], agents: ['Antigravity'] }),
      // no tokens → no strip entry
      mk('c', { agents: ['Cursor'] }),
    ];
    const stats = await collectAll({ home: '/', scanDirs: [] }, () => {}, collectors);
    expect(stats.tokensByAgent).toEqual({ 'Claude Code': 600, Antigravity: 300 });
  });
});

describe('main', () => {
  it('--json emits a full report with merged sources', async () => {
    const { code, lines } = await run(['--json', '--scan-dir', join(home, 'code')]);
    expect(code).toBe(0);
    const report = JSON.parse(lines.join('\n'));
    expect(report.stats.sources).toContain('claude-code');
    expect(report.stats.sources).toContain('git');
    expect(report.stats.tokens.input).toBe(100);
    expect(report.stats.projects).toBe(1);
    expect(report.vibe).toBeGreaterThan(0);
  });

  it('default command renders the card', async () => {
    const { code, lines } = await run(['--no-color', '--scan-dir', join(home, 'code')]);
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('VIBE SCORE');
    expect(text).toContain('THE BUREAU CERTIFIES:');
  });

  it('payload command prints the aggregates-only JSON', async () => {
    const { code, lines } = await run(['payload', '--scan-dir', join(home, 'code')]);
    expect(code).toBe(0);
    const p = JSON.parse(lines.join('\n'));
    expect(p).toHaveProperty('vibe_score');
    expect(p).toHaveProperty('tok_per_usd');
    expect(p).not.toHaveProperty('locByLang');
  });

  it('--version prints the package version', async () => {
    const { code, lines } = await run(['--version']);
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--help prints usage and exits 0', async () => {
    const { code, lines } = await run(['--help']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('--scan-dir');
  });

  it('unknown flag exits 1 with usage on stderr path', async () => {
    const { code } = await run(['--bogus']);
    expect(code).toBe(1);
  });

  it('wrapped renders a monthly recap card', async () => {
    const { code, lines } = await run(['wrapped', '--month', '2026-06', '--no-color']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('VIBE WRAPPED');
    expect(lines.join('\n')).toContain('2026-06');
  });

  it('wrapped rejects a malformed month', async () => {
    const { code } = await run(['wrapped', '--month', 'June', '--no-color']);
    expect(code).toBe(1);
  });

  it('audit --json output contains time object', async () => {
    const { code, lines } = await run(['audit', '--json']);
    expect(code).toBe(0);
    const report = JSON.parse(lines.join('\n'));
    expect(report.time).toBeDefined();
    expect(report.time).toHaveProperty('totalWallMs');
    expect(report.time).toHaveProperty('totalActiveMs');
  });

  it('audit rejects invalid --idle-gap', async () => {
    const { code } = await run(['audit', '--idle-gap', '0']);
    expect(code).toBe(1);
    const { code: code2 } = await run(['audit', '--idle-gap', 'abc']);
    expect(code2).toBe(1);
  });

  it('--share prints a card url and makes no network call', async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    };
    const lines: string[] = [];
    const code = await main(['--share', '--no-color', '--scan-dir', join(home, 'code')], (l) => lines.push(l), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(code).toBe(0);
    expect(fetchCalled).toBe(false);
    const text = lines.join('\n');
    expect(text).toContain('/card?d=');
    expect(text).toContain('share your card:');
  });

  it('--share output decoded d contains hours when time exists', async () => {
    const demoDir = join(home, '.claude', 'projects', 'demo');
    await mkdir(demoDir, { recursive: true });
    const sessionLines = [
      JSON.stringify({ timestamp: '2026-07-26T10:00:00.000Z', cwd: repoDir }),
      JSON.stringify({ timestamp: '2026-07-26T10:01:00.000Z', cwd: repoDir }),
      JSON.stringify({ timestamp: '2026-07-26T10:02:00.000Z', cwd: repoDir }),
      JSON.stringify({ timestamp: '2026-07-26T10:03:00.000Z', cwd: repoDir }),
      JSON.stringify({ timestamp: '2026-07-26T10:04:00.000Z', cwd: repoDir }),
      JSON.stringify({ timestamp: '2026-07-26T10:05:00.000Z', cwd: repoDir }),
      JSON.stringify({ timestamp: '2026-07-26T10:06:00.000Z', cwd: repoDir }),
    ];
    await writeFile(join(demoDir, 'session.jsonl'), sessionLines.join('\n'));

    const lines: string[] = [];
    const code = await main(['--share', '--no-color', '--scan-dir', join(home, 'code')], (l) => lines.push(l));
    expect(code).toBe(0);
    const text = lines.join('\n');
    const match = text.match(/\/card\?d=([A-Za-z0-9_-]+)/);
    expect(match).not.toBeNull();
    const decoded = decodeShareCard(match![1]!);
    expect(decoded.hours).toBeGreaterThan(0);
  });

  it('CTA lines present on a default run, absent under --json', async () => {
    const scanDir = join(home, 'code');
    const { lines: defaultLines } = await run(['--no-color', '--scan-dir', scanDir]);
    const defaultText = defaultLines.join('\n');
    expect(defaultText).toContain('share:  viberuler --share');
    expect(defaultText).toContain(`board:  viberuler --scan-dir ${scanDir} --submit`);

    const { lines: jsonLines } = await run(['--json', '--scan-dir', scanDir]);
    const jsonText = jsonLines.join('\n');
    expect(jsonText).not.toContain('share:  viberuler --share');
    expect(jsonText).not.toContain('board:  viberuler');
  });

  it('quotes scan-dir path in CTA line when it contains whitespace', async () => {
    const spaceDir = join(home, 'code with space');
    await mkdir(spaceDir, { recursive: true });
    const { lines } = await run(['--no-color', '--scan-dir', spaceDir]);
    const text = lines.join('\n');
    expect(text).toContain(`board:  viberuler --scan-dir "${spaceDir}" --submit`);
  });

  it('prints hint line on zero-projects inside nested repo, omits on non-zero projects', async () => {
    const outerRepo = await mkdtemp(join(tmpdir(), 'vibe-outer-repo-'));
    execFileSync('git', ['-C', outerRepo, 'init']);
    const emptySub = join(outerRepo, 'subfolder');
    await mkdir(emptySub, { recursive: true });

    const { lines: zeroLines } = await run(['--no-color', '--scan-dir', emptySub]);
    const zeroText = zeroLines.join('\n');
    expect(zeroText).toContain('hint: no projects found — if your repos live under an outer repo, point --scan-dir at the folder that holds them');

    const { lines: nonZeroLines } = await run(['--no-color', '--scan-dir', join(home, 'code')]);
    const nonZeroText = nonZeroLines.join('\n');
    expect(nonZeroText).not.toContain('hint: no projects found');
  });
});

