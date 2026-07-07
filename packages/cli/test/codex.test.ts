import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCodexJsonl, codexCollector } from '../src/collectors/codex.js';

const fixture = fileURLToPath(new URL('./fixtures/codex/rollout-a.jsonl', import.meta.url));

describe('parseCodexJsonl', () => {
  it('returns the LAST cumulative token_count (not the sum)', () => {
    const u = parseCodexJsonl(readFileSync(fixture, 'utf8'));
    expect(u).toEqual({ input: 400, output: 90, cacheWrite: 0, cacheRead: 200 });
  });
  it('returns null when no token_count lines exist', () => {
    expect(parseCodexJsonl('{"type":"event_msg","payload":{"type":"agent_message"}}\n')).toBeNull();
  });
});

describe('codexCollector', () => {
  it('aggregates sessions and prices at codex-default', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-codex-'));
    const sessions = join(home, '.codex', 'sessions', '2026', '06');
    await mkdir(sessions, { recursive: true });
    await copyFile(fixture, join(sessions, 'rollout-a.jsonl'));

    const ctx = { home, scanDirs: [] as string[] };
    expect(await codexCollector.detect(ctx)).toBe(true);
    const r = await codexCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 400, output: 90, cacheWrite: 0, cacheRead: 200 });
    // codex-default: in 1.25, out 10, cacheRead 0.125 per MTok
    expect(r.costUsd).toBeCloseTo((400 * 1.25 + 90 * 10 + 200 * 0.125) / 1e6, 10);
    expect(r.sources).toEqual(['codex']);
  });

  it('does not detect without ~/.codex/sessions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nocodex-'));
    expect(await codexCollector.detect({ home, scanDirs: [] })).toBe(false);
  });
});
