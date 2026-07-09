import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

interface GeminiTokens {
  input?: unknown; output?: unknown; cached?: unknown; thoughts?: unknown; tool?: unknown;
}
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function extractMessages(obj: unknown): unknown[] {
  const out: unknown[] = [];
  const push = (m: unknown) => { if (Array.isArray(m)) out.push(...m); else if (m && typeof m === 'object') out.push(m); };
  const o = obj as { messages?: unknown; $set?: { messages?: unknown }; $push?: { messages?: unknown } };
  push(o?.messages);
  push(o?.$set?.messages);
  push(o?.$push?.messages);
  return out;
}

/**
 * Parse one Gemini CLI session JSONL. Each line is a document-mutation log whose
 * `$set.messages` REPLAYS the full array, so we dedup by message `id` (via the
 * shared `seen` set — also dedups across files). Assistant messages carry
 * `tokens:{input,output,cached,thoughts,tool,total}` (mutually-exclusive buckets)
 * and a `model`. Mapping: input→input, output+thoughts+tool→output, cached→cacheRead.
 */
export function parseGeminiSession(content: string, seen: Set<string>): { tokens: TokenUsage; costUsd: number } {
  const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  for (const raw of content.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    for (const m of extractMessages(obj)) {
      const rec = m as { id?: unknown; model?: unknown; tokens?: GeminiTokens };
      if (!rec || typeof rec.id !== 'string' || !rec.tokens || typeof rec.tokens !== 'object') continue;
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      const t = rec.tokens;
      const u: TokenUsage = {
        input: num(t.input),
        output: num(t.output) + num(t.thoughts) + num(t.tool),
        cacheWrite: 0,
        cacheRead: num(t.cached),
      };
      tokens.input += u.input;
      tokens.output += u.output;
      tokens.cacheRead += u.cacheRead;
      costUsd += costForUsage(typeof rec.model === 'string' ? rec.model : 'gemini', u);
    }
  }
  return { tokens, costUsd };
}

function geminiDir(ctx: ScanContext): string {
  const env = ctx.env ?? process.env;
  return env.GEMINI_DATA_DIR ?? join(ctx.home, '.gemini');
}

// Antigravity is a Gemini CLI fork that reuses the ~/.gemini home (chats still
// land in tmp/*/chats). When its dir is present the usage belongs to Antigravity,
// so we attribute the collected sessions to it rather than a removed Gemini CLI.
async function ownerLabel(ctx: ScanContext): Promise<string> {
  for (const p of [join(geminiDir(ctx), 'antigravity-cli'), join(ctx.home, '.antigravity')]) {
    try { await stat(p); return 'Antigravity'; } catch { /* absent */ }
  }
  return 'Gemini CLI';
}

// Yield every *.jsonl under <geminiDir>/tmp/<project>/chats/** (recursive for
// nested subagent UUID dirs). Never touches <geminiDir>/antigravity-cli.
async function* sessionFiles(ctx: ScanContext): AsyncGenerator<string> {
  const tmp = join(geminiDir(ctx), 'tmp');
  let projects;
  try { projects = await readdir(tmp, { withFileTypes: true }); } catch { return; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    yield* walk(join(tmp, p.name, 'chats'));
  }
}
async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield full;
  }
}

export const geminiCollector: Collector = {
  id: 'gemini',
  async detect(ctx) {
    for await (const _f of sessionFiles(ctx)) return true;
    return false;
  },
  async collect(ctx) {
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let found = false;
    const seen = new Set<string>();
    for await (const file of sessionFiles(ctx)) {
      found = true;
      try {
        const r = parseGeminiSession(await readFile(file, 'utf8'), seen);
        tokens.input += r.tokens.input;
        tokens.output += r.tokens.output;
        tokens.cacheRead += r.tokens.cacheRead;
        costUsd += r.costUsd;
      } catch { /* unreadable file — skip */ }
    }
    if (!found) return {};
    return { tokens, costUsd, sources: ['gemini'], agents: [await ownerLabel(ctx)] };
  },
};
