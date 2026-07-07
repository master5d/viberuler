import type { TokenUsage } from './types.js';

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// USD per million tokens. Sources: public Anthropic/OpenAI pricing pages.
// Refresh each release; documented in METHODOLOGY.md.
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

export function costForUsage(model: string, u: TokenUsage): number {
  const p = priceFor(model);
  return (
    (u.input * p.input + u.output * p.output + u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead) /
    1_000_000
  );
}
