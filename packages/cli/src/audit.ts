import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanContext, TokenUsage } from './types.js';
import { costForUsage } from './pricing.js';
import { attributeRootCauses, type RootCause, type WasteEvent } from './root-cause.js';
import { createTimeAccumulator, type TimeReport } from './time-collect.js';
import { resolveRoots } from './roots.js';
import { totalTokens } from './merge.js';
import type { MarketData } from './market.js';
import { PROJECTS, walkJsonl } from './collectors/claude-code.js';

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

export interface WasteClass {
  id: 'exploratory' | 'repeat-read' | 'oversized' | 'subagent-returned';
  label: string;   // human, lowercase, e.g. 'whole-file reads never edited'
  calls: number;
  tokens: number;
  lever: string;   // e.g. 'outline-first / symbol reads'
}

export interface WasteReport {
  classes: WasteClass[];
  note: string;
}

export interface WasteCompareWindow {
  since: string;
  until: string;
  sessions: number;
  /** Total tokens burned in the window (all four buckets) — a fact, not a verdict. */
  tokens: number;
}

export interface WasteCompareClass {
  id: string;
  label: string;
  a: { calls: number; tokens: number };
  b: { calls: number; tokens: number };
  deltaTokens: number;
}

export interface WasteCompare {
  windows: { a: WasteCompareWindow; b: WasteCompareWindow };
  classes: WasteCompareClass[];
  note: string;
  warnings?: string[];
  insufficient?: ('a' | 'b')[];
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
  /**
   * Present only under `--market` (an explicit opt-in network call): current
   * market rates for repricing this report's token mix. The rendering states
   * the caveats — same token counts, different tokenizers, arithmetic only.
   */
  market?: MarketData;
  /** Configured + enabled MCP surfaces with zero tool calls — pure overhead. */
  dead: McpSurface[];
  warnings: string[];
  time?: TimeReport;
  waste?: WasteReport;
  compare?: WasteCompare;
  /** Populated only under `--why`: ranked structural root-cause attribution. */
  rootCauses?: RootCause[];
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
export function parseAuditJsonl(content: string, acc: Acc, since?: Date, until?: Date): boolean {
  // Per-transcript state. Cold context and read discipline are session-scoped:
  // a file re-read in a *different* session is a fresh, legitimate read.
  let firstTs = '';
  let firstTokens = 0;
  let firstIsSide = false;
  const reads: { path: string; tokens: number; sliced: boolean }[] = [];
  const readSizes = new Map<string, number[]>();
  const edited = new Set<string>();
  const wasteStart = acc.wasteEvents.length;
  let matched = false;

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
    matched = true;

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
  return matched;
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

export async function runAudit(ctx: ScanContext, gapMs: number = 3 * 60 * 1000): Promise<AuditReport> {
  const acc = emptyAcc();
  const timeAcc = createTimeAccumulator(gapMs);
  const sinceMs = ctx.since?.getTime();
  const untilMs = ctx.until?.getTime();
  let sessions = 0;
  let timeFailures = 0;

  const hasWindowFilter = Boolean(ctx.since || ctx.until);
  const roots = await resolveRoots(ctx, PROJECTS);
  for (const root of roots) {
    for await (const file of walkJsonl(root)) {
      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch {
        acc.skipped++;
        if (!hasWindowFilter) sessions++;
        continue;
      }

      let matched = false;
      try {
        matched = parseAuditJsonl(content, acc, ctx.since, ctx.until);
      } catch {
        acc.skipped++;
      }

      if (!hasWindowFilter || matched) {
        sessions++;
      }

      try {
        timeAcc.addFile(content, sinceMs, untilMs);
      } catch {
        timeFailures++;
      }
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
  if (timeFailures > 0) {
    warnings.push(`audit: time accumulation failed for ${timeFailures} file(s)`);
  }

  const time = timeAcc.report();

  const report: AuditReport = {
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
    ...(time ? { time } : {}),
  };

  try {
    const classes: WasteClass[] = [];
    if (acc.ghosts.exploratoryCalls > 0) {
      classes.push({
        id: 'exploratory',
        label: 'whole-file reads never edited',
        calls: acc.ghosts.exploratoryCalls,
        tokens: acc.ghosts.exploratoryTokens,
        lever: 'outline-first / symbol reads',
      });
    }
    if (acc.ghosts.repeatReadCalls > 0) {
      classes.push({
        id: 'repeat-read',
        label: 'repeat reads of unchanged files',
        calls: acc.ghosts.repeatReadCalls,
        tokens: acc.ghosts.repeatReadTokens,
        lever: 'cache/dedup of tool output',
      });
    }
    if (acc.ghosts.oversizedCalls > 0) {
      classes.push({
        id: 'oversized',
        label: 'oversized single results',
        calls: acc.ghosts.oversizedCalls,
        tokens: acc.ghosts.oversizedTokens,
        lever: 'slicing, head/grep before read',
      });
    }
    if (acc.agentCalls > 0) {
      classes.push({
        id: 'subagent-returned',
        label: 'subagent-returned tokens',
        calls: acc.agentCalls,
        tokens: acc.agentReturned,
        lever: 'tighter subagent contracts',
      });
    }
    classes.sort((a, b) => b.tokens - a.tokens);
    report.waste = {
      classes,
      note: 'Class sizes are observations from your own transcripts, not savings estimates: a read that changed nothing may still be the read that told you not to change it. Classes overlap — an oversized read can also be exploratory; do not sum them.',
    };
  } catch {
    // Fail-open: omit waste on error
  }

  if (ctx.why) {
    const totalInput = tokens.input + tokens.cacheWrite + tokens.cacheRead;
    const rate = totalInput > 0 ? acc.costUsd / totalInput : 0; // session's own $/token
    report.rootCauses = attributeRootCauses(acc.wasteEvents, (t) => t * rate);
  }

  return report;
}

export async function runAuditCompare(
  ctx: ScanContext,
  windowA: { since: Date; until: Date },
  windowB: { since: Date; until: Date },
  gapMs?: number,
): Promise<WasteCompare> {
  const ctxA: ScanContext = { ...ctx, since: windowA.since, until: windowA.until };
  const ctxB: ScanContext = { ...ctx, since: windowB.since, until: windowB.until };

  const [reportA, reportB] = await Promise.all([
    runAudit(ctxA, gapMs),
    runAudit(ctxB, gapMs),
  ]);

  const warnings = [...new Set([...reportA.warnings, ...reportB.warnings])];

  const nowMs = Date.now();
  if (windowB.until.getTime() > nowMs) {
    const uB = windowB.until.toISOString().slice(0, 10);
    warnings.push(`window B extends past now (${uB}) — it cannot contain a full period yet`);
  }

  const insufficient: ('a' | 'b')[] = [];
  if (reportA.sessions === 0) insufficient.push('a');
  if (reportB.sessions === 0) insufficient.push('b');

  const compareClasses: WasteCompareClass[] = [];

  if (insufficient.length === 0) {
    const classesA = reportA.waste?.classes ?? [];
    const classesB = reportB.waste?.classes ?? [];

    const mapA = new Map(classesA.map((c) => [c.id, c]));
    const mapB = new Map(classesB.map((c) => [c.id, c]));

    const allIds = new Set([...mapA.keys(), ...mapB.keys()]);

    const LABEL_LEVER: Record<string, { label: string; lever: string }> = {
      exploratory: { label: 'whole-file reads never edited', lever: 'outline-first / symbol reads' },
      'repeat-read': { label: 'repeat reads of unchanged files', lever: 'cache/dedup of tool output' },
      oversized: { label: 'oversized single results', lever: 'slicing, head/grep before read' },
      'subagent-returned': { label: 'subagent-returned tokens', lever: 'tighter subagent contracts' },
    };

    for (const id of allIds) {
      const ca = mapA.get(id);
      const cb = mapB.get(id);
      const label = ca?.label ?? cb?.label ?? LABEL_LEVER[id]?.label ?? id;
      const aStats = { calls: ca?.calls ?? 0, tokens: ca?.tokens ?? 0 };
      const bStats = { calls: cb?.calls ?? 0, tokens: cb?.tokens ?? 0 };
      const deltaTokens = bStats.tokens - aStats.tokens;
      compareClasses.push({
        id,
        label,
        a: aStats,
        b: bStats,
        deltaTokens,
      });
    }

    compareClasses.sort(
      (x, y) => Math.max(y.a.tokens, y.b.tokens) - Math.max(x.a.tokens, x.b.tokens) || x.id.localeCompare(y.id),
    );
  }

  const compare: WasteCompare = {
    windows: {
      a: { since: windowA.since.toISOString(), until: windowA.until.toISOString(), sessions: reportA.sessions, tokens: totalTokens(reportA.tokens) },
      b: { since: windowB.since.toISOString(), until: windowB.until.toISOString(), sessions: reportB.sessions, tokens: totalTokens(reportB.tokens) },
    },
    classes: compareClasses,
    note: 'Two windows, not an experiment: workload differs between them, so a delta shows what changed, not what caused it. Classes overlap — an oversized read can also be exploratory; do not sum them.',
    warnings,
    ...(insufficient.length > 0 ? { insufficient } : {}),
  };

  return compare;
}


