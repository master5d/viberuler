import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

// Recursively sum every finite number under an object (robust to unknown
// promptTokenBreakdown sub-field names across Cursor versions).
function sumNumericLeaves(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v && typeof v === 'object') {
    let total = 0;
    for (const val of Object.values(v as Record<string, unknown>)) total += sumNumericLeaves(val);
    return total;
  }
  return 0;
}

/**
 * Parse decoded cursorDiskKV `composerData:*` value strings. Cursor records
 * per-conversation INPUT tokens at `composerData.promptTokenBreakdown`; output
 * and cache are not stored locally. Returns the input-token lower bound and the
 * count of conversations that carried a breakdown.
 */
export function parseCursorValues(values: string[]): { inputTokens: number; conversations: number } {
  let inputTokens = 0;
  let conversations = 0;
  for (const raw of values) {
    let obj: unknown;
    try { obj = JSON.parse(raw); } catch { continue; }
    const breakdown = (obj as { promptTokenBreakdown?: unknown })?.promptTokenBreakdown;
    if (!breakdown || typeof breakdown !== 'object') continue;
    inputTokens += sumNumericLeaves(breakdown);
    conversations++;
  }
  return { inputTokens, conversations };
}

function storageDirs(ctx: ScanContext): string[] {
  const env = ctx.env ?? process.env;
  if (env.VIBERULER_CURSOR_STORAGE) return [env.VIBERULER_CURSOR_STORAGE];
  const base =
    process.platform === 'win32'
      ? (env.APPDATA ?? join(ctx.home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(ctx.home, 'Library', 'Application Support')
        : join(ctx.home, '.config');
  return [join(base, 'Cursor', 'User', 'globalStorage')];
}

async function findDb(ctx: ScanContext): Promise<string | null> {
  for (const dir of storageDirs(ctx)) {
    const db = join(dir, 'state.vscdb');
    try { if ((await stat(db)).isFile()) return db; } catch { /* not here */ }
  }
  return null;
}

async function readComposerValues(dbPath: string): Promise<string[] | null> {
  const modName = 'node:sqlite'; // non-literal specifier: don't let tsup/tsc resolve a 22.5+ builtin
  let sqlite: { DatabaseSync: new (p: string, o: object) => any };
  try { sqlite = await import(modName); } catch { return null; }
  let db: any;
  try { db = new sqlite.DatabaseSync(dbPath, { readOnly: true }); } catch { return null; }
  try {
    const rows = db
      .prepare("SELECT value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
      .all() as Array<{ value: unknown }>;
    return rows.map((r) =>
      typeof r.value === 'string' ? r.value
        : r.value instanceof Uint8Array ? new TextDecoder().decode(r.value)
          : String(r.value),
    );
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export const cursorCollector: Collector = {
  id: 'cursor',
  async detect(ctx) {
    return (await findDb(ctx)) !== null;
  },
  async collect(ctx) {
    const dbPath = await findDb(ctx);
    if (!dbPath) return {};
    const values = await readComposerValues(dbPath);
    if (values === null) {
      return { warnings: ['cursor: state.vscdb found but unreadable (node:sqlite needs Node 22.5+) — skipped'] };
    }
    const { inputTokens, conversations } = parseCursorValues(values);
    if (conversations === 0) return {};
    const tokens: TokenUsage = { input: inputTokens, output: 0, cacheWrite: 0, cacheRead: 0 };
    return {
      tokens,
      costUsd: costForUsage('claude-sonnet', tokens),
      sources: ['cursor'],
      agents: ['Cursor'],
      warnings: [
        `cursor: ${inputTokens.toLocaleString('en-US')} input tokens across ${conversations} conversation(s) — an ESTIMATED lower bound (output/cache tokens aren't stored locally)`,
      ],
    };
  },
};
