import { describe, it, expect } from 'vitest';
import { parseCursorValues } from '../src/collectors/cursor.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cursorCollector } from '../src/collectors/cursor.js';

describe('parseCursorValues', () => {
  it('sums the numeric leaves of promptTokenBreakdown per conversation', () => {
    const values = [
      JSON.stringify({ promptTokenBreakdown: { system: 1000, user: 2000, context: 500 }, other: 'ignored' }),
      JSON.stringify({ promptTokenBreakdown: { system: 300, fileContext: 700 } }),
    ];
    const r = parseCursorValues(values);
    expect(r.inputTokens).toBe(4500); // 3500 + 1000
    expect(r.conversations).toBe(2);
  });
  it('is robust to unknown sub-field names (sums whatever numbers are there)', () => {
    const values = [JSON.stringify({ promptTokenBreakdown: { futureFieldA: 10, nested: { deep: 5 }, label: 'x' } })];
    expect(parseCursorValues(values).inputTokens).toBe(15); // 10 + 5, string ignored
  });
  it('skips rows without a promptTokenBreakdown and malformed JSON', () => {
    const values = [
      JSON.stringify({ notABreakdown: { a: 1 } }),
      'not json at all',
      JSON.stringify({ promptTokenBreakdown: { a: 42 } }),
    ];
    const r = parseCursorValues(values);
    expect(r.inputTokens).toBe(42);
    expect(r.conversations).toBe(1);
  });
  it('returns zero for an empty input', () => {
    expect(parseCursorValues([])).toEqual({ inputTokens: 0, conversations: 0 });
  });
});

const hasNodeSqlite = await import('node:sqlite' as string).then(() => true, () => false);

describe('cursorCollector.detect', () => {
  it('is dormant when no storage dir is configured/found', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nocursor-'));
    expect(await cursorCollector.detect({ home, scanDirs: [], env: { VIBERULER_CURSOR_STORAGE: home } })).toBe(false);
  });
});

describe.skipIf(!hasNodeSqlite)('cursorCollector — real state.vscdb', () => {
  async function makeDb(rows: Array<[string, string]>): Promise<string> {
    const { DatabaseSync } = await import('node:sqlite' as string);
    const dir = await mkdtemp(join(tmpdir(), 'vibe-cursor-'));
    const db = new DatabaseSync(join(dir, 'state.vscdb'));
    db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)');
    const ins = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
    for (const [k, v] of rows) ins.run(k, v);
    db.close();
    return dir;
  }

  it('sums input tokens across composerData rows, prices API-equivalent, flags estimated', async () => {
    const dir = await makeDb([
      ['composerData:c1', JSON.stringify({ promptTokenBreakdown: { system: 1000, user: 2000 } })],
      ['composerData:c2', JSON.stringify({ promptTokenBreakdown: { system: 3000 } })],
      ['bubbleId:x', JSON.stringify({ irrelevant: 1 })], // not a composerData row — ignored
    ]);
    const ctx = { home: '/', scanDirs: [], env: { VIBERULER_CURSOR_STORAGE: dir } };
    expect(await cursorCollector.detect(ctx)).toBe(true);
    const r = await cursorCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 6000, output: 0, cacheWrite: 0, cacheRead: 0 });
    // sonnet input rate 3/MTok
    expect(r.costUsd).toBeCloseTo((6000 * 3) / 1e6, 12);
    expect(r.sources).toEqual(['cursor']);
    expect(r.agents).toEqual(['Cursor']);
    expect(r.warnings?.[0]).toMatch(/estimated|lower bound/i);
  });

  it('contributes nothing (but no crash) when the db has no composerData rows', async () => {
    const dir = await makeDb([['bubbleId:x', JSON.stringify({ a: 1 })]]);
    const r = await cursorCollector.collect({ home: '/', scanDirs: [], env: { VIBERULER_CURSOR_STORAGE: dir } });
    expect(r.tokens?.input ?? 0).toBe(0);
    expect(r.agents ?? []).not.toContain('Cursor');
  });
});
