import type { TokenUsage } from './types.js';

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// USD per million tokens. Sources: public Anthropic/OpenAI pricing pages.
// SNAPSHOT POLICY: this table is a point-in-time snapshot (see PRICES_SNAPSHOT_DATE);
// refresh the numbers AND the date together, each release. Historical usage is priced
// at the snapshot rates — we do not track per-date price history (documented in METHODOLOGY).
// The cacheWrite column is the 5-MINUTE (1.25x input) rate; 1-hour writes bill at 2x input
// via CostOptions.cacheWrite1h.
export const PRICES_SNAPSHOT_DATE = '2026-07-08';

export interface CostOptions {
  /** Portion of u.cacheWrite written with a 1-hour TTL (Claude Code:
   *  usage.cache_creation.ephemeral_1h_input_tokens). Billed at 2x input. */
  cacheWrite1h?: number;
}

export const PRICES: Record<string, ModelPrice> = {
  'claude-opus':   { input: 15,   output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet': { input: 3,    output: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
  'claude-haiku':  { input: 1,    output: 5,  cacheWrite: 1.25,  cacheRead: 0.1 },
  'claude-fable':  { input: 15,   output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'codex-default': { input: 1.25, output: 10, cacheWrite: 1.25,  cacheRead: 0.125 },
};

const FALLBACK = PRICES['claude-sonnet']!;

export function priceFor(model: string): ModelPrice {
  let best: ModelPrice | undefined;
  let bestLen = -1;
  for (const [prefix, price] of Object.entries(PRICES)) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = price;
      bestLen = prefix.length;
    }
  }
  return best ?? FALLBACK;
}

export function costForUsage(model: string, u: TokenUsage, opts: CostOptions = {}): number {
  const p = priceFor(model);
  const oneHour = Math.min(Math.max(opts.cacheWrite1h ?? 0, 0), u.cacheWrite);
  const fiveMin = u.cacheWrite - oneHour;
  return (
    (u.input * p.input +
      u.output * p.output +
      fiveMin * p.cacheWrite +
      oneHour * p.input * 2 +
      u.cacheRead * p.cacheRead) /
    1_000_000
  );
}
