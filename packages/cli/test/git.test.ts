import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyExt, parseGitLog, gitCollector } from '../src/collectors/git.js';

describe('classifyExt', () => {
  it('maps known code extensions', () => {
    expect(classifyExt('src/app.ts')).toBe('TypeScript');
    expect(classifyExt('main.rs')).toBe('Rust');
    expect(classifyExt('script.py')).toBe('Python');
  });
  it('returns null for non-code files', () => {
    expect(classifyExt('photo.png')).toBeNull();
    expect(classifyExt('README.md')).toBeNull();
  });
});

describe('parseGitLog', () => {
  it('extracts dates and counts late-night commits (00-04h)', () => {
    const out = ['2026-06-01 14', '2026-06-01 03', '2026-06-02 23', ''].join('\n');
    const r = parseGitLog(out);
    expect(r.dates).toEqual(['2026-06-01', '2026-06-01', '2026-06-02']);
    expect(r.lateNight).toBe(1);
    expect(r.feats).toBe(0);
    expect(r.prs).toBe(0);
  });

  it('counts conventional feat: commits and PR merges from the subject', () => {
    const out = [
      '2026-06-01 14\tfeat: add the widget',
      '2026-06-01 15\tfeat(cli)!: breaking flag',
      '2026-06-01 16\tfix: not a feature',
      '2026-06-02 10\tRefactor login (#412)', // squash-merged PR
      '2026-06-02 11\tMerge pull request #77 from x/y', // merge commit
      '2026-06-02 12\tchore: bump deps',
      '',
    ].join('\n');
    const r = parseGitLog(out);
    expect(r.dates.length).toBe(6);
    expect(r.feats).toBe(2);
    expect(r.prs).toBe(2);
  });
});

describe('gitCollector (integration, sacrificial temp repo)', () => {
  let scanRoot: string;
  let repo: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args]);

  beforeAll(async () => {
    scanRoot = await mkdtemp(join(tmpdir(), 'vibe-git-'));
    repo = join(scanRoot, 'myproject');
    await mkdir(repo, { recursive: true });
    git('init');
    git('config', 'user.name', 'Vibe Tester');
    git('config', 'user.email', 'vibe@test.local');
    await writeFile(join(repo, 'index.ts'), 'const a = 1;\nconst b = 2;\nexport { a, b };\n');
    await writeFile(join(repo, 'notes.txt'), 'not code\n');
    git('add', '-A');
    git('commit', '-m', 'init', '--date', '2026-06-01T12:00:00');
  });

  beforeEach(() => {
    git('config', 'user.email', 'vibe@test.local');
  });

  it('finds the repo and counts LoC/commits for the repo author', async () => {
    const r = await gitCollector.collect({
      home: scanRoot,
      scanDirs: [scanRoot],
      authorEmail: 'vibe@test.local',
    });
    expect(r.projects).toBe(1);
    expect(r.commits).toBe(1);
    expect(r.streakDays).toBe(1);
    expect(r.locByLang).toEqual({ TypeScript: 3 });
    expect(r.locTotal).toBe(3);
    expect(r.maxRepoLoc).toBe(3);
    expect(r.sources).toEqual(['git']);
  });

  it('finds a repo nested inside another repo, and counts each once', async () => {
    // The workspace-root case: people version the folder that HOLDS their repos.
    // Stopping at the first .git collapsed every project into one.
    const outer = await mkdtemp(join(tmpdir(), 'vibe-nest-'));
    const inner = join(outer, 'projects', 'inner');
    await mkdir(inner, { recursive: true });

    const g = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args]);
    for (const r of [outer, inner]) {
      g(r, 'init');
      g(r, 'config', 'user.name', 'Vibe Tester');
      g(r, 'config', 'user.email', 'vibe@test.local');
    }
    await writeFile(join(outer, 'root.ts'), 'export const outer = 1;\n');
    // the outer repo must not track the inner one's files
    await writeFile(join(outer, '.gitignore'), 'projects/\n');
    g(outer, 'add', '-A');
    g(outer, 'commit', '-m', 'outer');

    await writeFile(join(inner, 'app.ts'), 'export const a = 1;\nexport const b = 2;\n');
    g(inner, 'add', '-A');
    g(inner, 'commit', '-m', 'inner');

    const r = await gitCollector.collect({
      home: outer,
      scanDirs: [outer],
      authorEmail: 'vibe@test.local',
    });
    expect(r.projects).toBe(2);                    // both, not just the outer one
    expect(r.locByLang).toEqual({ TypeScript: 3 }); // 1 outer + 2 inner, none double-counted
    expect(r.commits).toBe(2);
  });

  it('does not walk into AppData — every Windows home hides broken clones in there', async () => {
    // Reproduces the real thing: AppData\Local\Temp is full of half-finished
    // clones from other tools. Walking them produced a screenful of
    // "failed to scan" warnings and drowned the repos the user actually wrote.
    const junk = join(scanRoot, 'AppData', 'Local', 'Temp', 'someones-clone');
    await mkdir(junk, { recursive: true });
    await mkdir(join(junk, '.git'), { recursive: true }); // looks like a repo, is not one

    const r = await gitCollector.collect({
      home: scanRoot,
      scanDirs: [scanRoot],
      authorEmail: 'vibe@test.local',
    });
    expect(r.projects).toBe(1);              // only myproject, not the AppData clone
    expect(r.warnings ?? []).toEqual([]);    // and no noise about it
  });

  it('matches author email case-insensitively', async () => {
    await writeFile(join(repo, 'case.ts'), 'export const value = 1;\n');
    git('config', 'user.email', 'VIBE@TEST.LOCAL');
    git('add', 'case.ts');
    git('commit', '-m', 'case commit', '--date', '2026-06-02T12:00:00');

    const r = await gitCollector.collect({
      home: scanRoot,
      scanDirs: [scanRoot],
      authorEmail: 'vibe@test.local',
    });
    expect(r.projects).toBe(1);
    expect(r.commits).toBe(2);
  });

  it('reports zero projects when author has no commits anywhere', async () => {
    const r = await gitCollector.collect({
      home: scanRoot,
      scanDirs: [scanRoot],
      authorEmail: 'stranger@nowhere.local',
    });
    expect(r.projects).toBe(0);
    expect(r.locTotal).toBe(0);
  });

  it('reports the busiest day (date with the most commits)', async () => {
    // the beforeAll repo has one commit on 2026-06-01; add two more that day
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'vibe@test.local']);
    await writeFile(join(repo, 'b.ts'), 'export const b = 1;\n');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-m', 'b', '--date', '2026-06-01T13:00:00']);
    await writeFile(join(repo, 'c.ts'), 'export const c = 1;\n');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-m', 'c', '--date', '2026-06-01T14:00:00']);
    const r = await gitCollector.collect({ home: scanRoot, scanDirs: [scanRoot], authorEmail: 'vibe@test.local' });
    expect(r.busiestDay).toBe('2026-06-01');
    expect(r.busiestDayCount).toBeGreaterThanOrEqual(3);
  });
});
