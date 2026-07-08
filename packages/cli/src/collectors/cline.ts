import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

/**
 * Cline stores task data in VS Code extension globalStorage.
 *
 * Tries multiple known extension directories:
 *   - saoudrizwan.claude-dev (original)
 *   - cline.cline (post-rebrand)
 *   - rooveterinaryinc.roo-cline (Roo Cline fork)
 *
 * Each task is a JSON file (one per conversation) containing:
 * ```json
 * {
 *   "messages": [
 *     {
 *       "apiMetrics": {
 *         "inputTokens": 123,
 *         "outputTokens": 456,
 *         "cost": 0.01
 *       }
 *     }
 *   ],
 *   "apiMetrics": {
 *     "totalTokensIn": 123,
 *     "totalTokensOut": 456,
 *     "totalCost": 0.01
 *   }
 * }
 * ```
 *
 * V3+ tasks may use protobuf — those are silently skipped.
 */

const EXTENSION_DIRS = [
  'saoudrizwan.claude-dev',
  'cline.cline',
  'rooveterinaryinc.roo-cline',
];

function globalStorageDir(home: string): string {
  if (process.platform === 'linux') return join(home, '.config', 'Code', 'User', 'globalStorage');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage');
  return '';
}

interface ClineTaskApiMetrics {
  totalTokensIn?: number;
  totalTokensOut?: number;
  totalCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

interface ClineMessage {
  apiMetrics?: ClineTaskApiMetrics;
}

interface ClineTask {
  messages?: ClineMessage[];
  apiMetrics?: ClineTaskApiMetrics;
}

function isJsonTask(buf: Buffer): boolean {
  const head = buf.subarray(0, 64).toString('utf8').trim();
  return head.startsWith('{') && (head.includes('"messages"') || head.includes('"apiMetrics"'));
}

function parseTask(content: Buffer): { tokens: TokenUsage; costUsd: number } | null {
  let task: ClineTask;
  try {
    task = JSON.parse(content.toString('utf8'));
  } catch {
    return null;
  }

  const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;

  // Try per-message metrics (most granular)
  if (Array.isArray(task.messages)) {
    for (const msg of task.messages) {
      const m = msg.apiMetrics;
      if (!m) continue;
      tokens.input += m.inputTokens ?? m.totalTokensIn ?? 0;
      tokens.output += m.outputTokens ?? m.totalTokensOut ?? 0;
      costUsd += m.cost ?? 0;
    }
  }

  // Fallback to top-level apiMetrics aggregate
  const top = task.apiMetrics;
  if (top && tokens.input === 0 && tokens.output === 0) {
    tokens.input += top.totalTokensIn ?? 0;
    tokens.output += top.totalTokensOut ?? 0;
    costUsd += top.totalCost ?? 0;
  }

  // If we still have zero tokens and zero cost, skip
  if (tokens.input + tokens.output === 0 && costUsd === 0) {
    return null;
  }

  return { tokens, costUsd };
}

async function* walkTaskFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isFile()) {
      yield join(dir, e.name);
    }
  }
}

async function tasksDir(ctx: ScanContext): Promise<string | null> {
  const gs = globalStorageDir(ctx.home);
  if (!gs) return null;
  for (const ext of EXTENSION_DIRS) {
    const dir = join(gs, ext, 'tasks');
    try {
      if ((await stat(dir)).isDirectory()) return dir;
    } catch {
      continue;
    }
  }
  return null;
}

export const clineCollector: Collector = {
  id: 'cline',
  async detect(ctx) {
    return (await tasksDir(ctx)) !== null;
  },
  async collect(ctx) {
    const dir = await tasksDir(ctx);
    if (!dir) return {};

    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let skipped = 0;

    for await (const file of walkTaskFiles(dir)) {
      if (!file.endsWith('.json')) { skipped++; continue; }
      try {
        const buf = await readFile(file);
        if (!isJsonTask(buf)) { skipped++; continue; }
        const r = parseTask(buf);
        if (!r) { skipped++; continue; }
        tokens.input += r.tokens.input;
        tokens.output += r.tokens.output;
        costUsd += r.costUsd;
      } catch {
        skipped++;
      }
    }

    const warnings: string[] = [];
    if (skipped > 0) warnings.push(`cline: skipped ${skipped} unparseable file(s)`);

    return {
      tokens,
      costUsd: costForUsage('claude-sonnet', tokens) + costUsd,
      sources: ['cline'],
      warnings,
    };
  },
};
