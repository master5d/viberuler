import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCodexJsonl, parseCodexSession, codexCollector } from '../src/collectors/codex.js';

const fixture = fileURLToPath(new URL('./fixtures/codex/rollout-a.jsonl', import.meta.url));

const tc = (input: number, cached: number, output: number) =>
  JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } },
    },
  });
const ctxLine = (model: string) => JSON.stringify({ type: 'turn_context', payload: { model } });

describe('parseCodexJsonl', () => {
  it('returns the LAST cumulative token_count (not the sum)', () => {
    const u = parseCodexJsonl(readFileSync(fixture, 'utf8'));
    // last record: input 400 of which 200 cached, output 90
    expect(u).toEqual({ input: 200, output: 90, cacheWrite: 0, cacheRead: 200 });
  });
  it('treats cached_input_tokens as PART of input_tokens, never an addition', () => {
    // total_tokens = input + output in real logs; cached is a subset of input.
    const u = parseCodexJsonl(tc(7_473_962, 7_196_416, 21_995));
    expect(u).toEqual({ input: 277_546, output: 21_995, cacheWrite: 0, cacheRead: 7_196_416 });
    expect(u!.input + u!.cacheRead).toBe(7_473_962);
  });
  it('returns null when no token_count lines exist', () => {
    expect(parseCodexJsonl('{"type":"event_msg","payload":{"type":"agent_message"}}\n')).toBeNull();
  });
});

describe('parseCodexSession', () => {
  it('charges each model the delta it spent when a session switches models', () => {
    const s = parseCodexSession(
      [ctxLine('gpt-5.6-luna'), tc(100, 40, 10), tc(300, 140, 30), ctxLine('gpt-5.6-sol'), tc(1000, 600, 80)].join('\n'),
    )!;
    expect(s.byModel.get('gpt-5.6-luna')).toEqual({ input: 160, output: 30, cacheWrite: 0, cacheRead: 140 });
    expect(s.byModel.get('gpt-5.6-sol')).toEqual({ input: 240, output: 50, cacheWrite: 0, cacheRead: 460 });
    expect(s.total).toEqual({ input: 400, output: 80, cacheWrite: 0, cacheRead: 600 });
  });
  it('never lets a counter going backwards produce negative usage', () => {
    const s = parseCodexSession([tc(500, 100, 50), tc(400, 100, 40)].join('\n'))!;
    expect(s.total).toEqual({ input: 400, output: 50, cacheWrite: 0, cacheRead: 100 });
  });
});

describe('codexCollector', () => {
  async function homeWith(content: string) {
    const home = await mkdtemp(join(tmpdir(), 'vibe-codex-'));
    const sessions = join(home, '.codex', 'sessions', '2026', '06');
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, 'rollout.jsonl'), content);
    return { home, scanDirs: [] as string[] };
  }

  it('prices a session without turn_context at codex-default', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-codex-'));
    const sessions = join(home, '.codex', 'sessions', '2026', '06');
    await mkdir(sessions, { recursive: true });
    await copyFile(fixture, join(sessions, 'rollout-a.jsonl'));

    const ctx = { home, scanDirs: [] as string[] };
    expect(await codexCollector.detect(ctx)).toBe(true);
    const r = await codexCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 200, output: 90, cacheWrite: 0, cacheRead: 200 });
    // codex-default: in 1.25, out 10, cacheRead 0.125 per MTok
    expect(r.costUsd).toBeCloseTo((200 * 1.25 + 90 * 10 + 200 * 0.125) / 1e6, 10);
    expect(r.sources).toEqual(['codex']);
    expect(r.warnings).toEqual([]);
  });

  it('prices each model at its own rate', async () => {
    const ctx = await homeWith([ctxLine('gpt-5.6-luna'), tc(1_000_000, 800_000, 100_000)].join('\n'));
    const r = await codexCollector.collect(ctx);
    // luna: in 0.2, out 1.2, cacheRead 0.02 per MTok
    expect(r.costUsd).toBeCloseTo(0.2 * 0.2 + 0.1 * 1.2 + 0.8 * 0.02, 10);
    expect(r.warnings).toEqual([]);
  });

  it('names an unknown model and prices it at codex-default instead of the sonnet fallback', async () => {
    const ctx = await homeWith([ctxLine('gpt-9-mystery'), tc(1_000_000, 0, 0)].join('\n'));
    const r = await codexCollector.collect(ctx);
    expect(r.costUsd).toBeCloseTo(1.25, 10);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings![0]).toContain('gpt-9-mystery');
    expect(r.warnings![0]).toContain('codex-default');
  });

  it('does not detect without ~/.codex/sessions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nocodex-'));
    expect(await codexCollector.detect({ home, scanDirs: [] })).toBe(false);
  });
});
