import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRoots, parseHomeList, agentHomes } from '../src/roots.js';
import { claudeCodeCollector } from '../src/collectors/claude-code.js';
import { codexCollector } from '../src/collectors/codex.js';

const PROJECTS = { under: ['.claude', 'projects'], env: 'CLAUDE_CONFIG_DIR', envUnder: ['projects'] };

const fakeHome = () => mkdtemp(join(tmpdir(), 'vibe-roots-'));

async function claudeHomeWith(tokens: number): Promise<string> {
  const home = await fakeHome();
  const proj = join(home, '.claude', 'projects', 'p');
  await mkdir(proj, { recursive: true });
  await writeFile(
    join(proj, 's.jsonl'),
    JSON.stringify({
      type: 'assistant',
      requestId: `r-${tokens}`,
      message: {
        id: `m-${tokens}`,
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: tokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }),
  );
  return home;
}

describe('resolveRoots', () => {
  it('finds the log dir under an extra agent home, not just the OS home', async () => {
    const os = await fakeHome();
    const relocated = await fakeHome();
    await mkdir(join(relocated, '.claude', 'projects'), { recursive: true });

    const roots = await resolveRoots({ home: os, agentHomes: [relocated], scanDirs: [], env: {} }, PROJECTS);
    expect(roots).toEqual([join(relocated, '.claude', 'projects')]);
  });

  it('honours the agent\'s own relocation env var', async () => {
    const os = await fakeHome();
    const cfg = await fakeHome(); // CLAUDE_CONFIG_DIR points AT the .claude dir
    await mkdir(join(cfg, 'projects'), { recursive: true });

    const roots = await resolveRoots(
      { home: os, scanDirs: [], env: { CLAUDE_CONFIG_DIR: cfg } },
      PROJECTS,
    );
    expect(roots).toEqual([join(cfg, 'projects')]);
  });

  it('dedups the same root reached by different strings', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects');
    await mkdir(proj, { recursive: true });

    // the OS home, the same path passed again, and the env var — one real dir
    const roots = await resolveRoots(
      {
        home,
        agentHomes: [home, join(home, '.', '')],
        scanDirs: [],
        env: { CLAUDE_CONFIG_DIR: join(home, '.claude') },
      },
      PROJECTS,
    );
    expect(roots).toHaveLength(1);
  });

  it('skips roots that do not exist rather than reporting them', async () => {
    const home = await fakeHome();
    const roots = await resolveRoots({ home, agentHomes: ['/nowhere/at/all'], scanDirs: [], env: {} }, PROJECTS);
    expect(roots).toEqual([]);
  });

  it('lists the OS home first, then extra homes in the order given', () => {
    expect(agentHomes({ home: '/os', agentHomes: ['/a', '/b'], scanDirs: [] })).toEqual(['/os', '/a', '/b']);
  });
});

describe('parseHomeList', () => {
  it('splits a POSIX path list', () => {
    expect(parseHomeList('/one:/two')).toEqual(['/one', '/two']);
  });

  it('keeps Windows drive letters intact', () => {
    // the naive split on ":" turns C:\agents into "C" + "\agents"
    expect(parseHomeList('C:\\agents\\Claude;D:\\agents\\Codex')).toEqual([
      'C:\\agents\\Claude',
      'D:\\agents\\Codex',
    ]);
  });

  it('is empty for empty input', () => {
    expect(parseHomeList(undefined)).toEqual([]);
    expect(parseHomeList('')).toEqual([]);
  });
});

describe('collectors across multiple homes', () => {
  it('claude-code sums tokens from every home', async () => {
    const a = await claudeHomeWith(100);
    const b = await claudeHomeWith(250);

    const r = await claudeCodeCollector.collect({ home: a, agentHomes: [b], scanDirs: [], env: {} });
    expect(r.tokens!.input).toBe(350);
  });

  it('claude-code does NOT double-count a home mounted twice', async () => {
    const a = await claudeHomeWith(100);

    const once = await claudeCodeCollector.collect({ home: a, scanDirs: [], env: {} });
    const twice = await claudeCodeCollector.collect({
      home: a,
      agentHomes: [a], // the same root again — the bug this guards
      scanDirs: [],
      env: { CLAUDE_CONFIG_DIR: join(a, '.claude') }, // and a third time via env
    });
    expect(twice.tokens!.input).toBe(once.tokens!.input);
    expect(twice.tokens!.input).toBe(100);
  });

  it('claude-code detects a relocated home', async () => {
    const empty = await fakeHome();
    const real = await claudeHomeWith(10);
    expect(await claudeCodeCollector.detect({ home: empty, scanDirs: [], env: {} })).toBe(false);
    expect(await claudeCodeCollector.detect({ home: empty, agentHomes: [real], scanDirs: [], env: {} })).toBe(true);
  });

  it('codex honours CODEX_HOME', async () => {
    const os = await fakeHome();
    const codexHome = await fakeHome();
    await mkdir(join(codexHome, 'sessions'), { recursive: true });

    const ctx = { home: os, scanDirs: [], env: { CODEX_HOME: codexHome } };
    expect(await codexCollector.detect(ctx)).toBe(true);
  });
});
