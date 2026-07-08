import { describe, it, expect } from 'vitest';
import { submitPayloadSchema, susReason } from '../src/validation.js';

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
