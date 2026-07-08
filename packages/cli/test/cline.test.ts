import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clineCollector } from '../src/collectors/cline.js';

const taskDir = fileURLToPath(new URL('./fixtures/cline', import.meta.url));

describe('clineCollector', () => {
  it('aggregates per-message apiMetrics from task files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-cline-'));
    const tasks = join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks');
    await mkdir(tasks, { recursive: true });
    await copyFile(join(taskDir, 'task-a.json'), join(tasks, 'task-a.json'));

    const ctx = { home, scanDirs: [] as string[] };
    expect(await clineCollector.detect(ctx)).toBe(true);
    const r = await clineCollector.collect(ctx);
    // Per-message: input 100+50=150, output 200+150=350
    expect(r.tokens).toEqual({ input: 150, output: 350, cacheWrite: 0, cacheRead: 0 });
    // Cost from message apiMetrics: 0.005 + 0.003 = 0.008
    // Plus costForUsage('claude-sonnet', tokens) = 150*3 + 350*15 / 1e6 = 0.00045 + 0.00525 = 0.0057
    expect(r.costUsd).toBeGreaterThan(0.008);
    expect(r.sources).toEqual(['cline']);
  });

  it('skips non-JSON / protobuf files silently', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-cline-bin-'));
    const tasks = join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks');
    await mkdir(tasks, { recursive: true });
    await writeFile(join(tasks, 'task.bin'), Buffer.from([0, 1, 2, 3, 4]));

    const ctx = { home, scanDirs: [] as string[] };
    expect(await clineCollector.detect(ctx)).toBe(true);
    const r = await clineCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBe(0);
  });

  it('does not detect without Cline tasks directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nocline-'));
    expect(await clineCollector.detect({ home, scanDirs: [] })).toBe(false);
  });
});
