import { describe, it, expect } from 'vitest';
import { priceFor, costForUsage, PRICES_SNAPSHOT_DATE } from '../src/pricing.js';

describe('priceFor', () => {
  it('matches model ids by longest prefix', () => {
    expect(priceFor('claude-sonnet-4-6').input).toBe(3);
    expect(priceFor('claude-opus-4-8').output).toBe(75);
    expect(priceFor('claude-haiku-4-5-20251001').input).toBe(1);
  });
  it('falls back to sonnet tier for unknown models', () => {
    expect(priceFor('mystery-model-9000')).toEqual(priceFor('claude-sonnet-4-6'));
  });
});

describe('costForUsage', () => {
  it('computes USD across all four buckets', () => {
    // sonnet: in 3, out 15, cacheWrite 3.75, cacheRead 0.30 per MTok
    const cost = costForUsage('claude-sonnet-4-6', {
      input: 1_000_000, output: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 + 15 + 3.75 + 0.3, 5);
  });
  it('is zero for zero usage', () => {
    expect(costForUsage('claude-opus-4-8', { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })).toBe(0);
  });
});

describe('costForUsage cache-write tiers', () => {
  const u = { input: 100, output: 200, cacheWrite: 1000, cacheRead: 5000 };

  it('bills the 1h portion at 2x input and the rest at the table 5m rate', () => {
    // sonnet: in 3, out 15, cacheWrite(5m) 3.75, cacheRead 0.3; 1h = 3*2 = 6 per MTok
    // (100*3 + 200*15 + 400*3.75 + 600*6 + 5000*0.3) / 1e6 = 0.0099
    expect(costForUsage('claude-sonnet-5', u, { cacheWrite1h: 600 })).toBeCloseTo(0.0099, 12);
  });

  it('defaults to the 5m rate when no breakdown is passed (old logs)', () => {
    // (100*3 + 200*15 + 1000*3.75 + 5000*0.3) / 1e6 = 0.00855
    expect(costForUsage('claude-sonnet-5', u)).toBeCloseTo(0.00855, 12);
  });

  it('clamps cacheWrite1h to the cacheWrite total (defensive against bad logs)', () => {
    expect(costForUsage('claude-sonnet-5', u, { cacheWrite1h: 9999 })).toBeCloseTo(
      (100 * 3 + 200 * 15 + 1000 * 6 + 5000 * 0.3) / 1e6, 12,
    );
  });
});

describe('PRICES_SNAPSHOT_DATE', () => {
  it('is a YYYY-MM-DD date string', () => {
    expect(PRICES_SNAPSHOT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
