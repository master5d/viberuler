import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { litellmCollector, aggregateRows } from '../src/collectors/litellm.js';

const hasNodeSqlite = await import('node:sqlite' as string).then(
  () => true,
  () => false,
);

describe('litellmCollector.detect', () => {
  it('stays dormant without env (zero-network default)', async () => {
    expect(await litellmCollector.detect({ home: '/', scanDirs: [], env: {} })).toBe(false);
  });
  it('activates on LITELLM_SPEND_DB or LITELLM_BASE_URL', async () => {
    expect(await litellmCollector.detect({ home: '/', scanDirs: [], env: { LITELLM_SPEND_DB: 'x.db' } })).toBe(true);
    expect(await litellmCollector.detect({ home: '/', scanDirs: [], env: { LITELLM_BASE_URL: 'http://gw' } })).toBe(true);
  });
});

describe('aggregateRows', () => {
  it('prefers logged spend, prices known models, zero-counts the rest with a flag', () => {
    const r = aggregateRows([
      { model: 'openai/gpt-5', prompt: 100, completion: 50, spend: 0.42 },
      { model: 'claude-sonnet-5', prompt: 1_000_000, completion: 0, spend: 0 }, // priced at $3/MTok input
      { model: 'groq/llama-free', prompt: 500, completion: 500, spend: 0 },
    ]);
    expect(r.tokens).toEqual({ input: 1_000_600, output: 550, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBeCloseTo(0.42 + 3, 10);
    expect(r.unpricedTokens).toBe(1000);
  });
});

describe.skipIf(!hasNodeSqlite)('litellmCollector — LITELLM_SPEND_DB (labwatch-style schema)', () => {
  it('sums a usage table grouped by model', async () => {
    const { DatabaseSync } = await import('node:sqlite' as string);
    const dir = await mkdtemp(join(tmpdir(), 'vibe-litellm-'));
    const dbPath = join(dir, 'usage.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, model_group TEXT, model TEXT,
      provider TEXT, agent TEXT, prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0, status TEXT, latency_ms REAL, error TEXT)`);
    const ins = db.prepare('INSERT INTO usage (ts, model, prompt_tokens, completion_tokens) VALUES (?, ?, ?, ?)');
    ins.run('2026-07-01T00:00:00Z', 'groq/llama-3.3-70b', 1000, 200);
    ins.run('2026-07-02T00:00:00Z', 'groq/llama-3.3-70b', 500, 100);
    ins.run('2026-07-03T00:00:00Z', 'claude-haiku-4-5', 2000, 400); // priced: 1/5 per MTok
    db.close();

    const ctx = { home: '/', scanDirs: [], env: { LITELLM_SPEND_DB: dbPath } };
    expect(await litellmCollector.detect(ctx)).toBe(true);
    const r = await litellmCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 3500, output: 700, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBeCloseTo((2000 * 1 + 400 * 5) / 1e6, 10);
    expect(r.sources).toEqual(['litellm']);
    expect(r.warnings?.[0]).toContain('1,800 tokens');
  });

  it('honors --since when the table has a ts column', async () => {
    const { DatabaseSync } = await import('node:sqlite' as string);
    const dir = await mkdtemp(join(tmpdir(), 'vibe-litellm-since-'));
    const dbPath = join(dir, 'usage.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE usage (ts TEXT, model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER)');
    const ins = db.prepare('INSERT INTO usage VALUES (?, ?, ?, ?)');
    ins.run('2026-01-01T00:00:00.000Z', 'm', 111, 0);
    ins.run('2026-07-01T00:00:00.000Z', 'm', 222, 0);
    db.close();

    const ctx = { home: '/', scanDirs: [], since: new Date('2026-06-01T00:00:00Z'), env: { LITELLM_SPEND_DB: dbPath } };
    const r = await litellmCollector.collect(ctx);
    expect(r.tokens?.input).toBe(222);
  });

  it('warns instead of throwing on a db without a spend table', async () => {
    const { DatabaseSync } = await import('node:sqlite' as string);
    const dir = await mkdtemp(join(tmpdir(), 'vibe-litellm-bad-'));
    const dbPath = join(dir, 'other.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE unrelated (x INTEGER)');
    db.close();

    const r = await litellmCollector.collect({ home: '/', scanDirs: [], env: { LITELLM_SPEND_DB: dbPath } });
    expect(r.sources).toBeUndefined();
    expect(r.warnings?.[0]).toMatch(/no spend table/);
  });
});

describe('litellmCollector — LITELLM_BASE_URL (/spend/logs API)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sums API rows and sends the bearer key', async () => {
    let seenUrl = '';
    let seenAuth: string | null = null;
    globalThis.fetch = (async (url: any, init?: any) => {
      seenUrl = String(url);
      seenAuth = init?.headers?.authorization ?? null;
      return new Response(
        JSON.stringify([
          { model: 'gpt-5', spend: 1.25, prompt_tokens: 10_000, completion_tokens: 2_000 },
          { model: 'deepseek/v4', spend: 0.05, prompt_tokens: 90_000, completion_tokens: 5_000 },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const ctx = { home: '/', scanDirs: [], env: { LITELLM_BASE_URL: 'http://gw:4000/', LITELLM_API_KEY: 'sk-test' } };
    const r = await litellmCollector.collect(ctx);
    expect(seenUrl).toBe('http://gw:4000/spend/logs');
    expect(seenAuth).toBe('Bearer sk-test');
    expect(r.tokens).toEqual({ input: 100_000, output: 7_000, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBeCloseTo(1.3, 10);
    expect(r.sources).toEqual(['litellm']);
  });

  it('warns instead of throwing when the gateway is down or denies', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 401 })) as typeof fetch;
    const r = await litellmCollector.collect({ home: '/', scanDirs: [], env: { LITELLM_BASE_URL: 'http://gw' } });
    expect(r.sources).toBeUndefined();
    expect(r.warnings?.[0]).toContain('401');
  });
});
