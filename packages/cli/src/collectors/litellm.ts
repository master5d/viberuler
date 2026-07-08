import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { PRICES, costForUsage } from '../pricing.js';

// Opt-in collector for self-built agents routed through a LiteLLM gateway.
// Activates ONLY when the user sets one of:
//   LITELLM_SPEND_DB  — path to a SQLite spend/usage log (read via node:sqlite, Node 22.5+)
//   LITELLM_BASE_URL  — gateway URL; reads GET /spend/logs (+ LITELLM_API_KEY bearer)
// The zero-network-by-default promise holds: no env, no collector.

interface ModelRow {
  model: string;
  prompt: number;
  completion: number;
  spend: number;
}

function env(ctx: ScanContext): Record<string, string | undefined> {
  return ctx.env ?? process.env;
}

function hasExplicitPrice(model: string): boolean {
  return Object.keys(PRICES).some((prefix) => model.startsWith(prefix));
}

export function aggregateRows(rows: ModelRow[]): { tokens: TokenUsage; costUsd: number; unpricedTokens: number } {
  const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  let unpricedTokens = 0;
  for (const r of rows) {
    tokens.input += r.prompt;
    tokens.output += r.completion;
    if (r.spend > 0) {
      costUsd += r.spend;
    } else if (hasExplicitPrice(r.model)) {
      costUsd += costForUsage(r.model, { input: r.prompt, output: r.completion, cacheWrite: 0, cacheRead: 0 });
    } else {
      unpricedTokens += r.prompt + r.completion;
    }
  }
  return { tokens, costUsd, unpricedTokens };
}

const TABLE_CANDIDATES = ['litellm_spendlogs', 'usage', 'spend_logs'];
const TS_CANDIDATES = ['ts', 'starttime', 'start_time', 'timestamp'];

async function readSpendDb(path: string, since?: Date): Promise<{ rows: ModelRow[] } | { error: string }> {
  const modName = 'node:sqlite'; // non-literal specifier: keeps tsc/tsup from resolving a Node 22.5+ builtin
  let sqlite: { DatabaseSync: new (p: string, o: object) => any };
  try {
    sqlite = await import(modName);
  } catch {
    return { error: 'node:sqlite unavailable (Node 22.5+ required for LITELLM_SPEND_DB) — skipped' };
  }
  let db: any;
  try {
    db = new sqlite.DatabaseSync(path, { readOnly: true });
  } catch (err) {
    return { error: `cannot open ${path}: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r: { name: string }) => r.name);
    const table = tables.find((t: string) => TABLE_CANDIDATES.includes(t.toLowerCase()));
    if (!table) return { error: `no spend table found (looked for: ${TABLE_CANDIDATES.join(', ')})` };

    const cols = db
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((c: { name: string }) => c.name);
    const lower = new Map(cols.map((c: string) => [c.toLowerCase(), c]));
    const promptCol = lower.get('prompt_tokens');
    const completionCol = lower.get('completion_tokens');
    const modelCol = lower.get('model') ?? lower.get('model_group');
    const spendCol = lower.get('spend');
    const tsCol = TS_CANDIDATES.map((t) => lower.get(t)).find(Boolean);
    if (!promptCol || !completionCol) return { error: `table ${table} lacks prompt_tokens/completion_tokens` };

    const select =
      `SELECT ${modelCol ? `"${modelCol}"` : "'unknown'"} AS model, ` +
      `COALESCE(SUM("${promptCol}"), 0) AS prompt, COALESCE(SUM("${completionCol}"), 0) AS completion, ` +
      `${spendCol ? `COALESCE(SUM("${spendCol}"), 0)` : '0'} AS spend FROM "${table}"` +
      (since && tsCol ? ` WHERE "${tsCol}" >= ?` : '') +
      ' GROUP BY model';
    const stmt = db.prepare(select);
    const raw = since && tsCol ? stmt.all(since.toISOString()) : stmt.all();
    const rows: ModelRow[] = raw.map((r: any) => ({
      model: String(r.model ?? 'unknown'),
      prompt: Number(r.prompt) || 0,
      completion: Number(r.completion) || 0,
      spend: Number(r.spend) || 0,
    }));
    return { rows };
  } finally {
    db.close();
  }
}

async function readSpendApi(base: string, key?: string): Promise<{ rows: ModelRow[] } | { error: string }> {
  const url = `${base.replace(/\/+$/, '')}/spend/logs`;
  let res: Response;
  try {
    res = await fetch(url, { headers: key ? { authorization: `Bearer ${key}` } : {} });
  } catch (err) {
    return { error: `${url} unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { error: `${url} returned ${res.status}` };
  const body = (await res.json()) as unknown;
  const list = Array.isArray(body) ? body : [];
  const rows: ModelRow[] = list.map((r: any) => ({
    model: String(r?.model ?? 'unknown'),
    prompt: Number(r?.prompt_tokens ?? r?.total_tokens ?? 0) || 0,
    completion: Number(r?.completion_tokens ?? 0) || 0,
    spend: Number(r?.spend ?? 0) || 0,
  }));
  return { rows };
}

export const litellmCollector: Collector = {
  id: 'litellm',
  async detect(ctx) {
    const e = env(ctx);
    return Boolean(e.LITELLM_SPEND_DB || e.LITELLM_BASE_URL);
  },
  async collect(ctx) {
    const e = env(ctx);
    const result = e.LITELLM_SPEND_DB
      ? await readSpendDb(e.LITELLM_SPEND_DB, ctx.since)
      : await readSpendApi(e.LITELLM_BASE_URL!, e.LITELLM_API_KEY);
    if ('error' in result) return { warnings: [`litellm: ${result.error}`] };

    const { tokens, costUsd, unpricedTokens } = aggregateRows(result.rows);
    const warnings: string[] = [];
    if (unpricedTokens > 0) {
      warnings.push(
        `litellm: ${unpricedTokens.toLocaleString('en-US')} tokens had no logged spend and no known price — counted at $0 (free-tier flex)`,
      );
    }
    return { tokens, costUsd, sources: ['litellm'], warnings };
  },
};
