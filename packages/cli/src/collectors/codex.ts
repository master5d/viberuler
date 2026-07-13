import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';
import { resolveRoots, type RootSpec } from '../roots.js';

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

// CODEX_HOME points at the .codex dir itself, so its sub-path is just 'sessions'.
const SESSIONS: RootSpec = {
  under: ['.codex', 'sessions'],
  env: 'CODEX_HOME',
  envUnder: ['sessions'],
};

export const codexCollector: Collector = {
  id: 'codex',
  async detect(ctx) {
    return (await resolveRoots(ctx, SESSIONS)).length > 0;
  },
  async collect(ctx) {
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    // Roots are deduped upstream, so the same session file cannot be walked twice.
    for (const root of await resolveRoots(ctx, SESSIONS)) {
      for await (const file of walkJsonl(root)) {
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
    }
    return { tokens, costUsd: costForUsage('codex-default', tokens), sources: ['codex'] };
  },
};
