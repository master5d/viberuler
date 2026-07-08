import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

/**
 * Token count object from a Gemini CLI session JSONL line.
 * All fields are optional; only fields present are counted.
 */
export interface GeminiTokenCount {
  /** Input (prompt) tokens */
  input?: number;
  /** Output (response) tokens, excluding thinking */
  output?: number;
  /** Tokens read from cache */
  cached?: number;
  /** Thinking tokens — billed as output */
  thoughts?: number;
  /** Tool/function-call tokens */
  tool?: number;
  /** Total tokens (input + output + thoughts + tool) */
  total?: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Parse one line of a Gemini CLI session JSONL file.
 * Extracts tokenCount and, if available, model info for pricing.
 * Returns null if the line has no usable token data.
 */
export function parseGeminiLine(
  line: string,
): { tokens: TokenUsage; costUsd: number; model: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;

  const tc: GeminiTokenCount = obj.tokenCount ?? {};
  const hasData =
    tc.input !== undefined ||
    tc.output !== undefined ||
    tc.cached !== undefined ||
    tc.thoughts !== undefined ||
    tc.tool !== undefined ||
    tc.total !== undefined;

  if (!hasData) return null;

  // Map Gemini token fields → canonical TokenUsage (VibeRuler schema)
  const tokens: TokenUsage = {
    input: num(tc.input),
    output: num(tc.output) + num(tc.thoughts), // thoughts bill as output
    cacheWrite: 0, // Gemini doesn't expose cache writes in tokenCount
    cacheRead: num(tc.cached),
  };

  // Determine model for pricing — fall back to Gemini's default model
  const model: string =
    (typeof obj.model === 'string' && obj.model) ||
    (typeof obj.modelId === 'string' && obj.modelId) ||
    'gemini-2.0-flash';

  const costUsd = costForUsage(model, tokens);
  return { tokens, costUsd, model };
}

/**
 * Recursively walk a directory tree for .jsonl files inside a `chats/`
 * directory. The Gemini CLI layout is:
 *   <data-dir>/tmp/<project>/chats/session-<uuid>.jsonl
 * Subagent sessions nest under UUID-named subdirs that also have
 * a `chats/` subdirectory, so we walk one level per project.
 */
async function* walkChatsJsonl(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.name.endsWith('.jsonl') && e.isFile()) {
      yield p;
    } else if (e.isDirectory()) {
      // Subagent UUID dirs — they may themselves contain a chats/ dir
      yield* walkChatsJsonl(p);
    }
  }
}

/**
 * Get the Gemini data directory.
 * Respects VIBERULER_GEMINI_DATA_DIR env override (test seam + power users).
 */
function dataDir(ctx: ScanContext): string {
  const env = ctx.env ?? process.env;
  return env.VIBERULER_GEMINI_DATA_DIR ?? join(ctx.home, '.gemini');
}

export const geminiCollector: Collector = {
  id: 'gemini-cli',
  async detect(ctx) {
    try {
      const d = dataDir(ctx);
      // Check if tmp/ exists and has at least one project subdir
      const entries = await readdir(join(d, 'tmp'));
      for (const e of entries) {
        const chatsDir = join(d, 'tmp', e, 'chats');
        try {
          const chatEntries = await readdir(chatsDir);
          if (chatEntries.some((f) => f.endsWith('.jsonl'))) return true;
        } catch {
          continue;
        }
      }
      return false;
    } catch {
      return false;
    }
  },
  async collect(ctx) {
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let skipped = 0;
    let fileCount = 0;
    const models = new Set<string>();
    const projects = new Set<string>();

    const d = dataDir(ctx);
    const tmpDir = join(d, 'tmp');

    let projectEntries: string[];
    try {
      projectEntries = await readdir(tmpDir);
    } catch {
      return {}; // no Gemini data
    }

    for (const project of projectEntries) {
      const chatsDir = join(tmpDir, project, 'chats');
      try {
        await stat(chatsDir);
      } catch {
        continue; // no chats dir for this project
      }
      projects.add(project);

      for await (const file of walkChatsJsonl(chatsDir)) {
        fileCount++;
        let content: string;
        try {
          content = await readFile(file, 'utf8');
        } catch {
          skipped++;
          continue;
        }

        for (const line of content.split('\n')) {
          const r = parseGeminiLine(line);
          if (!r) continue;

          tokens.input += r.tokens.input;
          tokens.output += r.tokens.output;
          tokens.cacheWrite += r.tokens.cacheWrite;
          tokens.cacheRead += r.tokens.cacheRead;
          costUsd += r.costUsd;
          if (r.model) models.add(r.model);
        }
      }
    }

    if (fileCount === 0) return {};

    const warnings: string[] = [];
    if (skipped > 0) warnings.push(`gemini-cli: skipped ${skipped} unreadable file(s)`);
    if (models.size > 0) warnings.push(`gemini-cli: models detected: ${[...models].join(', ')}`);
    return {
      tokens,
      costUsd,
      sources: ['gemini-cli'],
      agents: ['Gemini CLI'],
      warnings,
    };
  },
};
