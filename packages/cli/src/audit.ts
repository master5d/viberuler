import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanContext, TokenUsage } from './types.js';
import { costForUsage } from './pricing.js';
import type { WasteEvent } from './root-cause.js';

// Tool results are raw text; 4 chars/token is the standard rough conversion.
const CHARS_PER_TOKEN = 4;

export interface ToolStat {
  name: string;
  calls: number;
  resultTokens: number;
}

export interface McpSurface {
  name: string;
  /** Tool-name prefix this surface's tools carry. */
  prefix: string;
  kind: 'server' | 'plugin';
}

/** One conversation chain: the main thread, or the pooled subagent threads. */
export interface ChainStats {
  msgs: number;
  tokens: TokenUsage;
  /** input + cacheWrite + cacheRead — what the model was actually re-fed. */
  inputSideTokens: number;
  /** Tokens of tool output admitted into this chain's contexts. */
  admittedTokens: number;
  /** How many times the average admitted token gets re-read here. */
  amplification: number;
}

/**
 * What a session costs before you type a word: system prompt, tool names,
 * agent/skill descriptions, CLAUDE.md, memory. Measured as the first assistant
 * turn's total input (input + cacheWrite + cacheRead) — there is nothing else in
 * the context at that point.
 *
 * It is re-paid on every session AND on every subagent spawn, so it is the one
 * cost that scales with how you work rather than what you work on.
 */
export interface ColdContext {
  /** Transcripts with a usable first turn. */
  sessions: number;
  medianTokens: number;
  p75Tokens: number;
}

/**
 * Tokens that entered the main context and arguably did not need to.
 *
 * These are the three things a PostToolUse-rewriting plugin claims to fix. We
 * measure them so the claim can be checked against a real corpus instead of a
 * README: on a disciplined rig the famous "dedupe repeat reads" trick is worth
 * almost nothing, while oversized results are worth a great deal.
 */
export interface GhostStats {
  /** Same path Read again with an identical result size — almost certainly unchanged. */
  repeatReadCalls: number;
  repeatReadTokens: number;
  /** Any single tool result over 4 KB — the archive-to-disk / skeleton candidates. */
  oversizedCalls: number;
  oversizedTokens: number;
  readCalls: number;
  readTokens: number;
  /** Reads that passed offset/limit — the disciplined ones. */
  slicedCalls: number;
  /**
   * Whole-file Reads of a path that was never subsequently edited. Not proof of
   * waste — you often read to decide NOT to change something — but this is the
   * pool an outline-first policy could actually shrink.
   */
  exploratoryCalls: number;
  exploratoryTokens: number;
}

export interface SubagentStats {
  /** Distinct subagents that ran. */
  agents: number;
  /** Agent tool calls made from the main thread. */
  calls: number;
  /** Tokens the Agent results handed back into the parent context. */
  returnedTokens: number;
  /** Tokens the subagents pulled in that never touched the parent context. */
  keptOutTokens: number;
  /** admitted-inside ÷ returned — how hard a subagent compresses its work. */
  compression: number;
  /** Subagents are not free: their share of total input-side spend. */
  shareOfSpendPct: number;
}

export interface AuditReport {
  sessions: number;
  tokens: TokenUsage;
  /** Actual API-equivalent cost, priced per message model. */
  costUsd: number;
  /** Counterfactual: every cached token billed as fresh input (i.e. no caching). */
  costNoCacheUsd: number;
  cacheHitPct: number;
  /**
   * Main thread vs subagents, kept apart on purpose. Pooling them dilutes the
   * amplification that actually matters: short-lived subagent contexts drag the
   * average down and understate what a token costs in the main thread.
   */
  main: ChainStats;
  sub: ChainStats;
  subagents: SubagentStats;
  /** Fixed per-session overhead, main threads and subagent spawns kept apart. */
  coldMain: ColdContext;
  coldSub: ColdContext;
  ghosts: GhostStats;
  tools: ToolStat[];
  surfaces: McpSurface[];
  /** Configured + enabled MCP surfaces with zero tool calls — pure overhead. */
  dead: McpSurface[];
  warnings: string[];
}

interface ChainAcc {
  msgs: number;
  tokens: TokenUsage;
  admitted: number;
}

interface Acc {
  seenMsg: Set<string>;
  seenToolUse: Set<string>;
  seenToolResult: Set<string>;
  idToTool: Map<string, string>;
  /** Read tool_use id -> what it asked for, so the result can be classified. */
  idToRead: Map<string, { path: string; sliced: boolean }>;
  main: ChainAcc;
  side: ChainAcc;
  agentIds: Set<string>;
  agentCalls: number;
  agentReturned: number;
  costUsd: number;
  costNoCacheUsd: number;
  tools: Map<string, ToolStat>;
  /** First-turn input tokens, one entry per transcript. */
  coldMain: number[];
  coldSub: number[];
  ghosts: GhostStats;
  wasteEvents: WasteEvent[];
  skipped: number;
}

/** Results bigger than this are what an output-rewriting hook would target. */
const OVERSIZED_CHARS = 4096;

const emptyGhosts = (): GhostStats => ({
  repeatReadCalls: 0,
  repeatReadTokens: 0,
  oversizedCalls: 0,
  oversizedTokens: 0,
  readCalls: 0,
  readTokens: 0,
  slicedCalls: 0,
  exploratoryCalls: 0,
  exploratoryTokens: 0,
});

const emptyChain = (): ChainAcc => ({
  msgs: 0,
  tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  admitted: 0,
});

export function emptyAcc(): Acc {
  return {
    seenMsg: new Set(),
    seenToolUse: new Set(),
    seenToolResult: new Set(),
    idToTool: new Map(),
    idToRead: new Map(),
    main: emptyChain(),
    side: emptyChain(),
    agentIds: new Set(),
    agentCalls: 0,
    agentReturned: 0,
    costUsd: 0,
    costNoCacheUsd: 0,
    tools: new Map(),
    coldMain: [],
    coldSub: [],
    ghosts: emptyGhosts(),
    wasteEvents: [],
    skipped: 0,
  };
}

function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[i]!;
}

const coldOf = (xs: number[]): ColdContext => ({
  sessions: xs.length,
  medianTokens: Math.round(percentile(xs, 0.5)),
  p75Tokens: Math.round(percentile(xs, 0.75)),
});

function bump(acc: Acc, name: string): ToolStat {
  let s = acc.tools.get(name);
  if (!s) {
    s = { name, calls: 0, resultTokens: 0 };
    acc.tools.set(name, s);
  }
  return s;
}

/**
 * Accumulate one transcript file. Deduplication is essential: Claude Code
 * replays entries, and on a real corpus >50% of usage records are duplicates —
 * counting them naively doubles every number. Keys mirror the claude-code
 * collector (message.id + requestId); tool blocks dedup by their own ids.
 *
 * Subagent turns carry `isSidechain: true` and an `agentId`, which is what lets
 * us keep the main thread and the isolated subagent threads apart.
 */
export function parseAuditJsonl(content: string, acc: Acc, since?: Date, until?: Date): void {
  // Per-transcript state. Cold context and read discipline are session-scoped:
  // a file re-read in a *different* session is a fresh, legitimate read.
  let firstTs = '';
  let firstTokens = 0;
  let firstIsSide = false;
  const reads: { path: string; tokens: number; sliced: boolean }[] = [];
  const readSizes = new Map<string, number[]>();
  const edited = new Set<string>();
  const wasteStart = acc.wasteEvents.length;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      acc.skipped++;
      continue;
    }
    if (since && obj.timestamp && Date.parse(obj.timestamp) < since.getTime()) continue;
    if (until && obj.timestamp && Date.parse(obj.timestamp) >= until.getTime()) continue;

    const isSide = obj.isSidechain === true;
    const chain = isSide ? acc.side : acc.main;
    if (typeof obj.agentId === 'string' && obj.agentId) acc.agentIds.add(obj.agentId);

    const msg = obj?.message;
    const usage = msg?.usage;
    if (usage && obj?.type === 'assistant') {
      const key = `${msg.id ?? 'nomsg'}:${obj.requestId ?? 'noreq'}`;
      if (!acc.seenMsg.has(key)) {
        acc.seenMsg.add(key);
        const u: TokenUsage = {
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          cacheWrite: usage.cache_creation_input_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
        };
        chain.msgs++;
        chain.tokens.input += u.input;
        chain.tokens.output += u.output;
        chain.tokens.cacheWrite += u.cacheWrite;
        chain.tokens.cacheRead += u.cacheRead;
        // The earliest assistant turn carries the whole cold context and nothing
        // else: no work has happened yet, so its input IS the fixed overhead.
        const inputSide = u.input + u.cacheWrite + u.cacheRead;
        const ts = typeof obj.timestamp === 'string' ? obj.timestamp : '';
        // Prefer the earliest timestamp; fall back to file order when a
        // transcript carries none, rather than reporting no cold context at all.
        const earlier = firstTokens === 0 || (ts !== '' && firstTs !== '' && ts < firstTs);
        if (inputSide > 0 && earlier) {
          firstTs = ts;
          firstTokens = inputSide;
          firstIsSide = isSide;
        }
        const model = msg.model ?? '';
        const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        acc.costUsd += costForUsage(model, u, { cacheWrite1h });
        // Same price table, but every cached token re-priced as fresh input.
        acc.costNoCacheUsd += costForUsage(
          model,
          { input: u.input + u.cacheWrite + u.cacheRead, output: u.output, cacheWrite: 0, cacheRead: 0 },
          {},
        );
      }
    }

    const content_ = msg?.content;
    if (!Array.isArray(content_)) continue;
    for (const b of content_) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        const id = String(b.id ?? '');
        const name = String(b.name ?? '?');
        if (id) acc.idToTool.set(id, name);
        if (id && acc.seenToolUse.has(id)) continue;
        if (id) acc.seenToolUse.add(id);
        bump(acc, name).calls++;
        if (name === 'Agent' && !isSide) acc.agentCalls++;
        if (!isSide) {
          const path = typeof b.input?.file_path === 'string' ? b.input.file_path : '';
          if (name === 'Read' && path && id) {
            acc.idToRead.set(id, {
              path,
              sliced: b.input.offset !== undefined || b.input.limit !== undefined,
            });
          } else if (path && (name === 'Edit' || name === 'Write' || name === 'NotebookEdit')) {
            edited.add(path);
          }
        }
      } else if (b.type === 'tool_result') {
        const tid = String(b.tool_use_id ?? '');
        if (!tid || acc.seenToolResult.has(tid)) continue;
        acc.seenToolResult.add(tid);
        const name = acc.idToTool.get(tid);
        if (!name) continue;
        let chars = 0;
        const c = b.content;
        if (typeof c === 'string') chars = c.length;
        else if (Array.isArray(c)) {
          for (const cb of c) if (cb && typeof cb.text === 'string') chars += cb.text.length;
        }
        const tok = Math.round(chars / CHARS_PER_TOKEN);
        bump(acc, name).resultTokens += tok;
        chain.admitted += tok;

        if (!isSide) {
          const g = acc.ghosts;
          if (chars > OVERSIZED_CHARS) {
            g.oversizedCalls++;
            g.oversizedTokens += tok;
          }
          const read = acc.idToRead.get(tid);
          if (read) {
            g.readCalls++;
            g.readTokens += tok;
            let isRepeat = false;
            if (read.sliced) {
              g.slicedCalls++;
            } else {
              reads.push({ path: read.path, tokens: tok, sliced: false });
            }
            // Identical size at the same path within one session: the file did
            // not change, so the second read bought nothing.
            let prior = readSizes.get(read.path);
            if (!prior) {
              prior = [];
              readSizes.set(read.path, prior);
            }
            if (prior.includes(tok)) {
              g.repeatReadCalls++;
              g.repeatReadTokens += tok;
              isRepeat = true;
            }
            prior.push(tok);
            acc.wasteEvents.push({
              path: read.path, tokens: tok, kind: 'read',
              oversized: chars > OVERSIZED_CHARS, sliced: read.sliced,
              repeat: isRepeat, exploratory: false, // exploratory resolved post-loop
            });
          }
        }
        // An Agent result is the ONLY part of a subagent's work that lands in
        // the parent context — the compression denominator.
        if (name === 'Agent' && !isSide) {
          acc.agentReturned += tok;
          acc.wasteEvents.push({
            path: '', tokens: tok, kind: 'agent',
            oversized: false, sliced: false, repeat: false, exploratory: false,
          });
        }
      }
    }
  }

  // Classify only once the whole transcript is known: a read is load-bearing if
  // that path is edited ANYWHERE in the session, including long after the read.
  for (const r of reads) {
    if (edited.has(r.path)) continue;
    acc.ghosts.exploratoryCalls++;
    acc.ghosts.exploratoryTokens += r.tokens;
  }
  // Mark exploratory on the emitted events: a whole-file (non-sliced) read of a
  // path this session never edited. Resolved here because `edited` is only
  // complete once the whole transcript is parsed. Only events pushed during
  // THIS call (from wasteStart onward) are considered.
  for (let i = wasteStart; i < acc.wasteEvents.length; i++) {
    const e = acc.wasteEvents[i]!;
    if (e.kind === 'read' && !e.sliced && e.path && !edited.has(e.path)) {
      e.exploratory = true;
    }
  }
  if (firstTokens > 0) {
    (firstIsSide ? acc.coldSub : acc.coldMain).push(firstTokens);
  }
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

const exists = async (p: string): Promise<boolean> => stat(p).then(() => true, () => false);

/**
 * MCP surfaces that are configured AND enabled — i.e. that actually spawn a
 * server process and inject tool schemas on every session.
 *
 * Plugins are only counted when they ship an MCP server (a `.mcp.json` in the
 * plugin's cache dir). Skill-only plugins (e.g. superpowers) legitimately make
 * zero tool calls and must never be reported as dead weight.
 */
export async function discoverSurfaces(home: string): Promise<McpSurface[]> {
  const out: McpSurface[] = [];

  // 1. User-scope MCP servers: ~/.claude.json -> mcpServers
  try {
    const raw = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8'));
    for (const name of Object.keys(raw?.mcpServers ?? {})) {
      out.push({ name, prefix: `mcp__${name}__`, kind: 'server' });
    }
  } catch { /* no user config — fine */ }

  // 2. Enabled plugins that ship an MCP server
  let enabled: Record<string, unknown> = {};
  try {
    const s = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
    enabled = s?.enabledPlugins ?? {};
  } catch { /* no settings — fine */ }

  const cache = join(home, '.claude', 'plugins', 'cache');
  for (const [key, on] of Object.entries(enabled)) {
    if (on !== true) continue; // disabled plugins don't load — not overhead
    const short = key.split('@')[0]!;
    const market = key.split('@')[1];
    if (!market) continue;
    const pluginDir = join(cache, market, short);
    let versions: string[] = [];
    try {
      versions = (await readdir(pluginDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    let hasMcp = false;
    for (const v of versions) {
      if (await exists(join(pluginDir, v, '.mcp.json'))) { hasMcp = true; break; }
    }
    if (hasMcp) out.push({ name: short, prefix: `mcp__plugin_${short}_`, kind: 'plugin' });
  }

  return out;
}

function finishChain(a: ChainAcc): ChainStats {
  const inputSideTokens = a.tokens.input + a.tokens.cacheWrite + a.tokens.cacheRead;
  return {
    msgs: a.msgs,
    tokens: a.tokens,
    inputSideTokens,
    admittedTokens: a.admitted,
    amplification: a.admitted > 0 ? inputSideTokens / a.admitted : 0,
  };
}

export async function runAudit(ctx: ScanContext): Promise<AuditReport> {
  const acc = emptyAcc();
  let sessions = 0;
  const dir = join(ctx.home, '.claude', 'projects');
  for await (const file of walkJsonl(dir)) {
    sessions++;
    try {
      parseAuditJsonl(await readFile(file, 'utf8'), acc, ctx.since, ctx.until);
    } catch {
      acc.skipped++;
    }
  }

  const surfaces = await discoverSurfaces(ctx.home);
  const tools = [...acc.tools.values()].sort((a, b) => b.calls - a.calls);
  const called = new Set(tools.filter((t) => t.calls > 0).map((t) => t.name));
  const dead = surfaces.filter((s) => ![...called].some((n) => n.startsWith(s.prefix)));

  const main = finishChain(acc.main);
  const sub = finishChain(acc.side);
  const totalInputSide = main.inputSideTokens + sub.inputSideTokens;
  const keptOut = Math.max(0, sub.admittedTokens - acc.agentReturned);

  const tokens: TokenUsage = {
    input: acc.main.tokens.input + acc.side.tokens.input,
    output: acc.main.tokens.output + acc.side.tokens.output,
    cacheWrite: acc.main.tokens.cacheWrite + acc.side.tokens.cacheWrite,
    cacheRead: acc.main.tokens.cacheRead + acc.side.tokens.cacheRead,
  };
  const warnings = acc.skipped > 0 ? [`audit: skipped ${acc.skipped} malformed line(s)`] : [];

  return {
    sessions,
    tokens,
    costUsd: acc.costUsd,
    costNoCacheUsd: acc.costNoCacheUsd,
    cacheHitPct: totalInputSide > 0 ? (100 * tokens.cacheRead) / totalInputSide : 0,
    main,
    sub,
    subagents: {
      agents: acc.agentIds.size,
      calls: acc.agentCalls,
      returnedTokens: acc.agentReturned,
      keptOutTokens: keptOut,
      compression: acc.agentReturned > 0 ? sub.admittedTokens / acc.agentReturned : 0,
      shareOfSpendPct: totalInputSide > 0 ? (100 * sub.inputSideTokens) / totalInputSide : 0,
    },
    coldMain: coldOf(acc.coldMain),
    coldSub: coldOf(acc.coldSub),
    ghosts: acc.ghosts,
    tools,
    surfaces,
    dead,
    warnings,
  };
}
