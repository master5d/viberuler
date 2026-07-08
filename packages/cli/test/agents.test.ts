import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAgents, agentsCollector } from '../src/collectors/agents.js';

async function fakeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vibe-agents-'));
}

describe('detectAgents', () => {
  it('detects agents by home-dir markers', async () => {
    const home = await fakeHome();
    await mkdir(join(home, '.claude', 'projects'), { recursive: true });
    await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
    await mkdir(join(home, '.cursor'), { recursive: true });
    expect(await detectAgents({ home, scanDirs: [] })).toEqual(['Claude Code', 'Codex', 'Cursor']);
  });

  it('distinguishes Antigravity from Gemini CLI under the shared .gemini dir', async () => {
    const home = await fakeHome();
    await mkdir(join(home, '.gemini', 'antigravity-cli'), { recursive: true });
    expect(await detectAgents({ home, scanDirs: [] })).toEqual(['Antigravity']);

    await writeFile(join(home, '.gemini', 'settings.json'), '{}');
    expect(await detectAgents({ home, scanDirs: [] })).toEqual(['Antigravity', 'Gemini CLI']);
  });

  it('reports an agent once even when several markers match', async () => {
    const home = await fakeHome();
    await mkdir(join(home, '.claude', 'projects'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), '{}');
    expect(await detectAgents({ home, scanDirs: [] })).toEqual(['Claude Code']);
  });

  it('returns empty on a bare home', async () => {
    expect(await detectAgents({ home: await fakeHome(), scanDirs: [] })).toEqual([]);
  });
});

describe('agentsCollector', () => {
  it('always detects and returns agents without claiming a data source', async () => {
    const home = await fakeHome();
    await mkdir(join(home, '.aider'), { recursive: true });
    const ctx = { home, scanDirs: [] as string[] };
    expect(await agentsCollector.detect(ctx)).toBe(true);
    const r = await agentsCollector.collect(ctx);
    expect(r.agents).toEqual(['Aider']);
    expect(r.sources).toBeUndefined();
  });
});
