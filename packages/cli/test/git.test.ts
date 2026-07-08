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

  it('finds repos nested inside a parent repo (monorepo-of-repos layout)', async () => {
    const nestedRoot = await mkdtemp(join(tmpdir(), 'vibe-git-nested-'));
    const parent = join(nestedRoot, 'parent');
    const child = join(parent, 'projects', 'child');
    await mkdir(child, { recursive: true });

    const initRepo = (dir: string) => {
      const g = (...args: string[]) => execFileSync('git', ['-C', dir, ...args]);
      g('init');
      g('config', 'user.name', 'Vibe Tester');
      g('config', 'user.email', 'vibe@test.local');
      return g;
    };

    const gParent = initRepo(parent);
    await writeFile(join(parent, 'parent.ts'), 'export const p = 1;\n');
    gParent('add', 'parent.ts');
    gParent('commit', '-m', 'parent init', '--date', '2026-06-01T12:00:00');

    const gChild = initRepo(child);
    await writeFile(join(child, 'child.ts'), 'export const c = 1;\n');
    gChild('add', 'child.ts');
    gChild('commit', '-m', 'child init', '--date', '2026-06-02T12:00:00');

    const r = await gitCollector.collect({
      home: nestedRoot,
      scanDirs: [nestedRoot],
      authorEmail: 'vibe@test.local',
    });
    // Both the parent repo and the nested child repo must be counted.
    expect(r.projects).toBe(2);
    expect(r.commits).toBe(2);
  });
});
