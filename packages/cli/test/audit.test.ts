import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAuditJsonl, emptyAcc, discoverSurfaces, runAudit } from '../src/audit.js';

const asst = (id: string, req: string, usage: object, content?: unknown[], side = false) =>
  JSON.stringify({
    type: 'assistant', requestId: req, isSidechain: side, agentId: side ? `a-${id}` : undefined,
    message: { id, model: 'claude-sonnet-4-5', usage, content },
  });

const res = (tid: string, chars: number, side = false) =>
  JSON.stringify({
    type: 'user', isSidechain: side,
    message: { content: [{ type: 'tool_result', tool_use_id: tid, content: 'x'.repeat(chars) }] },
  });

const USAGE = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000 };

describe('parseAuditJsonl', () => {
  it('dedups replayed usage records by message.id + requestId', () => {
    const acc = emptyAcc();
    const line = asst('m1', 'r1', USAGE);
    // the same record replayed three times — the real transcripts do this
    parseAuditJsonl([line, line, line].join('\n'), acc);
    expect(acc.main.tokens).toEqual({ input: 100, output: 50, cacheWrite: 200, cacheRead: 1000 });
  });

  it('counts distinct records separately', () => {
    const acc = emptyAcc();
    parseAuditJsonl([asst('m1', 'r1', USAGE), asst('m2', 'r2', USAGE)].join('\n'), acc);
    expect(acc.main.tokens.input).toBe(200);
  });

  it('routes sidechain turns to the subagent chain, not the main thread', () => {
    const acc = emptyAcc();
    parseAuditJsonl([asst('m1', 'r1', USAGE), asst('m2', 'r2', USAGE, undefined, true)].join('\n'), acc);
    expect(acc.main.tokens.input).toBe(100);
    expect(acc.side.tokens.input).toBe(100);
    expect(acc.agentIds.size).toBe(1);
  });

  it('prices the no-cache counterfactual above the actual cost', () => {
    const acc = emptyAcc();
    parseAuditJsonl(asst('m1', 'r1', USAGE), acc);
    // cached tokens re-billed as fresh input must cost strictly more
    expect(acc.costNoCacheUsd).toBeGreaterThan(acc.costUsd);
    expect(acc.costUsd).toBeGreaterThan(0);
  });

  it('counts tool calls and attributes result sizes, deduping both', () => {
    const acc = emptyAcc();
    const use = asst('m1', 'r1', USAGE, [{ type: 'tool_use', id: 't1', name: 'Read' }]);
    parseAuditJsonl([use, use, res('t1', 400), res('t1', 400)].join('\n'), acc); // both replayed
    const read = acc.tools.get('Read')!;
    expect(read.calls).toBe(1);          // not 2
    expect(read.resultTokens).toBe(100); // 400 chars / 4, counted once
    expect(acc.main.admitted).toBe(100);
  });

  it('measures subagent compression: work admitted inside vs handed back', () => {
    const acc = emptyAcc();
    parseAuditJsonl(
      [
        // main thread dispatches a subagent…
        asst('m1', 'r1', USAGE, [{ type: 'tool_use', id: 'a1', name: 'Agent' }]),
        // …the subagent reads a lot INSIDE its own context…
        asst('s1', 'rs1', USAGE, [{ type: 'tool_use', id: 't9', name: 'Read' }], true),
        res('t9', 40_000, true), // 10,000 tok admitted inside the subagent
        // …and hands back a small summary to the parent.
        res('a1', 400),          // 100 tok returned to the main thread
      ].join('\n'),
      acc,
    );
    expect(acc.agentCalls).toBe(1);
    expect(acc.side.admitted).toBe(10_000); // never touched the parent context
    expect(acc.agentReturned).toBe(100);
    expect(acc.main.admitted).toBe(100);    // only the summary landed here
  });
});

// A Read tool_use carrying its real input, so the result can be classified.
const readUse = (id: string, path: string, sliced = false) => ({
  type: 'tool_use', id, name: 'Read',
  input: sliced ? { file_path: path, offset: 10, limit: 20 } : { file_path: path },
});

const editUse = (id: string, path: string) => ({
  type: 'tool_use', id, name: 'Edit', input: { file_path: path },
});

// asst() with an explicit timestamp — cold context is defined by the EARLIEST turn.
const asstAt = (id: string, req: string, ts: string, usage: object, side = false) =>
  JSON.stringify({
    type: 'assistant', requestId: req, isSidechain: side, timestamp: ts,
    agentId: side ? `a-${id}` : undefined,
    message: { id, model: 'claude-sonnet-4-5', usage, content: [] },
  });

const usageOf = (input: number) => ({
  input_tokens: input, output_tokens: 10,
  cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
});

describe('ghost tokens', () => {
  it('flags a re-read of the same path at the same size, but not a changed file', () => {
    const acc = emptyAcc();
    parseAuditJsonl(
      [
        asst('m1', 'r1', USAGE, [readUse('t1', '/a.ts'), readUse('t2', '/a.ts'), readUse('t3', '/b.ts')]),
        res('t1', 400),   // 100 tok
        res('t2', 400),   // identical size at the same path -> ghost
        res('t3', 800),   // different path -> not a ghost
      ].join('\n'),
      acc,
    );
    expect(acc.ghosts.repeatReadCalls).toBe(1);
    expect(acc.ghosts.repeatReadTokens).toBe(100);
  });

  it('does not flag a re-read whose size changed — the file was edited between reads', () => {
    const acc = emptyAcc();
    parseAuditJsonl(
      [
        asst('m1', 'r1', USAGE, [readUse('t1', '/a.ts'), readUse('t2', '/a.ts')]),
        res('t1', 400),
        res('t2', 900), // grew -> a real, necessary re-read
      ].join('\n'),
      acc,
    );
    expect(acc.ghosts.repeatReadCalls).toBe(0);
  });

  it('separates exploratory reads from load-bearing ones, even when the edit comes later', () => {
    const acc = emptyAcc();
    parseAuditJsonl(
      [
        asst('m1', 'r1', USAGE, [readUse('t1', '/edited.ts'), readUse('t2', '/browsed.ts')]),
        res('t1', 4000),  // 1000 tok — read in order to change it
        res('t2', 2000),  //  500 tok — read and never touched again
        // the edit lands much later in the session: classification must wait
        asst('m2', 'r2', USAGE, [editUse('e1', '/edited.ts')]),
      ].join('\n'),
      acc,
    );
    expect(acc.ghosts.exploratoryCalls).toBe(1);
    expect(acc.ghosts.exploratoryTokens).toBe(500); // only /browsed.ts
  });

  it('counts a sliced read as disciplined and never as exploratory', () => {
    const acc = emptyAcc();
    parseAuditJsonl(
      [
        asst('m1', 'r1', USAGE, [readUse('t1', '/big.ts', true)]),
        res('t1', 4000),
      ].join('\n'),
      acc,
    );
    expect(acc.ghosts.readCalls).toBe(1);
    expect(acc.ghosts.slicedCalls).toBe(1);
    expect(acc.ghosts.exploratoryCalls).toBe(0); // asking for a slice IS the fix
  });

  it('counts results over 4KB as oversized, whatever tool produced them', () => {
    const acc = emptyAcc();
    parseAuditJsonl(
      [
        asst('m1', 'r1', USAGE, [
          { type: 'tool_use', id: 't1', name: 'Bash' },
          { type: 'tool_use', id: 't2', name: 'Bash' },
        ]),
        res('t1', 4097), // over
        res('t2', 4096), // exactly at the line — not over
      ].join('\n'),
      acc,
    );
    expect(acc.ghosts.oversizedCalls).toBe(1);
  });

  it('ignores subagent-side reads — their context is not the one we are protecting', () => {
    const acc = emptyAcc();
    parseAuditJsonl(
      [
        asst('s1', 'rs1', USAGE, [readUse('t1', '/a.ts')], true),
        res('t1', 40_000, true),
      ].join('\n'),
      acc,
    );
    expect(acc.ghosts.readCalls).toBe(0);
    expect(acc.ghosts.oversizedCalls).toBe(0);
    expect(acc.side.admitted).toBe(10_000); // still counted as subagent work
  });
});

describe('cold context', () => {
  it('takes the earliest turn, not the first line, and keeps spawns apart', () => {
    const acc = emptyAcc();
    parseAuditJsonl(
      [
        asstAt('m2', 'r2', '2026-07-11T10:05:00Z', usageOf(90_000)), // later, bigger
        asstAt('m1', 'r1', '2026-07-11T10:00:00Z', usageOf(50_000)), // the real cold start
      ].join('\n'),
      acc,
    );
    expect(acc.coldMain).toEqual([50_000]);
  });

  it('files a sidechain transcript as a subagent spawn', () => {
    const acc = emptyAcc();
    parseAuditJsonl(asstAt('s1', 'rs1', '2026-07-11T10:00:00Z', usageOf(32_000), true), acc);
    expect(acc.coldMain).toEqual([]);
    expect(acc.coldSub).toEqual([32_000]);
  });

  it('falls back to file order when a transcript carries no timestamps', () => {
    const acc = emptyAcc();
    parseAuditJsonl([asst('m1', 'r1', USAGE), asst('m2', 'r2', USAGE)].join('\n'), acc);
    expect(acc.coldMain).toEqual([1300]); // 100 input + 200 write + 1000 read
  });
});

async function fakeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vibe-audit-'));
}

describe('discoverSurfaces', () => {
  it('finds user-scope MCP servers and MCP-bearing enabled plugins, ignoring skill-only ones', async () => {
    const home = await fakeHome();
    await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { pencil: {}, 'seq-think': {} } }));
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'serena@official': true,      // ships .mcp.json  -> a surface
          'superpowers@official': true, // skills only      -> NOT a surface
          'figma@official': false,      // disabled         -> not loaded, not overhead
        },
      }),
    );
    const cache = join(home, '.claude', 'plugins', 'cache', 'official');
    await mkdir(join(cache, 'serena', '1.0.0'), { recursive: true });
    await writeFile(join(cache, 'serena', '1.0.0', '.mcp.json'), '{}');
    await mkdir(join(cache, 'superpowers', '1.0.0'), { recursive: true });
    await mkdir(join(cache, 'figma', '1.0.0'), { recursive: true });
    await writeFile(join(cache, 'figma', '1.0.0', '.mcp.json'), '{}');

    const s = await discoverSurfaces(home);
    const names = s.map((x) => x.name).sort();
    expect(names).toEqual(['pencil', 'seq-think', 'serena']);
    expect(s.find((x) => x.name === 'serena')!.prefix).toBe('mcp__plugin_serena_');
    expect(s.find((x) => x.name === 'pencil')!.prefix).toBe('mcp__pencil__');
  });

  it('returns nothing on a bare home', async () => {
    expect(await discoverSurfaces(await fakeHome())).toEqual([]);
  });
});

describe('runAudit', () => {
  it('flags a configured-but-never-called surface as dead weight, and spares a used one', async () => {
    const home = await fakeHome();
    await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { pencil: {}, ghost: {} } }));
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });
    await writeFile(
      join(proj, 's.jsonl'),
      [
        asst('m1', 'r1', USAGE, [{ type: 'tool_use', id: 't1', name: 'mcp__pencil__batch_get' }]),
        asst('m2', 'r2', USAGE, [{ type: 'tool_use', id: 't2', name: 'Read' }]),
      ].join('\n'),
    );

    const r = await runAudit({ home, scanDirs: [] });
    expect(r.sessions).toBe(1);
    expect(r.dead.map((d) => d.name)).toEqual(['ghost']); // pencil was called, ghost never
    expect(r.cacheHitPct).toBeGreaterThan(0);
    expect(r.tools.find((t) => t.name === 'Read')!.calls).toBe(1);
    expect(r.costNoCacheUsd).toBeGreaterThan(r.costUsd);
  });

  it('keeps main-thread amplification apart from subagent contexts', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });
    await writeFile(
      join(proj, 's.jsonl'),
      [
        asst('m1', 'r1', USAGE, [{ type: 'tool_use', id: 'a1', name: 'Agent' }]),
        asst('s1', 'rs1', USAGE, [{ type: 'tool_use', id: 't9', name: 'Read' }], true),
        res('t9', 40_000, true), // 10,000 tok inside the subagent
        res('a1', 400),          // 100 tok back to the parent
      ].join('\n'),
    );

    const r = await runAudit({ home, scanDirs: [] });
    // main thread admitted only the 100-token summary; the subagent ate 10,000
    expect(r.main.admittedTokens).toBe(100);
    expect(r.sub.admittedTokens).toBe(10_000);
    expect(r.subagents.calls).toBe(1);
    expect(r.subagents.agents).toBe(1);
    expect(r.subagents.returnedTokens).toBe(100);
    expect(r.subagents.keptOutTokens).toBe(9_900);
    expect(r.subagents.compression).toBe(100); // 10,000 / 100
    // main-thread amplification is computed on the main chain alone — pooling
    // the subagent's cheap-per-token context would understate it
    expect(r.main.amplification).toBeGreaterThan(r.sub.amplification);
    expect(r.subagents.shareOfSpendPct).toBeCloseTo(50, 0); // one msg each side
  });

  it('reports the median cold context across sessions, not the mean', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });
    // one pathological session must not drag the reported figure with it
    const sizes = [40_000, 50_000, 60_000, 900_000];
    await Promise.all(
      sizes.map((n, i) =>
        writeFile(join(proj, `s${i}.jsonl`), asstAt(`m${i}`, `r${i}`, '2026-07-11T10:00:00Z', usageOf(n))),
      ),
    );

    const r = await runAudit({ home, scanDirs: [] });
    expect(r.coldMain.sessions).toBe(4);
    expect(r.coldMain.medianTokens).toBe(60_000); // not the 262k mean
  });

  it('reports zero sessions on a rig with no transcripts', async () => {
    const r = await runAudit({ home: await fakeHome(), scanDirs: [] });
    expect(r.sessions).toBe(0);
    expect(r.dead).toEqual([]);
    expect(r.subagents.calls).toBe(0);
    expect(r.coldMain.medianTokens).toBe(0);
    expect(r.ghosts.readCalls).toBe(0);
  });
});
