import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAuditJsonl, emptyAcc, discoverSurfaces, runAudit } from '../src/audit.js';

const asst = (id: string, req: string, usage: object, content?: unknown[]) =>
  JSON.stringify({ type: 'assistant', requestId: req, message: { id, model: 'claude-sonnet-4-5', usage, content } });

const USAGE = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000 };

describe('parseAuditJsonl', () => {
  it('dedups replayed usage records by message.id + requestId', () => {
    const acc = emptyAcc();
    const line = asst('m1', 'r1', USAGE);
    // the same record replayed three times — the real transcripts do this
    parseAuditJsonl([line, line, line].join('\n'), acc);
    expect(acc.tokens).toEqual({ input: 100, output: 50, cacheWrite: 200, cacheRead: 1000 });
  });

  it('counts distinct records separately', () => {
    const acc = emptyAcc();
    parseAuditJsonl([asst('m1', 'r1', USAGE), asst('m2', 'r2', USAGE)].join('\n'), acc);
    expect(acc.tokens.input).toBe(200);
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
    const result = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(400) }] },
    });
    parseAuditJsonl([use, use, result, result].join('\n'), acc); // both replayed
    const read = acc.tools.get('Read')!;
    expect(read.calls).toBe(1);          // not 2
    expect(read.resultTokens).toBe(100); // 400 chars / 4, counted once
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

  it('reports zero sessions on a rig with no transcripts', async () => {
    const r = await runAudit({ home: await fakeHome(), scanDirs: [] });
    expect(r.sessions).toBe(0);
    expect(r.dead).toEqual([]);
  });
});
