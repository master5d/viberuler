import { describe, it, expect, beforeAll } from 'vitest';
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

  beforeAll(async () => {
    scanRoot = await mkdtemp(join(tmpdir(), 'vibe-git-'));
    const repo = join(scanRoot, 'myproject');
    await mkdir(repo, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args]);
    git('init');
    git('config', 'user.email', 'vibe@test.local');
    git('config', 'user.name', 'Vibe Tester');
    await writeFile(join(repo, 'index.ts'), 'const a = 1;\nconst b = 2;\nexport { a, b };\n');
    await writeFile(join(repo, 'notes.txt'), 'not code\n');
    git('add', '-A');
    git('commit', '-m', 'init', '--date', '2026-06-01T12:00:00');
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

  it('reports zero projects when author has no commits anywhere', async () => {
    const r = await gitCollector.collect({
      home: scanRoot,
      scanDirs: [scanRoot],
      authorEmail: 'stranger@nowhere.local',
    });
    expect(r.projects).toBe(0);
    expect(r.locTotal).toBe(0);
  });
});
