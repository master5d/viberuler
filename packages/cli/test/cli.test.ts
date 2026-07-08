import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

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
    expect(text).toContain('RANK:');
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
});
