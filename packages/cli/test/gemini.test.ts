import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGeminiSession, geminiCollector } from '../src/collectors/gemini.js';

// Two $set lines that REPLAY the full messages array (Gemini's mutation log).
// m2 appears on both lines; correct dedup counts it once.
const msg = (id: string, model: string, t: object) =>
  ({ id, type: 'gemini', model, tokens: t });
const line = (msgs: unknown[]) => JSON.stringify({ $set: { messages: msgs } });
const m1 = { id: 'm1', type: 'user', content: [{ text: 'hi' }] };
const m2 = msg('m2', 'gemini-3-flash-preview', { input: 1000, output: 100, cached: 500, thoughts: 50, tool: 0, total: 1650 });
const m3 = msg('m3', 'gemini-2.5-pro', { input: 2000, output: 200, cached: 0, thoughts: 0, tool: 0, total: 2200 });
const sessionFile =
  JSON.stringify({ sessionId: 's1', kind: 'session' }) + '\n' +
  line([m1, m2]) + '\n' +
  line([m1, m2, m3]) + '\n';

describe('parseGeminiSession', () => {
  it('dedups by message id and maps buckets (thoughts+tool→output, cached→cacheRead)', () => {
    const r = parseGeminiSession(sessionFile, new Set());
    // m2: input1000, output 100+50=150, cacheRead500 ; m3: input2000, output200
    expect(r.tokens).toEqual({ input: 3000, output: 350, cacheWrite: 0, cacheRead: 500 });
    // cost: m2 flash (1000*.30+150*2.5+500*.075) + m3 pro (2000*1.25+200*10), /1e6
    expect(r.costUsd).toBeCloseTo((300 + 375 + 37.5 + 2500 + 2000) / 1e6, 12);
  });
  it('shares the seen-set so the same id across files is not double-counted', () => {
    const seen = new Set<string>();
    parseGeminiSession(sessionFile, seen);
    const again = parseGeminiSession(sessionFile, seen); // all ids already seen
    expect(again.tokens).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(again.costUsd).toBe(0);
  });
  it('prices a missing model at the flash tier, not sonnet', () => {
    const noModel = JSON.stringify({ $set: { messages: [
      { id: 'x', type: 'gemini', tokens: { input: 1000, output: 0, cached: 0, thoughts: 0, tool: 0, total: 1000 } },
    ] } }) + '\n';
    expect(parseGeminiSession(noModel, new Set()).costUsd).toBeCloseTo((1000 * 0.3) / 1e6, 12);
  });
});

describe('geminiCollector', () => {
  async function seed(gdir: string, project: string, rel: string, content: string): Promise<void> {
    const dir = join(gdir, 'tmp', project, 'chats', rel);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'session-x.jsonl'), content);
  }

  it('scans tmp/*/chats recursively and reports the Gemini CLI agent', async () => {
    const gdir = await mkdtemp(join(tmpdir(), 'vibe-gem-'));
    await seed(gdir, 'proj-a', '.', sessionFile);                 // top-level
    await seed(gdir, 'proj-a', '11111111-2222-3333', sessionFile); // nested UUID subdir (distinct file, same ids → deduped)
    const ctx = { home: '/', scanDirs: [] as string[], env: { GEMINI_DATA_DIR: gdir } };
    expect(await geminiCollector.detect(ctx)).toBe(true);
    const r = await geminiCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 3000, output: 350, cacheWrite: 0, cacheRead: 500 }); // deduped across both files
    expect(r.sources).toEqual(['gemini']);
    expect(r.agents).toEqual(['Gemini CLI']);
  });

  it('attributes the sessions to Antigravity when its dir shares the .gemini home', async () => {
    const gdir = await mkdtemp(join(tmpdir(), 'vibe-gemag2-'));
    await seed(gdir, 'proj-a', '.', sessionFile);
    await mkdir(join(gdir, 'antigravity-cli'), { recursive: true }); // Antigravity present
    const r = await geminiCollector.collect({ home: '/', scanDirs: [], env: { GEMINI_DATA_DIR: gdir } });
    expect(r.agents).toEqual(['Antigravity']);
    expect(r.sources).toEqual(['gemini']); // token source label unchanged
  });

  it('does not detect without a gemini tmp/chats tree', async () => {
    const gdir = await mkdtemp(join(tmpdir(), 'vibe-nogem-'));
    expect(await geminiCollector.detect({ home: '/', scanDirs: [], env: { GEMINI_DATA_DIR: gdir } })).toBe(false);
  });

  it('never descends into antigravity-cli', async () => {
    const gdir = await mkdtemp(join(tmpdir(), 'vibe-gemag-'));
    const ag = join(gdir, 'antigravity-cli', 'chats');
    await mkdir(ag, { recursive: true });
    await writeFile(join(ag, 'session-x.jsonl'), sessionFile);
    // no tmp/*/chats → nothing to collect
    expect(await geminiCollector.detect({ home: '/', scanDirs: [], env: { GEMINI_DATA_DIR: gdir } })).toBe(false);
  });
});
