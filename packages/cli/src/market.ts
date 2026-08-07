import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TokenUsage } from './types.js';

/**
 * Opt-in market rates for `audit --market`.
 *
 * The zero-network-by-default promise holds: nothing here runs unless the user
 * passes --market, which is documented as ONE anonymous GET to the OpenRouter
 * public catalog. The result is cached locally for a day, and when the network
 * is missing the bundled snapshot below answers instead — clearly labelled, so
 * a stale number is never dressed up as a live one.
 */

export interface MarketRate {
  /** Catalog id, e.g. 'moonshotai/kimi-k3'. */
  id: string;
  label: string;
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /**
   * Artificial Analysis intelligence index, as republished in the OpenRouter
   * catalog (`benchmarks.artificial_analysis.intelligence_index`). Third-party
   * benchmark, not our measurement; absent when the catalog carries none.
   */
  intelligence?: number;
}

export interface MarketData {
  /** ISO date the rates were fetched (live/cache) or snapshotted (bundled). */
  asOf: string;
  source: 'live' | 'cache' | 'bundled';
  rates: MarketRate[];
}

/**
 * The models worth comparing against: current open-weight flagships plus the
 * frontier closed tiers, one line each. Curated, not exhaustive — a 400-row
 * table is noise, not information.
 */
export const CURATED: Record<string, string> = {
  'moonshotai/kimi-k3': 'Kimi K3 (open)',
  'deepseek/deepseek-v4-pro': 'DeepSeek V4 Pro (open)',
  'deepseek/deepseek-v4-flash': 'DeepSeek V4 Flash (open)',
  'z-ai/glm-5.2': 'GLM 5.2 (open)',
  'qwen/qwen3.8-max': 'Qwen3.8 Max',
  'meta-llama/llama-4-maverick': 'Llama 4 Maverick (open)',
  'minimax/minimax-m3': 'MiniMax M3 (open)',
  'x-ai/grok-4.5': 'Grok 4.5',
  'openai/gpt-5.6-terra-pro': 'GPT-5.6 Terra Pro',
  'anthropic/claude-sonnet-5': 'Claude Sonnet 5',
  'anthropic/claude-opus-5': 'Claude Opus 5',
  'anthropic/claude-fable-5': 'Claude Fable 5',
};

/** Bundled fallback, fetched from the same catalog on the snapshot date. */
export const MARKET_SNAPSHOT: MarketData = {
  asOf: '2026-08-07',
  source: 'bundled',
  rates: [
    { id: 'moonshotai/kimi-k3', label: 'Kimi K3 (open)', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3, intelligence: 59.7 },
    { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro (open)', input: 0.44, output: 0.87, cacheRead: 0.004, cacheWrite: 0.44, intelligence: 45.3 },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (open)', input: 0.09, output: 0.18, cacheRead: 0.018, cacheWrite: 0.09 },
    { id: 'z-ai/glm-5.2', label: 'GLM 5.2 (open)', input: 0.69, output: 2.15, cacheRead: 0.13, cacheWrite: 0.69, intelligence: 52.6 },
    { id: 'qwen/qwen3.8-max', label: 'Qwen3.8 Max', input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5, intelligence: 58.1 },
    { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick (open)', input: 0.2, output: 0.8, cacheRead: 0.2, cacheWrite: 0.2, intelligence: 14.5 },
    { id: 'minimax/minimax-m3', label: 'MiniMax M3 (open)', input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.3, intelligence: 45.4 },
    { id: 'x-ai/grok-4.5', label: 'Grok 4.5', input: 2, output: 6, cacheRead: 0.3, cacheWrite: 2, intelligence: 55.8 },
    { id: 'openai/gpt-5.6-terra-pro', label: 'GPT-5.6 Terra Pro', input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 },
    { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, intelligence: 55.3 },
    { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, intelligence: 63.1 },
    { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5', input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, intelligence: 62.1 },
  ],
};

/**
 * Extract curated rates from an OpenRouter /api/v1/models response body.
 * Catalog prices are USD per single token; we keep USD per million.
 * A zero cache rate means "not billed separately": reads fall back to the
 * input rate (no discount assumed), writes to the input rate.
 */
export function parseCatalog(body: unknown): MarketRate[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: MarketRate[] = [];
  for (const m of data) {
    const id = (m as { id?: unknown })?.id;
    if (typeof id !== 'string' || !(id in CURATED)) continue;
    const p = (m as { pricing?: Record<string, unknown> }).pricing ?? {};
    const per = (k: string): number => {
      const n = Number(p[k]);
      return Number.isFinite(n) && n > 0 ? n * 1e6 : 0;
    };
    const input = per('prompt');
    const output = per('completion');
    if (input <= 0 || output <= 0) continue;
    const aa = (m as { benchmarks?: { artificial_analysis?: { intelligence_index?: unknown } } }).benchmarks
      ?.artificial_analysis;
    const intel = Number(aa?.intelligence_index);
    out.push({
      id,
      label: CURATED[id]!,
      input,
      output,
      cacheRead: per('input_cache_read') || input,
      cacheWrite: per('input_cache_write') || input,
      ...(Number.isFinite(intel) && intel > 0 ? { intelligence: intel } : {}),
    });
  }
  out.sort((a, b) => a.input - b.input || a.id.localeCompare(b.id));
  return out;
}

/** Arithmetic reprice of a token mix at one market rate. USD. */
export function repriceMix(u: TokenUsage, r: MarketRate): number {
  return (
    (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + u.cacheWrite * r.cacheWrite) / 1e6
  );
}

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 24 * 3600 * 1000;

export interface MarketDeps {
  fetchImpl?: typeof fetch;
  cacheFile?: string;
  now?: () => number;
}

export function defaultCacheFile(): string {
  return join(homedir(), '.viberuler', 'market.json');
}

/**
 * Cache (fresh) → live fetch (writes cache) → cache (stale) → bundled snapshot.
 * Every failure degrades one step and keeps the source label honest.
 */
export async function loadMarketRates(deps: MarketDeps = {}): Promise<MarketData> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const cacheFile = deps.cacheFile ?? defaultCacheFile();
  const now = deps.now ?? Date.now;

  let cached: { fetchedAt: number; rates: MarketRate[] } | undefined;
  try {
    const parsed = JSON.parse(await readFile(cacheFile, 'utf8'));
    if (Array.isArray(parsed?.rates) && typeof parsed?.fetchedAt === 'number') cached = parsed;
  } catch {
    /* no cache yet */
  }
  if (cached && now() - cached.fetchedAt < CACHE_TTL_MS && cached.rates.length > 0) {
    return { asOf: new Date(cached.fetchedAt).toISOString().slice(0, 10), source: 'cache', rates: cached.rates };
  }

  try {
    const res = await fetchImpl(CATALOG_URL);
    if (res.ok) {
      const rates = parseCatalog(await res.json());
      if (rates.length > 0) {
        try {
          await mkdir(dirname(cacheFile), { recursive: true });
          await writeFile(cacheFile, JSON.stringify({ fetchedAt: now(), rates }, null, 2));
        } catch {
          /* cache write is best-effort */
        }
        return { asOf: new Date(now()).toISOString().slice(0, 10), source: 'live', rates };
      }
    }
  } catch {
    /* network down — degrade */
  }

  if (cached && cached.rates.length > 0) {
    return { asOf: new Date(cached.fetchedAt).toISOString().slice(0, 10), source: 'cache', rates: cached.rates };
  }
  return MARKET_SNAPSHOT;
}
