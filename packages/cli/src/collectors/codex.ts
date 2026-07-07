import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

export function parseCodexJsonl(content: string): TokenUsage | null {
  let last: TokenUsage | null = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      const total = obj?.payload?.info?.total_token_usage;
      if (obj?.payload?.type === 'token_count' && total) {
        last = {
          input: total.input_tokens ?? 0,
          output: total.output_tokens ?? 0,
          cacheWrite: 0,
          cacheRead: total.cached_input_tokens ?? 0,
        };
      }
    } catch {
      /* malformed line — skip */
    }
  }
  return last;
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

function sessionsDir(ctx: ScanContext): string {
  return join(ctx.home, '.codex', 'sessions');
}

export const codexCollector: Collector = {
  id: 'codex',
  async detect(ctx) {
    try {
      return (await stat(sessionsDir(ctx))).isDirectory();
    } catch {
      return false;
    }
  },
  async collect(ctx) {
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    for await (const file of walkJsonl(sessionsDir(ctx))) {
      try {
        const u = parseCodexJsonl(await readFile(file, 'utf8'));
        if (!u) continue;
        tokens.input += u.input;
        tokens.output += u.output;
        tokens.cacheRead += u.cacheRead;
      } catch {
        /* unreadable file — skip */
      }
    }
    return { tokens, costUsd: costForUsage('codex-default', tokens), sources: ['codex'] };
  },
};
