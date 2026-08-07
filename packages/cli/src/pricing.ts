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
export const PRICES_SNAPSHOT_DATE = '2026-08-07';

export interface CostOptions {
  /** Portion of u.cacheWrite written with a 1-hour TTL (Claude Code:
   *  usage.cache_creation.ephemeral_1h_input_tokens). Billed at 2x input. */
  cacheWrite1h?: number;
}

export const PRICES: Record<string, ModelPrice> = {
  // June-2026 Anthropic repricing: Opus 4.x dropped to 5/25; Fable/Mythos 5
  // (Anthropic's top tier) bills at 2x Opus. Mythos shares Fable's rates.
  'claude-opus':   { input: 5,    output: 25, cacheWrite: 6.25,  cacheRead: 0.5 },
  'claude-sonnet': { input: 3,    output: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
  'claude-haiku':  { input: 1,    output: 5,  cacheWrite: 1.25,  cacheRead: 0.1 },
  'claude-fable':  { input: 10,   output: 50, cacheWrite: 12.5,  cacheRead: 1 },
  'claude-mythos': { input: 10,   output: 50, cacheWrite: 12.5,  cacheRead: 1 },
  // Sonnet 5 launched below the 4.x price (2/10 vs 3/15) — the longer prefix
  // wins over the generic 'claude-sonnet' row above.
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'codex-default': { input: 1.25, output: 10, cacheWrite: 1.25,  cacheRead: 0.125 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.31 },
  'gemini':         { input: 0.3,  output: 2.5, cacheWrite: 0.3, cacheRead: 0.075 },
  // Open-weight / market models a self-hosted gateway (LiteLLM collector) is
  // likely to route. List rates from the OpenRouter catalog, snapshotted with
  // PRICES_SNAPSHOT_DATE. Where a provider bills cache writes as plain input
  // (no separate write rate published), cacheWrite = input; where cache reads
  // have no published discount, cacheRead = input.
  'kimi-k3':         { input: 3,    output: 15,   cacheWrite: 3,    cacheRead: 0.3 },
  'kimi-k2':         { input: 0.7,  output: 3.5,  cacheWrite: 0.7,  cacheRead: 0.15 },
  'deepseek-v4-pro': { input: 0.44, output: 0.87, cacheWrite: 0.44, cacheRead: 0.004 },
  'deepseek':        { input: 0.09, output: 0.18, cacheWrite: 0.09, cacheRead: 0.018 },
  'glm-5.2':         { input: 0.69, output: 2.15, cacheWrite: 0.69, cacheRead: 0.13 },
  'glm':             { input: 0.95, output: 2.55, cacheWrite: 0.95, cacheRead: 0.2 },
  'qwen3.8-max':     { input: 2,    output: 6,    cacheWrite: 2.5,  cacheRead: 0.25 },
  'qwen':            { input: 0.32, output: 1.28, cacheWrite: 0.4,  cacheRead: 0.064 },
  'llama-4':         { input: 0.2,  output: 0.8,  cacheWrite: 0.2,  cacheRead: 0.2 },
  'minimax-m3':      { input: 0.3,  output: 1.2,  cacheWrite: 0.3,  cacheRead: 0.06 },
  'grok':            { input: 2,    output: 6,    cacheWrite: 2,    cacheRead: 0.3 },
};

const FALLBACK = PRICES['claude-sonnet']!;

/**
 * Gateway logs name models with provider path prefixes —
 * "openrouter/moonshotai/kimi-k3", "deepseek/deepseek-v4-flash" — while the
 * price table keys bare model families. Matching happens on the last path
 * segment so both spellings price identically.
 */
export function normalizeModel(model: string): string {
  const seg = model.split('/').pop() ?? model;
  return seg.toLowerCase();
}

function bestPrefixMatch(model: string): ModelPrice | undefined {
  const m = normalizeModel(model);
  let best: ModelPrice | undefined;
  let bestLen = -1;
  for (const [prefix, price] of Object.entries(PRICES)) {
    if (m.startsWith(prefix) && prefix.length > bestLen) {
      best = price;
      bestLen = prefix.length;
    }
  }
  return best;
}

/** True when the table actually knows this model (no sonnet fallback involved). */
export function hasKnownPrice(model: string): boolean {
  return bestPrefixMatch(model) !== undefined;
}

export function priceFor(model: string): ModelPrice {
  return bestPrefixMatch(model) ?? FALLBACK;
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
