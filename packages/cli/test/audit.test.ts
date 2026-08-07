import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAuditJsonl, emptyAcc, discoverSurfaces, runAudit, runAuditCompare } from '../src/audit.js';
import { attributeRootCauses } from '../src/root-cause.js';
import { renderRootCauses, renderAudit } from '../src/render-audit.js';
import type { RootCause } from '../src/root-cause.js';

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

describe('wasteEvents', () => {
  const readUse = (id: string, path: string, sliced = false) =>
    JSON.stringify({
      type: 'assistant', requestId: `r-${id}`, message: {
        id: `m-${id}`, model: 'claude-sonnet-4-5', usage: { input_tokens: 1 },
        content: [{ type: 'tool_use', id, name: 'Read',
          input: sliced ? { file_path: path, offset: 0, limit: 10 } : { file_path: path } }],
      },
    });

  it('emits a read WasteEvent and marks exploratory when the path is never edited', () => {
    const acc = emptyAcc();
    // Read big.ts whole (never edited later) → exploratory
    parseAuditJsonl([readUse('t1', '/x/big.ts'), res('t1', 8000)].join('\n'), acc);
    const reads = acc.wasteEvents.filter((e) => e.kind === 'read');
    expect(reads).toHaveLength(1);
    expect(reads[0]!.path).toBe('/x/big.ts');
    expect(reads[0]!.oversized).toBe(true);       // 8000 chars > 4096
    expect(reads[0]!.sliced).toBe(false);
    expect(reads[0]!.exploratory).toBe(true);      // never edited
  });

  it('emits an agent WasteEvent for an Agent return', () => {
    const acc = emptyAcc();
    const agentUse = JSON.stringify({
      type: 'assistant', requestId: 'ra', message: {
        id: 'ma', model: 'claude-sonnet-4-5', usage: { input_tokens: 1 },
        content: [{ type: 'tool_use', id: 'ag1', name: 'Agent', input: {} }],
      },
    });
    parseAuditJsonl([agentUse, res('ag1', 20000)].join('\n'), acc);
    const agents = acc.wasteEvents.filter((e) => e.kind === 'agent');
    expect(agents).toHaveLength(1);
    expect(agents[0]!.tokens).toBeGreaterThan(0);
    // and it flows through attribution as bloat (20000 chars ≈ >2000 tokens)
    expect(attributeRootCauses(acc.wasteEvents, (t) => t).some(
      (r) => r.motif === 'subagent-result-bloat')).toBe(true);
  });
});

describe('runAudit rootCauses (--why)', () => {
  it('omits rootCauses without ctx.why and populates with it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vr-why-'));
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });
    const readUse = JSON.stringify({
      type: 'assistant', requestId: 'r1', message: {
        id: 'm1', model: 'claude-sonnet-4-5',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x/big.ts' } }],
      },
    });
    const result = JSON.stringify({
      type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(9000) }] },
    });
    await writeFile(join(proj, 's.jsonl'), [readUse, result].join('\n'));

    const base = { home, scanDirs: [], env: {} };
    const without = await runAudit(base);
    expect(without.rootCauses).toBeUndefined();

    const withWhy = await runAudit({ ...base, why: true });
    expect(Array.isArray(withWhy.rootCauses)).toBe(true);
    // an oversized, never-edited whole read → explore-wide or oversized motif present
    expect(withWhy.rootCauses!.length).toBeGreaterThan(0);
  });
});

describe('renderRootCauses', () => {
  const rc: RootCause[] = [
    { motif: 'subagent-result-bloat', rootCause: 'subagents returned large results',
      fix: 'return summaries', attributableTokens: 3000, attributableUsd: 0.01, evidence: [] },
    { motif: 'read-whole-then-reread', rootCause: 're-read an unchanged file',
      fix: 'slice reads', attributableTokens: 300, attributableUsd: 0.001,
      evidence: ['big.ts (300 tok)'] },
  ];

  it('renders the disclaimer, ranked motifs, evidence, and a total', () => {
    const s = renderRootCauses(rc);
    expect(s.toLowerCase()).toContain('not proven causation');   // honesty disclaimer
    expect(s.indexOf('subagent-result-bloat')).toBeLessThan(s.indexOf('read-whole-then-reread')); // ranked
    expect(s).toContain('big.ts (300 tok)');                     // evidence
    expect(s).toContain('3300');                                 // total attributed tokens
  });

  it('renders nothing for an empty list', () => {
    expect(renderRootCauses([])).toBe('');
  });
});

describe('time metrics in runAudit and renderAudit', () => {
  it('populates time metrics when transcripts with timestamps exist', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-audit-time-'));
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });

    const lines = [
      JSON.stringify({
        timestamp: '2026-07-26T10:00:00.000Z', cwd: 'C:\\work\\myproj',
        type: 'assistant', requestId: 'r1', message: { id: 'm1', model: 'claude-sonnet-4-5', usage: USAGE },
      }),
      JSON.stringify({
        timestamp: '2026-07-26T10:01:00.000Z', cwd: 'C:\\work\\myproj',
        type: 'assistant', requestId: 'r2', message: { id: 'm2', model: 'claude-sonnet-4-5', usage: USAGE },
      }),
    ];
    await writeFile(join(proj, 's.jsonl'), lines.join('\n'));

    const r = await runAudit({ home, scanDirs: [] });
    expect(r.time).toBeDefined();
    expect(r.time!.totalActiveMs).toBeGreaterThan(0);
    expect(r.time!.days.length).toBeGreaterThan(0);
    expect(r.time!.projects).toEqual([{ name: 'myproj', activeMs: 60_000 }]);
  });

  it('changes activeMs when gap threshold changes via gapMs parameter', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-audit-gap-'));
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });

    const lines = [
      JSON.stringify({ timestamp: '2026-07-26T10:00:00.000Z', cwd: 'C:\\work\\myproj' }),
      JSON.stringify({ timestamp: '2026-07-26T10:02:00.000Z', cwd: 'C:\\work\\myproj' }),
    ];
    await writeFile(join(proj, 's.jsonl'), lines.join('\n'));

    // gapMs = 60_000 (1 min): 2 min gap > 1 min threshold => activeMs is 0
    const r1 = await runAudit({ home, scanDirs: [] }, 60_000);
    expect(r1.time!.totalActiveMs).toBe(0);

    // gapMs = 180_000 (3 min, default): 2 min gap <= 3 min threshold => activeMs is 120_000
    const r3 = await runAudit({ home, scanDirs: [] }, 180_000);
    expect(r3.time!.totalActiveMs).toBe(120_000);
  });

  it('renders the market-reprice section only when --market attached rates, cheapest first, caveats stated', () => {
    const base: any = {
      sessions: 1,
      main: { admittedTokens: 0, inputSideTokens: 0, amplification: 0 },
      sub: { admittedTokens: 0, inputSideTokens: 0, amplification: 0 },
      tokens: { input: 1_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 },
      costUsd: 1, costNoCacheUsd: 1, cacheHitPct: 0,
      subagents: { calls: 0 }, coldMain: { sessions: 0 }, coldSub: { sessions: 0 },
      ghosts: { readCalls: 0, oversizedCalls: 0 }, tools: [], surfaces: [], dead: [], warnings: [],
    };
    const noMarket = renderAudit(base, { colors: false, version: '1.0.0' });
    expect(noMarket).not.toContain('MARKET RATES');

    const withMarket = renderAudit(
      {
        ...base,
        market: {
          asOf: '2026-08-07', source: 'bundled',
          rates: [
            { id: 'a/expensive', label: 'Expensive', input: 10, output: 50, cacheRead: 1, cacheWrite: 10 },
            { id: 'b/cheap', label: 'Cheap', input: 0.1, output: 0.2, cacheRead: 0.1, cacheWrite: 0.1 },
          ],
        },
      },
      { colors: false, version: '1.0.0' },
    );
    expect(withMarket).toContain('YOUR MIX AT MARKET RATES');
    expect(withMarket).toContain('bundled snapshot · as of 2026-08-07');
    // both rows unscored → sorted by cost ascending, labelled honestly, no crown
    expect(withMarket.indexOf('Cheap')).toBeLessThan(withMarket.indexOf('Expensive'));
    expect(withMarket).toContain('$0.30'); // cheap: 1M×0.1 + 1M×0.2
    expect(withMarket).toContain('$60.00'); // expensive: 1M×10 + 1M×50
    expect(withMarket).toContain('no published score');
    expect(withMarket).not.toContain('max AI per dollar');
    expect(withMarket).toContain('arithmetic, not advice');
    expect(withMarket).toContain('not what you would save');
  });

  it('ranks scored counters by AI performance per dollar of the mix and crowns the max', () => {
    const base: any = {
      sessions: 1,
      main: { admittedTokens: 0, inputSideTokens: 0, amplification: 0 },
      sub: { admittedTokens: 0, inputSideTokens: 0, amplification: 0 },
      tokens: { input: 1_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 },
      costUsd: 1, costNoCacheUsd: 1, cacheHitPct: 0,
      subagents: { calls: 0 }, coldMain: { sessions: 0 }, coldSub: { sessions: 0 },
      ghosts: { readCalls: 0, oversizedCalls: 0 }, tools: [], surfaces: [], dead: [], warnings: [],
      market: {
        asOf: '2026-08-07', source: 'live',
        rates: [
          // smart but pricey: 60 intel / $60 = 1 intel/$
          { id: 'a/smart', label: 'Smart', input: 10, output: 50, cacheRead: 1, cacheWrite: 10, intelligence: 60 },
          // mid brain, tiny price: 45 intel / $0.30 = 150 intel/$ → the crown
          { id: 'b/value', label: 'Value', input: 0.1, output: 0.2, cacheRead: 0.1, cacheWrite: 0.1, intelligence: 45 },
          // no score → trails the scored rows regardless of price
          { id: 'c/mystery', label: 'Mystery', input: 0.05, output: 0.1, cacheRead: 0.05, cacheWrite: 0.05 },
        ],
      },
    };
    const out = renderAudit(base, { colors: false, version: '1.0.0' });
    expect(out.indexOf('Value')).toBeLessThan(out.indexOf('Smart')); // perf/$ desc, not price asc
    expect(out.indexOf('Smart')).toBeLessThan(out.indexOf('Mystery')); // unscored trail
    const valueLine = out.split('\n').find((l) => l.includes('Value'))!;
    expect(valueLine).toContain('intel 45.0');
    expect(valueLine).toContain('$0.0067/pt'); // $0.30 mix ÷ 45 index points
    expect(valueLine).toContain('max AI per dollar');
    // the unit must survive a real-scale mix, where points-per-dollar reads 0.00
    const bigLine = renderAudit(
      { ...base, tokens: { input: 34_000_000, output: 123_000_000, cacheWrite: 835_000_000, cacheRead: 25_850_000_000 } },
      { colors: false, version: '1.0.0' },
    ).split('\n').find((l) => l.includes('Smart'))!;
    expect(bigLine).toMatch(/\$\d{3,}\/pt/);
    expect(out.match(/max AI per dollar/g)).toHaveLength(1); // exactly one crown
    expect(out).toContain('Artificial Analysis intelligence index');
  });

  it('renders session time section when present and omits when absent or totalActiveMs === 0', () => {
    const reportWithTime: any = {
      sessions: 1,
      main: { admittedTokens: 0, inputSideTokens: 0, amplification: 0 },
      sub: { admittedTokens: 0, inputSideTokens: 0, amplification: 0 },
      tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      costUsd: 0, costNoCacheUsd: 0, cacheHitPct: 0,
      subagents: { calls: 0 }, coldMain: { sessions: 0 }, coldSub: { sessions: 0 },
      ghosts: { readCalls: 0, oversizedCalls: 0 }, tools: [], surfaces: [], dead: [], warnings: [],
      time: {
        totalWallMs: 31 * 3600 * 1000,
        totalActiveMs: 12.4 * 3600 * 1000,
        days: [{ day: '2026-07-26', wallMs: 31 * 3600 * 1000, activeMs: 12.4 * 3600 * 1000 }],
        projects: [{ name: 'NAUTILUS', activeMs: 6.2 * 3600 * 1000 }, { name: 'viberuler', activeMs: 3.1 * 3600 * 1000 }],
      },
    };

    const rendered = renderAudit(reportWithTime, { colors: false, version: '1.0.0' });
    expect(rendered).toContain('session time');
    expect(rendered).toContain('12.4h attention');
    expect(rendered).toContain('31.0h wall');
    expect(rendered).toContain('across 1 day');
    expect(rendered).toContain('NAUTILUS 6.2h');

    const reportSubMinute: any = {
      ...reportWithTime,
      time: {
        totalWallMs: 40_000,
        totalActiveMs: 15_000, // 15 sec -> <1m
        days: [{ day: '2026-07-26', wallMs: 40_000, activeMs: 15_000 }],
        projects: [{ name: 'tiny', activeMs: 15_000 }],
      },
    };
    const renderedSubMinute = renderAudit(reportSubMinute, { colors: false, version: '1.0.0' });
    expect(renderedSubMinute).toContain('<1m attention');

    const reportNoTime = { ...reportWithTime, time: undefined };
    const renderedNoTime = renderAudit(reportNoTime, { colors: false, version: '1.0.0' });
    expect(renderedNoTime).not.toContain('session time');

    const reportZeroActive = { ...reportWithTime, time: { totalWallMs: 1000, totalActiveMs: 0, days: [], projects: [] } };
    const renderedZeroActive = renderAudit(reportZeroActive, { colors: false, version: '1.0.0' });
    expect(renderedZeroActive).not.toContain('session time');
  });

  it('includes transcripts from all agent homes in both token and time metrics (multi-home scope consistency)', async () => {
    const home1 = await fakeHome();
    const proj1 = join(home1, '.claude', 'projects', 'p1');
    await mkdir(proj1, { recursive: true });
    await writeFile(
      join(proj1, 's1.jsonl'),
      JSON.stringify({
        timestamp: '2026-07-26T10:00:00.000Z', cwd: 'C:\\work\\proj1',
        type: 'assistant', requestId: 'r1', message: { id: 'm1', model: 'claude-sonnet-4-5', usage: USAGE },
      }),
    );

    const home2 = await fakeHome();
    const proj2 = join(home2, '.claude', 'projects', 'p2');
    await mkdir(proj2, { recursive: true });
    await writeFile(
      join(proj2, 's2.jsonl'),
      JSON.stringify({
        timestamp: '2026-07-26T11:00:00.000Z', cwd: 'C:\\work\\proj2',
        type: 'assistant', requestId: 'r2', message: { id: 'm2', model: 'claude-sonnet-4-5', usage: USAGE },
      }),
    );

    const r = await runAudit({ home: home1, agentHomes: [home2], scanDirs: [] });

    expect(r.sessions).toBe(2);
    expect(r.tokens.input).toBe(USAGE.input_tokens * 2);
    expect(r.time).toBeDefined();
    expect(r.time!.projects).toEqual([
      { name: 'proj1', activeMs: 0 },
      { name: 'proj2', activeMs: 0 },
    ]);
  });

  it('does not double-count transcripts when the same agent home is passed twice', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });
    await writeFile(
      join(proj, 's.jsonl'),
      JSON.stringify({
        timestamp: '2026-07-26T10:00:00.000Z', cwd: 'C:\\work\\proj',
        type: 'assistant', requestId: 'r1', message: { id: 'm1', model: 'claude-sonnet-4-5', usage: USAGE },
      }),
    );

    const rSingle = await runAudit({ home, scanDirs: [] });
    const rDuplicate = await runAudit({ home, agentHomes: [home, join(home, '.', '')], scanDirs: [] });

    expect(rDuplicate.sessions).toBe(rSingle.sessions);
    expect(rDuplicate.tokens.input).toBe(rSingle.tokens.input);
    expect(rDuplicate.time!.totalWallMs).toBe(rSingle.time!.totalWallMs);
    expect(rDuplicate.time!.totalActiveMs).toBe(rSingle.time!.totalActiveMs);
  });

  it('counts sessions for every walked file even if readFile fails', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });
    // Write a file that will fail to read or be skipped
    await writeFile(join(proj, 's.jsonl'), 'invalid json line\n');

    const r = await runAudit({ home, scanDirs: [] });
    expect(r.sessions).toBe(1);
    expect(r.warnings).toEqual(['audit: skipped 1 malformed line(s)']);
  });
});

describe('waste accounting and render', () => {
  it('reports exact calls and tokens per class for exploratory, repeat read, and oversized results', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });

    // 1. Exploratory read: whole-file read of /unedited.ts (never edited).
    // 1000 chars -> 250 tokens
    const exploreRes = res('t1', 1000);

    // 2. Repeat read of unchanged file: read /repeat.ts twice at 400 chars (100 tokens), plus edit /repeat.ts so it's not exploratory.
    const repeatRes1 = res('t2', 400);
    const repeatRes2 = res('t3', 400);

    // 3. Oversized result: tool result > 4096 chars (5000 chars = 1250 tokens), plus edit /oversized.ts so it's not exploratory.
    const oversizedRes = res('t4', 5000);

    const edits = JSON.stringify({
      type: 'assistant',
      requestId: 'r-edits',
      message: {
        id: 'm-edits',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 10 },
        content: [
          { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/repeat.ts' } },
          { type: 'tool_use', id: 'e2', name: 'Edit', input: { file_path: '/oversized.ts' } },
        ],
      },
    });

    const lines = [
      asst('m1', 'r1', USAGE, [readUse('t1', '/unedited.ts'), readUse('t2', '/repeat.ts'), readUse('t3', '/repeat.ts'), readUse('t4', '/oversized.ts')]),
      exploreRes,
      repeatRes1,
      repeatRes2,
      oversizedRes,
      edits,
    ];

    await writeFile(join(proj, 's.jsonl'), lines.join('\n'));

    const r = await runAudit({ home, scanDirs: [] });
    expect(r.waste).toBeDefined();
    expect(r.waste!.classes).toHaveLength(3);

    const oversized = r.waste!.classes.find((c) => c.id === 'oversized');
    expect(oversized).toBeDefined();
    expect(oversized!.calls).toBe(1);
    expect(oversized!.tokens).toBe(1250);
    expect(oversized!.label).toBe('oversized single results');
    expect(oversized!.lever).toBe('slicing, head/grep before read');

    const exploratory = r.waste!.classes.find((c) => c.id === 'exploratory');
    expect(exploratory).toBeDefined();
    expect(exploratory!.calls).toBe(1);
    expect(exploratory!.tokens).toBe(250);
    expect(exploratory!.label).toBe('whole-file reads never edited');
    expect(exploratory!.lever).toBe('outline-first / symbol reads');

    const repeatRead = r.waste!.classes.find((c) => c.id === 'repeat-read');
    expect(repeatRead).toBeDefined();
    expect(repeatRead!.calls).toBe(1);
    expect(repeatRead!.tokens).toBe(100);
    expect(repeatRead!.label).toBe('repeat reads of unchanged files');
    expect(repeatRead!.lever).toBe('cache/dedup of tool output');

    // Assert sorted by tokens desc: 1250 > 250 > 100
    expect(r.waste!.classes.map((c) => c.id)).toEqual(['oversized', 'exploratory', 'repeat-read']);
  });

  it('includes an event that is BOTH oversized and exploratory in both classes and has no total waste field', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });

    // Whole file read of /huge.ts (8000 chars = 2000 tokens), never edited
    const lines = [
      asst('m1', 'r1', USAGE, [readUse('t1', '/huge.ts')]),
      res('t1', 8000),
    ];
    await writeFile(join(proj, 's.jsonl'), lines.join('\n'));

    const r = await runAudit({ home, scanDirs: [] });
    expect(r.waste).toBeDefined();
    expect(r.waste!.classes).toHaveLength(2);

    const ids = r.waste!.classes.map((c) => c.id).sort();
    expect(ids).toEqual(['exploratory', 'oversized']);

    const oversized = r.waste!.classes.find((c) => c.id === 'oversized')!;
    const exploratory = r.waste!.classes.find((c) => c.id === 'exploratory')!;
    expect(oversized.tokens).toBe(2000);
    expect(exploratory.tokens).toBe(2000);

    // Assert the report object has no field containing "total" associated with waste
    const reportKeys = Object.keys(r);
    const wasteKeys = Object.keys(r.waste!);
    const allKeys = [...reportKeys, ...wasteKeys];
    for (const key of allKeys) {
      if (key.toLowerCase().includes('waste')) {
        expect(key.toLowerCase()).not.toContain('total');
      }
    }
    expect(JSON.stringify(r)).not.toContain('totalWaste');
  });

  it('omits CONTEXT WASTE section on empty transcripts', async () => {
    const home = await fakeHome();
    const r = await runAudit({ home, scanDirs: [] });
    expect(r.sessions).toBe(0);
    expect(r.waste === undefined || r.waste.classes.length === 0).toBe(true);

    const rendered = renderAudit(r, { colors: false, version: '1.0.0' });
    expect(rendered).not.toContain('CONTEXT WASTE');
  });

  it('includes verbatim disclaimer note string in --json output', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });
    const lines = [
      asst('m1', 'r1', USAGE, [readUse('t1', '/a.ts')]),
      res('t1', 800),
    ];
    await writeFile(join(proj, 's.jsonl'), lines.join('\n'));

    const r = await runAudit({ home, scanDirs: [] });
    const jsonStr = JSON.stringify(r);
    const expectedNote =
      'Class sizes are observations from your own transcripts, not savings estimates: a read that changed nothing may still be the read that told you not to change it. Classes overlap — an oversized read can also be exploratory; do not sum them.';
    expect(r.waste?.note).toBe(expectedNote);
    expect(jsonStr).toContain(expectedNote);

    const rendered = renderAudit(r, { colors: false, version: '1.0.0' });
    expect(rendered).toContain('classes overlap — an oversized read can also be exploratory; do not sum them');
  });
});

describe('audit --compare two-window comparison', () => {
  it('compares seeded fixture where window A has an oversized read and window B does not', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });

    // Window A: 2026-01-01 to 2026-01-10 with oversized read
    const lineA = JSON.stringify({
      timestamp: '2026-01-02T10:00:00.000Z',
      type: 'assistant', requestId: 'rA', message: {
        id: 'mA', model: 'claude-sonnet-4-5', usage: USAGE,
        content: [{ type: 'tool_use', id: 'tA', name: 'Read', input: { file_path: '/oversized.ts' } }],
      },
    });
    const resA = JSON.stringify({
      timestamp: '2026-01-02T10:00:01.000Z',
      type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tA', content: 'x'.repeat(8000) }] },
    });

    // Window B: 2026-01-10 to 2026-01-19 with small normal read
    const lineB = JSON.stringify({
      timestamp: '2026-01-12T10:00:00.000Z',
      type: 'assistant', requestId: 'rB', message: {
        id: 'mB', model: 'claude-sonnet-4-5', usage: USAGE,
        content: [{ type: 'tool_use', id: 'tB', name: 'Read', input: { file_path: '/small.ts', offset: 0, limit: 10 } }],
      },
    });
    const resB = JSON.stringify({
      timestamp: '2026-01-12T10:00:01.000Z',
      type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tB', content: 'x'.repeat(400) }] },
    });

    await writeFile(join(proj, 's.jsonl'), [lineA, resA, lineB, resB].join('\n'));

    const windowA = { since: new Date('2026-01-01T00:00:00Z'), until: new Date('2026-01-10T00:00:00Z') };
    const windowB = { since: new Date('2026-01-10T00:00:00Z'), until: new Date('2026-01-19T00:00:00Z') };

    const comp = await runAuditCompare({ home, scanDirs: [] }, windowA, windowB);

    expect(comp.windows).toEqual({
      a: { since: '2026-01-01T00:00:00.000Z', until: '2026-01-10T00:00:00.000Z', sessions: 1, tokens: expect.any(Number) },
      b: { since: '2026-01-10T00:00:00.000Z', until: '2026-01-19T00:00:00.000Z', sessions: 1, tokens: expect.any(Number) },
    });
    // total burn per window is a fact both in JSON and on screen
    expect(comp.windows.a.tokens).toBeGreaterThan(0);
    expect(comp.windows.b.tokens).toBeGreaterThan(0);

    const oversized = comp.classes.find((c) => c.id === 'oversized');
    expect(oversized).toBeDefined();
    expect(oversized!.a.tokens).toBeGreaterThan(0);
    expect(oversized!.a.calls).toBe(1);
    expect(oversized!.b.tokens).toBe(0);
    expect(oversized!.b.calls).toBe(0);
    expect(oversized!.deltaTokens).toBeLessThan(0);

    const jsonStr = JSON.stringify(comp);
    const expectedDisclaimer =
      'Two windows, not an experiment: workload differs between them, so a delta shows what changed, not what caused it. Classes overlap — an oversized read can also be exploratory; do not sum them.';
    expect(comp.note).toBe(expectedDisclaimer);
    expect(jsonStr).toContain(expectedDisclaimer);

    // Verify no "total*" field in compare
    for (const key of Object.keys(comp)) {
      expect(key.toLowerCase()).not.toContain('total');
    }
    expect(jsonStr).not.toContain('totalWaste');

    // Render verification
    const rendered = renderAudit({ compare: comp } as any, { colors: false, version: '1.0.0' });
    expect(rendered).toContain('CONTEXT WASTE — TWO WINDOWS');
    expect(rendered).not.toContain('CONTEXT WASTE\n');
    expect(rendered).toContain(expectedDisclaimer);
    expect(rendered).toContain('classes overlap — an oversized read can also be exploratory; do not sum them');
    expect(rendered).toMatch(/total burn: .+ tok → .+ tok\s+\(×\d+(\.\d+)?\)/);
  });

  it('handles empty rig + --compare with not enough data for both windows and no class rows', async () => {
    const home = await fakeHome();
    const windowA = { since: new Date('2026-01-01T00:00:00Z'), until: new Date('2026-01-10T00:00:00Z') };
    const windowB = { since: new Date('2026-01-10T00:00:00Z'), until: new Date('2026-01-19T00:00:00Z') };

    const comp = await runAuditCompare({ home, scanDirs: [] }, windowA, windowB);
    expect(comp.insufficient).toEqual(['a', 'b']);
    expect(comp.classes).toEqual([]);

    const rendered = renderAudit({ compare: comp } as any, { colors: false, version: '1.0.0' });
    expect(rendered).toContain('not enough data in window A (0 sessions)');
    expect(rendered).toContain('not enough data in window B (0 sessions)');
    // an empty pair of windows must not print a burn line (nothing to state)
    expect(rendered).not.toContain('total burn');
  });

  it('handles window A with data and window B empty with not-enough-data for B and no deltas printed', async () => {
    const home = await fakeHome();
    const proj = join(home, '.claude', 'projects', 'p');
    await mkdir(proj, { recursive: true });

    const lineA = JSON.stringify({
      timestamp: '2026-01-02T10:00:00.000Z',
      type: 'assistant', requestId: 'rA', message: { id: 'mA', model: 'claude-sonnet-4-5', usage: USAGE },
    });
    await writeFile(join(proj, 's.jsonl'), lineA);

    const windowA = { since: new Date('2026-01-01T00:00:00Z'), until: new Date('2026-01-10T00:00:00Z') };
    const windowB = { since: new Date('2026-01-10T00:00:00Z'), until: new Date('2026-01-19T00:00:00Z') };

    const comp = await runAuditCompare({ home, scanDirs: [] }, windowA, windowB);
    expect(comp.insufficient).toEqual(['b']);
    expect(comp.classes).toEqual([]);

    const rendered = renderAudit({ compare: comp } as any, { colors: false, version: '1.0.0' });
    expect(rendered).not.toContain('not enough data in window A');
    expect(rendered).toContain('not enough data in window B (0 sessions)');
  });

  it('emits a warning when window B extends into the future', async () => {
    const home = await fakeHome();
    const windowA = { since: new Date('2026-01-01T00:00:00Z'), until: new Date('2026-01-10T00:00:00Z') };
    // Future window B
    const futureUntil = new Date(Date.now() + 86400 * 1000 * 30);
    const windowB = { since: new Date('2026-01-10T00:00:00Z'), until: futureUntil };

    const comp = await runAuditCompare({ home, scanDirs: [] }, windowA, windowB);
    expect(comp.warnings).toBeDefined();
    const uB = futureUntil.toISOString().slice(0, 10);
    const expectedWarn = `window B extends past now (${uB}) — it cannot contain a full period yet`;
    expect(comp.warnings!.some((w) => w.includes(expectedWarn))).toBe(true);

    const rendered = renderAudit({ compare: comp } as any, { colors: false, version: '1.0.0' });
    expect(rendered).toContain(expectedWarn);
  });
});


