import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanContext, TokenUsage } from './types.js';
import { costForUsage } from './pricing.js';

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

export interface AuditReport {
  sessions: number;
  tokens: TokenUsage;
  /** Actual API-equivalent cost, priced per message model. */
  costUsd: number;
  /** Counterfactual: every cached token billed as fresh input (i.e. no caching). */
  costNoCacheUsd: number;
  cacheHitPct: number;
  /** Tokens of tool output admitted into context (the controllable inflow). */
  admittedTokens: number;
  /** input + cacheWrite + cacheRead — what the model was actually re-fed. */
  inputSideTokens: number;
  /** How many times the average admitted token gets re-read. */
  amplification: number;
  tools: ToolStat[];
  surfaces: McpSurface[];
  /** Configured + enabled MCP surfaces with zero tool calls — pure overhead. */
  dead: McpSurface[];
  warnings: string[];
}

interface Acc {
  seenMsg: Set<string>;
  seenToolUse: Set<string>;
  seenToolResult: Set<string>;
  idToTool: Map<string, string>;
  tokens: TokenUsage;
  costUsd: number;
  costNoCacheUsd: number;
  tools: Map<string, ToolStat>;
  skipped: number;
}

export function emptyAcc(): Acc {
  return {
    seenMsg: new Set(),
    seenToolUse: new Set(),
    seenToolResult: new Set(),
    idToTool: new Map(),
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    costUsd: 0,
    costNoCacheUsd: 0,
    tools: new Map(),
    skipped: 0,
  };
}

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
 */
export function parseAuditJsonl(content: string, acc: Acc, since?: Date, until?: Date): void {
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
        acc.tokens.input += u.input;
        acc.tokens.output += u.output;
        acc.tokens.cacheWrite += u.cacheWrite;
        acc.tokens.cacheRead += u.cacheRead;
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
        if (id) acc.idToTool.set(id, String(b.name ?? '?'));
        if (id && acc.seenToolUse.has(id)) continue;
        if (id) acc.seenToolUse.add(id);
        bump(acc, String(b.name ?? '?')).calls++;
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
        bump(acc, name).resultTokens += Math.round(chars / CHARS_PER_TOKEN);
      }
    }
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

  const t = acc.tokens;
  const inputSideTokens = t.input + t.cacheWrite + t.cacheRead;
  const admittedTokens = tools.reduce((s, x) => s + x.resultTokens, 0);
  const warnings = acc.skipped > 0 ? [`audit: skipped ${acc.skipped} malformed line(s)`] : [];

  return {
    sessions,
    tokens: t,
    costUsd: acc.costUsd,
    costNoCacheUsd: acc.costNoCacheUsd,
    cacheHitPct: inputSideTokens > 0 ? (100 * t.cacheRead) / inputSideTokens : 0,
    admittedTokens,
    inputSideTokens,
    amplification: admittedTokens > 0 ? inputSideTokens / admittedTokens : 0,
    tools,
    surfaces,
    dead,
    warnings,
  };
}
