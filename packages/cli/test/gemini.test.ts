import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGeminiLine, geminiCollector } from '../src/collectors/gemini.js';

describe('parseGeminiLine', () => {
  it('extracts tokenCount with all fields; thoughts bill as output', () => {
    const line = JSON.stringify({
      text: 'Hello!',
      tokenCount: { input: 100, output: 40, cached: 20, thoughts: 10, tool: 5, total: 175 },
    });
    const r = parseGeminiLine(line);
    expect(r).not.toBeNull();
    expect(r!.tokens).toEqual({ input: 100, output: 50, cacheWrite: 0, cacheRead: 20 }); // 40+10=50 output
    expect(r!.costUsd).toBeGreaterThan(0);
    expect(r!.model).toBe('gemini-2.0-flash');
  });

  it('returns null for empty/whitespace lines', () => {
    expect(parseGeminiLine('')).toBeNull();
    expect(parseGeminiLine('   ')).toBeNull();
  });

  it('returns null for non-JSON lines', () => {
    expect(parseGeminiLine('not json at all')).toBeNull();
    expect(parseGeminiLine('{"partial": true')).toBeNull();
  });

  it('returns null for objects without tokenCount', () => {
    expect(parseGeminiLine(JSON.stringify({ text: 'hello' }))).toBeNull();
    expect(parseGeminiLine(JSON.stringify({ role: 'user', parts: [] }))).toBeNull();
  });

  it('reads model from obj.model when available for accurate pricing', () => {
    const line = JSON.stringify({
      model: 'gemini-2.5-pro',
      tokenCount: { input: 1000, output: 500, cached: 0, total: 1500 },
    });
    const r = parseGeminiLine(line);
    expect(r).not.toBeNull();
    expect(r!.model).toBe('gemini-2.5-pro');
    // 2.5 pro is more expensive — verify cost reflects that
    expect(r!.costUsd).toBeCloseTo((1000 * 1.25 + 500 * 5.0) / 1_000_000, 10);
  });

  it('coerces missing/non-numeric token fields to 0', () => {
    const line = JSON.stringify({
      tokenCount: { input: 10, output: null, cached: 'bad', total: 'wont-parse' },
    });
    const r = parseGeminiLine(line);
    expect(r).not.toBeNull();
    expect(r!.tokens).toEqual({ input: 10, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(r!.costUsd).toBeCloseTo((10 * 0.1) / 1_000_000, 15);
  });

  it('handles tokenCount with only cached tokens (fully cached response)', () => {
    const line = JSON.stringify({
      tokenCount: { cached: 5000, total: 5000 },
    });
    const r = parseGeminiLine(line);
    expect(r).not.toBeNull();
    expect(r!.tokens).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 5000 });
  });
});

async function makeSessionFile(
  root: string,
  project: string,
  sessionId: string,
  lines: unknown[],
  subdir?: string,
): Promise<void> {
  const chatsDir = subdir
    ? join(root, 'tmp', project, 'chats', subdir)
    : join(root, 'tmp', project, 'chats');
  await mkdir(chatsDir, { recursive: true });
  const content = lines.map((l) => JSON.stringify(l)).join('\n');
  await writeFile(join(chatsDir, `session-${sessionId}.jsonl`), content);
}

describe('geminiCollector', () => {
  it('stays dormant when no Gemini data dir exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nogemini-'));
    const ctx = { home, scanDirs: [] as string[], env: { VIBERULER_GEMINI_DATA_DIR: join(home, '.gemini') } };
    expect(await geminiCollector.detect(ctx)).toBe(false);
  });

  it('detects Gemini CLI when session files are present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-gemdetect-'));
    await makeSessionFile(root, 'my-project', 'abc', [
      { tokenCount: { input: 10, output: 5, total: 15 } },
    ]);
    const ctx = { home: '/', scanDirs: [] as string[], env: { VIBERULER_GEMINI_DATA_DIR: root } };
    expect(await geminiCollector.detect(ctx)).toBe(true);
  });

  it('aggregates all tokens across multiple projects and sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-gemagg-'));

    // Project A: 2 sessions
    await makeSessionFile(root, 'project-a', 's1', [
      { tokenCount: { input: 1000, output: 500, cached: 200, total: 1700 } },
      { tokenCount: { input: 200, output: 100, total: 300 } },
    ]);
    await makeSessionFile(root, 'project-a', 's2', [
      { tokenCount: { input: 300, output: 150, cached: 50, total: 500 } },
    ]);

    // Project B: 1 session
    await makeSessionFile(root, 'project-b', 's1', [
      { tokenCount: { input: 5000, output: 2500, thoughts: 300, total: 7800 } },
    ]);

    const ctx = { home: '/', scanDirs: [] as string[], env: { VIBERULER_GEMINI_DATA_DIR: root } };
    expect(await geminiCollector.detect(ctx)).toBe(true);
    const r = await geminiCollector.collect(ctx);

    // input: 1000+200+300+5000 = 6500
    // output: 500+100+150+2500+300(thoughts) = 3550
    // cacheRead: 200+50 = 250
    expect(r.tokens).toEqual({ input: 6500, output: 3550, cacheWrite: 0, cacheRead: 250 });
    expect(r.sources).toEqual(['gemini-cli']);
    expect(r.agents).toEqual(['Gemini CLI']);
    expect(r.warnings![0]).toMatch(/gemini-2.0-flash/);
  });

  it('recursively walks subagent UUID subdirs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-gemsub-'));

    // Session in main chats dir
    await makeSessionFile(root, 'big-project', 'main-session', [
      { tokenCount: { input: 100, output: 50, total: 150 } },
    ]);

    // Subagent nested under a UUID dir (e.g. .gemini/tmp/big-project/chats/<uuid>/)
    await makeSessionFile(root, 'big-project', 'sub-session', [
      { tokenCount: { input: 200, output: 100, total: 300 } },
    ], '550e8400-e29b-41d4-a716-446655440000');

    const ctx = { home: '/', scanDirs: [] as string[], env: { VIBERULER_GEMINI_DATA_DIR: root } };
    const r = await geminiCollector.collect(ctx);
    expect(r.tokens!.input).toBe(300);
    expect(r.tokens!.output).toBe(150);
  });

  it('handles project dirs with no chats/ subdir gracefully', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-gemempty-'));
    await mkdir(join(root, 'tmp', 'empty-project'), { recursive: true });
    // No chats/ dir — should return {}

    const ctx = { home: '/', scanDirs: [] as string[], env: { VIBERULER_GEMINI_DATA_DIR: root } };
    const r = await geminiCollector.collect(ctx);
    expect(r).toEqual({});
  });

  it('does not read antigravity-cli data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-gemanti-'));
    // Gemini CLI session
    await makeSessionFile(root, 'my-project', 's1', [
      { tokenCount: { input: 100, output: 50, total: 150 } },
    ]);
    // Antigravity data sits outside tmp/ — collector only walks tmp/
    await mkdir(join(root, 'antigravity-cli'), { recursive: true });
    await writeFile(join(root, 'antigravity-cli', 'some-data.jsonl'), JSON.stringify({ tokenCount: { input: 999999, total: 999999 } }));

    const ctx = { home: '/', scanDirs: [] as string[], env: { VIBERULER_GEMINI_DATA_DIR: root } };
    const r = await geminiCollector.collect(ctx);
    expect(r.tokens!.input).toBe(100); // Antigravity data ignored
    expect(r.tokens!.output).toBe(50);
  });
});
