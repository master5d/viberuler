import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCatalog, repriceMix, loadMarketRates, MARKET_SNAPSHOT, CURATED } from '../src/market.js';

const CATALOG = {
  data: [
    {
      id: 'moonshotai/kimi-k3',
      pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0' },
      benchmarks: { artificial_analysis: { intelligence_index: 59.7, coding_index: 76.2 } },
    },
    {
      id: 'anthropic/claude-fable-5',
      pricing: { prompt: '0.00001', completion: '0.00005', input_cache_read: '0.000001', input_cache_write: '0.0000125' },
    },
    { id: 'some/uncurated-model', pricing: { prompt: '0.001', completion: '0.002' } },
    { id: 'z-ai/glm-5.2', pricing: { prompt: '0', completion: '0' } }, // free/unpriced row must be dropped
  ],
};

describe('parseCatalog', () => {
  it('keeps curated ids only, converts to $/Mtok, sorts by input price', () => {
    const rates = parseCatalog(CATALOG);
    expect(rates.map((r) => r.id)).toEqual(['moonshotai/kimi-k3', 'anthropic/claude-fable-5']);
    const kimi = rates[0]!;
    expect(kimi.input).toBeCloseTo(3, 6);
    expect(kimi.output).toBeCloseTo(15, 6);
    expect(kimi.cacheRead).toBeCloseTo(0.3, 6);
    expect(kimi.cacheWrite).toBeCloseTo(3, 6); // zero write rate → billed as input
  });

  it('carries the AA intelligence index when the catalog has one, omits it otherwise', () => {
    const rates = parseCatalog(CATALOG);
    expect(rates.find((r) => r.id === 'moonshotai/kimi-k3')?.intelligence).toBeCloseTo(59.7, 6);
    expect(rates.find((r) => r.id === 'anthropic/claude-fable-5')?.intelligence).toBeUndefined();
  });

  it('returns [] on garbage', () => {
    expect(parseCatalog(null)).toEqual([]);
    expect(parseCatalog({ data: 'nope' })).toEqual([]);
  });
});

describe('repriceMix', () => {
  it('is plain arithmetic across all four buckets', () => {
    const rate = { id: 'x', label: 'X', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
    const u = { input: 1_000_000, output: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000 };
    expect(repriceMix(u, rate)).toBeCloseTo(2 + 10 + 0.2 + 2.5, 10);
  });
});

describe('MARKET_SNAPSHOT', () => {
  it('covers every curated id it claims and is labelled bundled', () => {
    expect(MARKET_SNAPSHOT.source).toBe('bundled');
    expect(MARKET_SNAPSHOT.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const r of MARKET_SNAPSHOT.rates) {
      expect(CURATED[r.id]).toBe(r.label);
      expect(r.input).toBeGreaterThan(0);
      expect(r.output).toBeGreaterThan(0);
    }
  });
});

describe('loadMarketRates', () => {
  const okFetch = (async () => ({ ok: true, json: async () => CATALOG })) as unknown as typeof fetch;
  const downFetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;

  it('live fetch parses, labels live, and writes the cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibe-market-'));
    const cacheFile = join(dir, 'market.json');
    const d = await loadMarketRates({ fetchImpl: okFetch, cacheFile, now: () => 1_754_500_000_000 });
    expect(d.source).toBe('live');
    expect(d.rates.map((r) => r.id)).toContain('moonshotai/kimi-k3');
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    expect(cached.fetchedAt).toBe(1_754_500_000_000);
  });

  it('prefers a fresh cache without touching the network', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibe-market-'));
    const cacheFile = join(dir, 'market.json');
    const rates = [{ id: 'a', label: 'A', input: 1, output: 2, cacheRead: 1, cacheWrite: 1 }];
    await writeFile(cacheFile, JSON.stringify({ fetchedAt: 1000, rates }));
    const d = await loadMarketRates({
      fetchImpl: (() => {
        throw new Error('must not fetch');
      }) as unknown as typeof fetch,
      cacheFile,
      now: () => 1000 + 60_000, // one minute later — fresh
    });
    expect(d.source).toBe('cache');
    expect(d.rates).toEqual(rates);
  });

  it('degrades offline: stale cache first, bundled snapshot last', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibe-market-'));
    const cacheFile = join(dir, 'market.json');
    const rates = [{ id: 'a', label: 'A', input: 1, output: 2, cacheRead: 1, cacheWrite: 1 }];
    await writeFile(cacheFile, JSON.stringify({ fetchedAt: 1000, rates }));
    const stale = await loadMarketRates({ fetchImpl: downFetch, cacheFile, now: () => 1000 + 48 * 3600 * 1000 });
    expect(stale.source).toBe('cache');
    expect(stale.rates).toEqual(rates);

    const none = await loadMarketRates({ fetchImpl: downFetch, cacheFile: join(dir, 'missing.json'), now: () => 0 });
    expect(none).toEqual(MARKET_SNAPSHOT);
  });
});
