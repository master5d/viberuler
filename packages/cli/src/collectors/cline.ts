import { readFile, readdir } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import type { Collector, ScanContext, TokenUsage } from '../types.js';
import { costForUsage } from '../pricing.js';

interface ClineApiMetrics {
  tokensIn?: unknown;
  tokensOut?: unknown;
  cacheReads?: unknown;
  cacheWrites?: unknown;
  cost?: unknown;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Parse one Cline-family task file (ui_messages.json — a JSON array of UI
 * messages). Token usage lives in { type:"say", say:"api_req_started" } entries
 * whose `text` field is a JSON STRING (JSON-inside-JSON) holding tokensIn/
 * tokensOut/cacheReads/cacheWrites/cost. Streaming/partial entries whose text
 * won't parse, or that carry no token fields yet, are skipped.
 * Returns null when the file isn't a JSON array or holds no completed metrics.
 */
export function parseClineTaskFile(content: string): { tokens: TokenUsage; costUsd: number } | null {
  let msgs: unknown;
  try {
    msgs = JSON.parse(content);
  } catch {
    return null;
  }
  if (!Array.isArray(msgs)) return null;

  const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  let sawMetric = false;

  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue;
    const rec = m as { type?: unknown; say?: unknown; text?: unknown };
    if (rec.type !== 'say' || rec.say !== 'api_req_started' || typeof rec.text !== 'string') continue;

    let metric: ClineApiMetrics;
    try {
      metric = JSON.parse(rec.text) as ClineApiMetrics;
    } catch {
      continue; // partial/streaming entry
    }
    if (
      metric.tokensIn === undefined &&
      metric.tokensOut === undefined &&
      metric.cacheReads === undefined &&
      metric.cacheWrites === undefined
    ) {
      continue; // request not yet completed
    }

    sawMetric = true;
    const t: TokenUsage = {
      input: num(metric.tokensIn),
      output: num(metric.tokensOut),
      cacheWrite: num(metric.cacheWrites),
      cacheRead: num(metric.cacheReads),
    };
    tokens.input += t.input;
    tokens.output += t.output;
    tokens.cacheWrite += t.cacheWrite;
    tokens.cacheRead += t.cacheRead;
    // Trust Cline's own logged cost (including 0) when it's a finite non-negative
    // number; otherwise fall back to the sonnet-tier table (Cline's dominant
    // backend). NEVER both — that was PR #7's double-count bug.
    costUsd +=
      typeof metric.cost === 'number' && Number.isFinite(metric.cost) && metric.cost >= 0
        ? metric.cost
        : costForUsage('claude-sonnet', t);
  }

  return sawMetric ? { tokens, costUsd } : null;
}

// ext-id → display name for the "agents in the stable" line. Order also defines
// which forks we probe under each globalStorage root.
const EXT_AGENT: Record<string, string> = {
  'saoudrizwan.claude-dev': 'Cline',
  'cline.cline': 'Cline',
  'rooveterinaryinc.roo-cline': 'Roo Code',
  'kilocode.kilo-code': 'KiloCode',
};

function storageRoots(ctx: ScanContext): string[] {
  const env = ctx.env ?? process.env;
  const override = env.VIBERULER_CLINE_STORAGE;
  if (override) return override.split(delimiter).filter(Boolean);

  const roots: string[] = [join(ctx.home, '.cline', 'data')]; // standalone Cline
  const base =
    process.platform === 'win32'
      ? (env.APPDATA ?? join(ctx.home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(ctx.home, 'Library', 'Application Support')
        : join(ctx.home, '.config');
  for (const variant of ['Code', 'Code - Insiders', 'VSCodium']) {
    roots.push(join(base, variant, 'User', 'globalStorage'));
  }
  return roots;
}

async function* taskDirs(ctx: ScanContext): AsyncGenerator<{ id: string; dir: string; agent: string }> {
  for (const root of storageRoots(ctx)) {
    for (const [extId, agent] of Object.entries(EXT_AGENT)) {
      const tasksDir = join(root, extId, 'tasks');
      let entries;
      try {
        entries = await readdir(tasksDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) yield { id: e.name, dir: join(tasksDir, e.name), agent };
      }
    }
  }
}

export const clineCollector: Collector = {
  id: 'cline',
  async detect(ctx) {
    for await (const _dir of taskDirs(ctx)) return true;
    return false;
  },
  async collect(ctx) {
    const tokens: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let skipped = 0;
    const seen = new Set<string>();
    const agents = new Set<string>();

    for await (const { id, dir, agent } of taskDirs(ctx)) {
      if (seen.has(id)) continue; // same task synced across installs — count once
      seen.add(id);
      let content: string;
      try {
        content = await readFile(join(dir, 'ui_messages.json'), 'utf8');
      } catch {
        continue; // task dir without a ui_messages.json
      }
      const r = parseClineTaskFile(content);
      if (!r) {
        skipped++;
        continue;
      }
      agents.add(agent);
      tokens.input += r.tokens.input;
      tokens.output += r.tokens.output;
      tokens.cacheWrite += r.tokens.cacheWrite;
      tokens.cacheRead += r.tokens.cacheRead;
      costUsd += r.costUsd;
    }

    if (agents.size === 0 && skipped === 0) return {}; // nothing here
    const warnings = skipped > 0 ? [`cline: skipped ${skipped} unparseable task file(s)`] : [];
    return { tokens, costUsd, sources: ['cline'], agents: [...agents], warnings };
  },
};
