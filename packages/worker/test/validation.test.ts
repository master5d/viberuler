import { describe, it, expect } from 'vitest';
import { submitPayloadSchema, susReason, plausibilityReason } from '../src/validation.js';

const VALID = {
  client_version: '0.1.0',
  vibe_score: 3101,
  loc: 312_441,
  projects: 47,
  tokens: 1_200_000_000,
  cost_usd: 184.2,
  tok_per_usd: 6_500_000,
  achievements: ['token-billionaire', 'cache-whisperer'],
  breakdown: { volume: 1000, leverage: 1500 },
};

describe('submitPayloadSchema', () => {
  it('accepts the canonical CLI payload', () => {
    expect(submitPayloadSchema.parse(VALID)).toEqual(VALID);
  });
  it('accepts null tok_per_usd', () => {
    expect(submitPayloadSchema.parse({ ...VALID, tok_per_usd: null }).tok_per_usd).toBeNull();
  });
  it('rejects extra keys (strict)', () => {
    expect(() => submitPayloadSchema.parse({ ...VALID, evil: 1 })).toThrow();
  });
  it('rejects negative numbers and non-string achievements', () => {
    expect(() => submitPayloadSchema.parse({ ...VALID, loc: -1 })).toThrow();
    expect(() => submitPayloadSchema.parse({ ...VALID, achievements: [1] })).toThrow();
  });

  it('accepts a 0.3 payload carrying tok_per_loc', () => {
    expect(submitPayloadSchema.parse({ ...VALID, tok_per_loc: 8400 }).tok_per_loc).toBe(8400);
  });
  it('accepts a 0.2 payload with tok_per_loc absent (backwards compat)', () => {
    const parsed = submitPayloadSchema.parse(VALID); // VALID has no tok_per_loc
    expect(parsed.tok_per_loc).toBeUndefined();
  });
  it('accepts a 0.4 payload carrying ship outcomes, rejects negatives', () => {
    const parsed = submitPayloadSchema.parse({ ...VALID, feats_shipped: 57, prs_merged: 12 });
    expect(parsed.feats_shipped).toBe(57);
    expect(parsed.prs_merged).toBe(12);
    expect(() => submitPayloadSchema.parse({ ...VALID, feats_shipped: -1 })).toThrow();
  });
  it('accepts a pre-0.4 payload with ship outcomes absent (backwards compat)', () => {
    expect(submitPayloadSchema.parse(VALID).feats_shipped).toBeUndefined();
  });

  it('accepts null tok_per_loc and rejects a negative one', () => {
    expect(submitPayloadSchema.parse({ ...VALID, tok_per_loc: null }).tok_per_loc).toBeNull();
    expect(() => submitPayloadSchema.parse({ ...VALID, tok_per_loc: -1 })).toThrow();
  });
});

describe('susReason', () => {
  it('null for sane payloads', () => {
    expect(susReason(VALID)).toBeNull();
  });
  it('trips each cap', () => {
    expect(susReason({ ...VALID, loc: 50_000_001 })).toBe('loc');
    expect(susReason({ ...VALID, tokens: 100_000_000_001 })).toBe('tokens');
    expect(susReason({ ...VALID, tokens: 2_000_000, cost_usd: 0 })).toBe('cost');
    expect(susReason({ ...VALID, tok_per_usd: 100_000_001 })).toBe('efficiency');
    expect(susReason({ ...VALID, vibe_score: 50_001 })).toBe('vibe');
    expect(susReason({ ...VALID, achievements: ['fake-badge'] })).toBe('achievements');
  });
});

const CTX = { accountAgeDays: 400, previous: null, now: '2026-07-08T00:00:00Z' };

describe('plausibilityReason', () => {
  it('passes an honest, self-consistent payload', () => {
    // breakdown sums to vibe_score, tok_per_usd ≈ tokens/cost
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 1_000_000, cost_usd: 1, tok_per_usd: 1_000_000 };
    expect(plausibilityReason(p, CTX)).toBeNull();
  });
  it('flags a breakdown that does not sum to vibe_score (hand-edited)', () => {
    const p = { ...VALID, vibe_score: 9000, breakdown: { volume: 10, leverage: 10 } };
    expect(plausibilityReason(p, CTX)).toBe('inconsistent-breakdown');
  });
  it('flags tok_per_usd that does not match tokens/cost', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 1_000_000, cost_usd: 1, tok_per_usd: 99_000_000 };
    expect(plausibilityReason(p, CTX)).toBe('inconsistent-efficiency');
  });
  it('flags a brand-new account claiming billions of tokens', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 2_000_000_000, cost_usd: 1000, tok_per_usd: 2_000_000 };
    expect(plausibilityReason(p, { ...CTX, accountAgeDays: 2 })).toBe('new-account-volume');
  });
  it('flags a superhuman token accumulation rate for the account age', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 30_000_000_000, cost_usd: 10_000, tok_per_usd: 3_000_000 };
    expect(plausibilityReason(p, { ...CTX, accountAgeDays: 10 })).toBe('token-rate');
  });
  it('flags an implausible token jump since the last submit', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 8_000_000_000, cost_usd: 4000, tok_per_usd: 2_000_000 };
    const ctx = { accountAgeDays: 400, now: '2026-07-08T00:00:00Z',
      previous: { tokens: 1_000_000, submittedAt: '2026-07-07T23:00:00Z' } };
    expect(plausibilityReason(p, ctx)).toBe('velocity');
  });
  it('skips account-age checks when age is unknown', () => {
    const p = { ...VALID, vibe_score: 2500, breakdown: { volume: 1000, leverage: 1500 },
      tokens: 2_000_000_000, cost_usd: 1000, tok_per_usd: 2_000_000 };
    expect(plausibilityReason(p, { accountAgeDays: null, previous: null, now: CTX.now })).toBeNull();
  });
});
