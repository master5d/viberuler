import type { TokenUsage } from '../types.js';
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
