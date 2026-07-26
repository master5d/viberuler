import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectTime, createTimeAccumulator } from '../src/time-collect.js';

describe('createTimeAccumulator', () => {
  it('accumulates timestamps per file and outputs a aggregated TimeReport', () => {
    const acc = createTimeAccumulator(120_000);
    const content = [
      JSON.stringify({ timestamp: '2026-07-26T10:00:00.000Z', cwd: '/work/alpha' }),
      JSON.stringify({ timestamp: '2026-07-26T10:01:00.000Z', cwd: '/work/alpha' }),
    ].join('\n');
    acc.addFile(content);
    const report = acc.report();
    expect(report.totalWallMs).toBe(60_000);
    expect(report.totalActiveMs).toBe(60_000);
    expect(report.projects).toEqual([{ name: 'alpha', activeMs: 60_000 }]);
  });
});

describe('collectTime', () => {

  it('collects time metrics from multiple jsonl files and attributes projects', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-time-home-'));
    const proj = join(home, '.claude', 'projects', 'x');
    await mkdir(proj, { recursive: true });

    // File 1: dense 3-event chain (1 min apart) with cwd alpha
    const file1Lines = [
      JSON.stringify({ timestamp: '2026-07-26T10:00:00.000Z', cwd: 'C:\\telo\\Efforts\\On\\alpha' }),
      JSON.stringify({ timestamp: '2026-07-26T10:01:00.000Z', cwd: 'C:\\telo\\Efforts\\On\\alpha' }),
      JSON.stringify({ timestamp: '2026-07-26T10:02:00.000Z', cwd: 'C:\\telo\\Efforts\\On\\alpha' }),
    ];
    await writeFile(join(proj, 'f1.jsonl'), file1Lines.join('\n'));

    // File 2: 2-event chain (1 min apart) with no cwd
    const file2Lines = [
      JSON.stringify({ timestamp: '2026-07-26T11:00:00.000Z' }),
      JSON.stringify({ timestamp: '2026-07-26T11:01:00.000Z' }),
    ];
    await writeFile(join(proj, 'f2.jsonl'), file2Lines.join('\n'));

    const report = await collectTime({ home, scanDirs: [] }, 120_000);

    expect(report.projects).toEqual([
      { name: 'alpha', activeMs: 120_000 },
      { name: 'other', activeMs: 60_000 },
    ]);

    const sumDaysWall = report.days.reduce((acc, d) => acc + d.wallMs, 0);
    const sumDaysActive = report.days.reduce((acc, d) => acc + d.activeMs, 0);

    expect(report.totalWallMs).toBe(180_000);
    expect(report.totalActiveMs).toBe(180_000);
    expect(sumDaysWall).toBe(report.totalWallMs);
    expect(sumDaysActive).toBe(report.totalActiveMs);
  });

  it('handles events spanning two local days producing two day buckets with non-negative values', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-time-days-'));
    const proj = join(home, '.claude', 'projects', 'y');
    await mkdir(proj, { recursive: true });

    const d1 = new Date(2026, 6, 26, 10, 0, 0);
    const d1Next = new Date(2026, 6, 26, 10, 1, 0);
    const d2 = new Date(2026, 6, 27, 10, 0, 0);
    const d2Next = new Date(2026, 6, 27, 10, 1, 0);

    const lines = [
      JSON.stringify({ timestamp: d1.toISOString(), cwd: '/workspace/project-b' }),
      JSON.stringify({ timestamp: d1Next.toISOString(), cwd: '/workspace/project-b' }),
      JSON.stringify({ timestamp: d2.toISOString(), cwd: '/workspace/project-b' }),
      JSON.stringify({ timestamp: d2Next.toISOString(), cwd: '/workspace/project-b' }),
    ];
    await writeFile(join(proj, 'span.jsonl'), lines.join('\n'));

    const report = await collectTime({ home, scanDirs: [] }, 120_000);

    expect(report.days.length).toBe(2);
    expect(report.days[0]).toEqual({
      day: `${d1.getFullYear()}-07-26`,
      wallMs: 60_000,
      activeMs: 60_000,
    });
    expect(report.days[1]).toEqual({
      day: `${d2.getFullYear()}-07-27`,
      wallMs: 60_000,
      activeMs: 60_000,
    });
    expect(report.totalWallMs).toBe(120_000);
    expect(report.totalActiveMs).toBe(120_000);
  });

  it('excludes gaps larger than threshold from activeMs while wallMs remains intact', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-time-gap-'));
    const proj = join(home, '.claude', 'projects', 'z');
    await mkdir(proj, { recursive: true });

    const t0 = new Date('2026-07-26T10:00:00.000Z').getTime();
    const t1 = t0 + 10 * 60 * 1000; // 10 minutes gap

    const lines = [
      JSON.stringify({ timestamp: new Date(t0).toISOString(), cwd: '/workspace/project-c' }),
      JSON.stringify({ timestamp: new Date(t1).toISOString(), cwd: '/workspace/project-c' }),
    ];
    await writeFile(join(proj, 'gap.jsonl'), lines.join('\n'));

    // Threshold of 1 minute (60,000ms)
    const report = await collectTime({ home, scanDirs: [] }, 60_000);

    expect(report.totalWallMs).toBe(10 * 60 * 1000);
    expect(report.totalActiveMs).toBe(0);
  });

  it('returns a zero report on empty or missing roots without throwing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-time-empty-'));
    const report = await collectTime({ home, scanDirs: [] }, 120_000);

    expect(report).toEqual({
      totalWallMs: 0,
      totalActiveMs: 0,
      days: [],
      projects: [],
    });
  });
});
