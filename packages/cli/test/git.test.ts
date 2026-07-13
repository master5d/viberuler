import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyExt, parseGitLog, gitCollector, isGenerated } from '../src/collectors/git.js';

describe('isGenerated', () => {
  it('recognises machine-written files', () => {
    for (const p of [
      'dist/index.js',
      'packages/worker/worker-configuration.d.ts',
      'node_modules/left-pad/index.js',
      'assets/app.min.js',
      'package-lock.json',
      'src/api/schema.pb.go',
      'vendor/lib.rs',
      'src/__generated__/types.ts',
    ]) {
      expect(isGenerated(p), p).toBe(true);
    }
  });

  it('does not mistake hand-written code for output', () => {
    for (const p of ['src/index.ts', 'lib/distance.ts', 'src/build-tools.ts', 'app/outbox.py']) {
      expect(isGenerated(p), p).toBe(false);
    }
  });

  it('normalises Windows separators', () => {
    expect(isGenerated('packages\\worker\\dist\\index.js')).toBe(true);
  });
});

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

  it('counts only lines YOU committed — not the tree, not other people, not machines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-authored-'));
    const r2 = join(root, 'proj');
    await mkdir(join(r2, 'dist'), { recursive: true });
    const g = (...args: string[]) => execFileSync('git', ['-C', r2, ...args]);
    g('init');
    g('config', 'user.name', 'Vibe Tester');
    g('config', 'user.email', 'vibe@test.local');

    // Somebody else's code, sitting in the tree. The old measure credited it to you.
    g('config', 'user.email', 'someone.else@example.com');
    await writeFile(join(r2, 'theirs.ts'), Array.from({ length: 50 }, (_, i) => `const t${i} = ${i};`).join('\n') + '\n');
    g('add', '-A');
    g('commit', '-m', 'not mine');

    // Machine output, committed by you. Also counted, before.
    g('config', 'user.email', 'vibe@test.local');
    await writeFile(join(r2, 'dist', 'bundle.js'), Array.from({ length: 900 }, () => 'x=1;').join('\n') + '\n');
    await writeFile(join(r2, 'types.d.ts'), Array.from({ length: 400 }, (_, i) => `declare const d${i}: number;`).join('\n') + '\n');
    await writeFile(join(r2, 'package-lock.json'), '{\n"a":1\n}\n');
    g('add', '-A');
    g('commit', '-m', 'chore: regenerate');

    // Four lines actually written by a human.
    await writeFile(join(r2, 'mine.ts'), 'export function mine() {\n  return 1;\n}\n');
    g('add', '-A');
    g('commit', '-m', 'feat: mine');

    const res = await gitCollector.collect({
      home: root,
      scanDirs: [root],
      authorEmail: 'vibe@test.local',
    });

    // 3 lines of mine.ts. Not the 50 that are someone else's, and not the 1,300
    // lines of generated output that would have dwarfed everything real.
    expect(res.locTotal).toBe(3);
    expect(res.locByLang).toEqual({ TypeScript: 3 });
  });

  it('reports machine noise separately instead of silently dropping it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-noise-'));
    const r = join(root, 'proj');
    await mkdir(join(r, 'dist'), { recursive: true });
    const g = (...args: string[]) => execFileSync('git', ['-C', r, ...args]);
    g('init');
    g('config', 'user.name', 'Vibe Tester');
    g('config', 'user.email', 'vibe@test.local');

    await writeFile(join(r, 'mine.ts'), 'export const a = 1;\nexport const b = 2;\n');           // 2 authored
    await writeFile(join(r, 'dist', 'bundle.js'), Array.from({ length: 8 }, () => 'x=1;').join('\n') + '\n'); // 8 generated
    g('add', '-A');
    g('commit', '-m', 'feat: mine + build output');

    const res = await gitCollector.collect({ home: root, scanDirs: [root], authorEmail: 'vibe@test.local' });
    expect(res.locTotal).toBe(2);        // yours
    expect(res.locGenerated).toBe(8);    // the machine's — visible, not counted as yours
  });

  it('counts a day you touched three repos as ONE active day', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-cadence-'));
    for (const name of ['a', 'b', 'c']) {
      const r = join(root, name);
      await mkdir(r, { recursive: true });
      const g = (...args: string[]) => execFileSync('git', ['-C', r, ...args]);
      g('init');
      g('config', 'user.name', 'Vibe Tester');
      g('config', 'user.email', 'vibe@test.local');
      await writeFile(join(r, 'x.ts'), 'const x = 1;\n');
      g('add', '-A');
      // same calendar day in all three repos
      g('commit', '-m', 'init', '--date', '2026-06-01T12:00:00');
    }

    const res = await gitCollector.collect({ home: root, scanDirs: [root], authorEmail: 'vibe@test.local' });
    expect(res.commits).toBe(3);     // three commits…
    expect(res.activeDays).toBe(1);  // …on one day. Summing per-repo would say 3.
    expect(res.spanDays).toBe(1);
  });

  it('measures the span from first commit to last, inclusive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-span-'));
    const r = join(root, 'proj');
    await mkdir(r, { recursive: true });
    const g = (...args: string[]) => execFileSync('git', ['-C', r, ...args]);
    g('init');
    g('config', 'user.name', 'Vibe Tester');
    g('config', 'user.email', 'vibe@test.local');
    await writeFile(join(r, 'a.ts'), 'const a = 1;\n');
    g('add', '-A');
    g('commit', '-m', 'one', '--date', '2026-06-01T12:00:00');
    await writeFile(join(r, 'b.ts'), 'const b = 1;\n');
    g('add', '-A');
    g('commit', '-m', 'two', '--date', '2026-06-10T12:00:00');

    const res = await gitCollector.collect({ home: root, scanDirs: [root], authorEmail: 'vibe@test.local' });
    expect(res.activeDays).toBe(2);   // two days worked
    expect(res.spanDays).toBe(10);    // across ten calendar days (Jun 1..10)
  });

  it('does not let a merge commit re-count the branch it absorbs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-merge-'));
    const r3 = join(root, 'proj');
    await mkdir(r3, { recursive: true });
    const g = (...args: string[]) => execFileSync('git', ['-C', r3, ...args]);
    g('init');
    g('config', 'user.name', 'Vibe Tester');
    g('config', 'user.email', 'vibe@test.local');
    await writeFile(join(r3, 'a.ts'), 'const a = 1;\n');
    g('add', '-A');
    g('commit', '-m', 'base');

    g('checkout', '-b', 'feature');
    await writeFile(join(r3, 'b.ts'), 'const b = 1;\nconst c = 2;\n');
    g('add', '-A');
    g('commit', '-m', 'feat: b');

    g('checkout', '-');
    g('merge', '--no-ff', 'feature', '-m', 'Merge pull request #1 from feature');

    const res = await gitCollector.collect({
      home: root,
      scanDirs: [root],
      authorEmail: 'vibe@test.local',
    });
    // 1 (a.ts) + 2 (b.ts) — the merge must not add b.ts a second time
    expect(res.locTotal).toBe(3);
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
