import { describe, it, expect } from 'vitest';
import { priceFor, costForUsage } from '../src/pricing.js';

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
