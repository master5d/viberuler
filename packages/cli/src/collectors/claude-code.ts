import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

export function parseClaudeJsonl(
  content: string,
  seen: Set<string>,
  since?: Date,
): { tokens: TokenUsage; costUsd: number; skipped: number } {
  const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  let skipped = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      skipped++;
      continue;
    }
    const usage = obj?.message?.usage;
    if (obj?.type !== 'assistant' || !usage) continue;
    if (since && obj.timestamp && Date.parse(obj.timestamp) < since.getTime()) continue;

    const key = `${obj.message.id ?? 'nomsg'}:${obj.requestId ?? 'noreq'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const u: TokenUsage = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
    };
    tokens.input += u.input;
    tokens.output += u.output;
    tokens.cacheWrite += u.cacheWrite;
    tokens.cacheRead += u.cacheRead;
    const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    costUsd += costForUsage(obj.message.model ?? '', u, { cacheWrite1h });
  }
  return { tokens, costUsd, skipped };
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

function projectsDir(ctx: ScanContext): string {
  return join(ctx.home, '.claude', 'projects');
}

export const claudeCodeCollector: Collector = {
  id: 'claude-code',
  async detect(ctx) {
    try {
      return (await stat(projectsDir(ctx))).isDirectory();
    } catch {
      return false;
    }
  },
  async collect(ctx) {
    const seen = new Set<string>();
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let skipped = 0;

    for await (const file of walkJsonl(projectsDir(ctx))) {
      try {
        const r = parseClaudeJsonl(await readFile(file, 'utf8'), seen, ctx.since);
        tokens.input += r.tokens.input;
        tokens.output += r.tokens.output;
        tokens.cacheWrite += r.tokens.cacheWrite;
        tokens.cacheRead += r.tokens.cacheRead;
        costUsd += r.costUsd;
        skipped += r.skipped;
      } catch {
        skipped++;
      }
    }
    const warnings = skipped > 0 ? [`claude-code: skipped ${skipped} malformed line(s)`] : [];
    return { tokens, costUsd, sources: ['claude-code'], warnings };
  },
};
