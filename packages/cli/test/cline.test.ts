import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { parseClineTaskFile, clineCollector } from '../src/collectors/cline.js';

// One api_req_started with a full metric+cost, one with tokens but NO cost
// (price-table fallback), one streaming/partial entry (unparseable text → skip),
// plus non-metric messages that must be ignored.
const taskFile = JSON.stringify([
  { type: 'say', say: 'text', text: 'hello' },
  {
    type: 'say',
    say: 'api_req_started',
    text: JSON.stringify({ request: '...', tokensIn: 1000, tokensOut: 500, cacheReads: 8000, cacheWrites: 2000, cost: 0.042 }),
  },
  {
    type: 'say',
    say: 'api_req_started',
    text: JSON.stringify({ tokensIn: 100, tokensOut: 50, cacheReads: 0, cacheWrites: 0 }),
  },
  { type: 'say', say: 'api_req_started', text: '{"request":"in progress' }, // partial → skip
  { type: 'ask', ask: 'tool', text: 'whatever' },
]);

describe('parseClineTaskFile', () => {
  it('sums api_req_started metrics; trusts logged cost, else prices at sonnet tier', () => {
    const r = parseClineTaskFile(taskFile);
    expect(r).not.toBeNull();
    expect(r!.tokens).toEqual({ input: 1100, output: 550, cacheWrite: 2000, cacheRead: 8000 });
    // 0.042 (logged) + costForUsage('claude-sonnet',{in100,out50}) = 0.042 + (100*3+50*15)/1e6
    expect(r!.costUsd).toBeCloseTo(0.042 + 0.00105, 12);
  });

  it('trusts a logged cost of exactly 0 (fully cached) instead of re-pricing', () => {
    const f = JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 5, tokensOut: 0, cacheReads: 9000, cacheWrites: 0, cost: 0 }) },
    ]);
    expect(parseClineTaskFile(f)!.costUsd).toBe(0);
  });

  it('returns null for non-array JSON and for arrays with no completed metrics', () => {
    expect(parseClineTaskFile('{"not":"an array"}')).toBeNull();
    expect(parseClineTaskFile('not json at all')).toBeNull();
    expect(parseClineTaskFile(JSON.stringify([{ type: 'say', say: 'text', text: 'hi' }]))).toBeNull();
    // an api_req_started with no token fields = request not yet completed
    expect(parseClineTaskFile(JSON.stringify([{ type: 'say', say: 'api_req_started', text: '{"request":"x"}' }]))).toBeNull();
  });

  it('coerces missing/non-numeric token fields to 0 without NaN-poisoning', () => {
    const f = JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 10, tokensOut: 'bad', cacheReads: null, cost: 0.001 }) },
    ]);
    const r = parseClineTaskFile(f)!;
    expect(r.tokens).toEqual({ input: 10, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBeCloseTo(0.001, 12);
  });
});

async function makeTask(root: string, extId: string, taskId: string, messages: unknown[]): Promise<void> {
  const dir = join(root, extId, 'tasks', taskId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'ui_messages.json'), JSON.stringify(messages));
}

function apiReq(m: Record<string, number>): unknown {
  return { type: 'say', say: 'api_req_started', text: JSON.stringify(m) };
}

describe('clineCollector', () => {
  it('stays dormant when no roots hold task files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-nocline-'));
    const ctx = { home, scanDirs: [] as string[], env: { VIBERULER_CLINE_STORAGE: home } };
    expect(await clineCollector.detect(ctx)).toBe(false);
  });

  it('aggregates tokens/cost across tasks and reports the Cline agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-cline-'));
    await makeTask(root, 'saoudrizwan.claude-dev', 'task-1', [apiReq({ tokensIn: 1000, tokensOut: 500, cacheReads: 0, cacheWrites: 0, cost: 0.01 })]);
    await makeTask(root, 'saoudrizwan.claude-dev', 'task-2', [apiReq({ tokensIn: 200, tokensOut: 100, cacheReads: 0, cacheWrites: 0, cost: 0.02 })]);
    const ctx = { home: '/', scanDirs: [], env: { VIBERULER_CLINE_STORAGE: root } };
    expect(await clineCollector.detect(ctx)).toBe(true);
    const r = await clineCollector.collect(ctx);
    expect(r.tokens).toEqual({ input: 1200, output: 600, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBeCloseTo(0.03, 12);
    expect(r.sources).toEqual(['cline']);
    expect(r.agents).toEqual(['Cline']);
  });

  it('maps fork extension IDs to distinct agent names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-roo-'));
    await makeTask(root, 'rooveterinaryinc.roo-cline', 't1', [apiReq({ tokensIn: 10, tokensOut: 5, cacheReads: 0, cacheWrites: 0, cost: 0 })]);
    await makeTask(root, 'kilocode.kilo-code', 't2', [apiReq({ tokensIn: 20, tokensOut: 5, cacheReads: 0, cacheWrites: 0, cost: 0 })]);
    const r = await clineCollector.collect({ home: '/', scanDirs: [], env: { VIBERULER_CLINE_STORAGE: root } });
    expect(new Set(r.agents)).toEqual(new Set(['Roo Code', 'KiloCode']));
  });

  it('dedups the same taskId synced across two roots (multi-install)', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'vibe-ca-'));
    const rootB = await mkdtemp(join(tmpdir(), 'vibe-cb-'));
    const msgs = [apiReq({ tokensIn: 1000, tokensOut: 0, cacheReads: 0, cacheWrites: 0, cost: 0.05 })];
    await makeTask(rootA, 'saoudrizwan.claude-dev', 'dup-task', msgs);
    await makeTask(rootB, 'saoudrizwan.claude-dev', 'dup-task', msgs);
    const r = await clineCollector.collect({ home: '/', scanDirs: [], env: { VIBERULER_CLINE_STORAGE: `${rootA}${delimiter}${rootB}` } });
    expect(r.tokens!.input).toBe(1000); // counted once, not 2000
    expect(r.costUsd).toBeCloseTo(0.05, 12);
  });

  it('skips unparseable task files and warns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-clinebad-'));
    const dir = join(root, 'saoudrizwan.claude-dev', 'tasks', 'broken');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ui_messages.json'), 'not json');
    const r = await clineCollector.collect({ home: '/', scanDirs: [], env: { VIBERULER_CLINE_STORAGE: root } });
    expect(r.warnings?.[0]).toMatch(/skipped 1 unparseable/);
  });
});
