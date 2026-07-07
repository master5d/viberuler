import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaudeJsonl, claudeCodeCollector } from '../src/collectors/claude-code.js';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/claude/${name}`, import.meta.url));

describe('parseClaudeJsonl', () => {
  it('sums usage, dedups by message.id+requestId, counts corrupt lines', () => {
    const seen = new Set<string>();
    const r = parseClaudeJsonl(readFileSync(fixture('session-a.jsonl'), 'utf8'), seen);
    // duplicate line must count once; corrupt line -> skipped; missing-usage line ignored silently
    expect(r.tokens).toEqual({ input: 100, output: 200, cacheWrite: 1000, cacheRead: 5000 });
    // sonnet: (100*3 + 200*15 + 1000*3.75 + 5000*0.3)/1e6
    expect(r.costUsd).toBeCloseTo((100 * 3 + 200 * 15 + 1000 * 3.75 + 5000 * 0.3) / 1e6, 10);
    expect(r.skipped).toBe(1);
  });

  it('dedups across files via the shared seen set', () => {
    const seen = new Set<string>();
    const content = readFileSync(fixture('session-a.jsonl'), 'utf8');
    const first = parseClaudeJsonl(content, seen);
    const second = parseClaudeJsonl(content, seen);
    expect(first.tokens.input).toBe(100);
    expect(second.tokens.input).toBe(0);
  });

  it('filters records older than since', () => {
    const r = parseClaudeJsonl(
      readFileSync(fixture('session-b.jsonl'), 'utf8'),
      new Set(),
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(r.tokens).toEqual({ input: 1000, output: 2000, cacheWrite: 0, cacheRead: 0 });
  });
});

describe('claudeCodeCollector', () => {
  it('detects and aggregates a fake ~/.claude/projects tree', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-home-'));
    const proj = join(home, '.claude', 'projects', 'C--fake');
    await mkdir(proj, { recursive: true });
    await copyFile(fixture('session-a.jsonl'), join(proj, 'a.jsonl'));
    await copyFile(fixture('session-b.jsonl'), join(proj, 'b.jsonl'));

    const ctx = { home, scanDirs: [] as string[] };
    expect(await claudeCodeCollector.detect(ctx)).toBe(true);
    const r = await claudeCodeCollector.collect(ctx);
    expect(r.tokens!.input).toBe(100 + 10 + 1000);
    expect(r.sources).toEqual(['claude-code']);
  });

  it('does not detect when ~/.claude/projects is absent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-empty-'));
    expect(await claudeCodeCollector.detect({ home, scanDirs: [] })).toBe(false);
  });
});
