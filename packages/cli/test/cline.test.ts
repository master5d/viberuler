import { describe, it, expect } from 'vitest';
import { parseClineTaskFile } from '../src/collectors/cline.js';

// One api_req_started with a full metric+cost, one with tokens but NO cost
// (price-table fallback), one streaming/partial entry (unparseable text → skip),
// plus non-metric messages that must be ignored.
const taskFile = JSON.stringify([
  { type: 'say', say: 'text', text: 'hello' },
  {
    type: 'say',
    say: 'api_req_started',
    text: JSON.stringify({ request: '...', tokensIn: 1000, tokensOut: 500, cacheReads: 8000, cacheWrites: 2000, cost: 0.042 }),
  },
  {
    type: 'say',
    say: 'api_req_started',
    text: JSON.stringify({ tokensIn: 100, tokensOut: 50, cacheReads: 0, cacheWrites: 0 }),
  },
  { type: 'say', say: 'api_req_started', text: '{"request":"in progress' }, // partial → skip
  { type: 'ask', ask: 'tool', text: 'whatever' },
]);

describe('parseClineTaskFile', () => {
  it('sums api_req_started metrics; trusts logged cost, else prices at sonnet tier', () => {
    const r = parseClineTaskFile(taskFile);
    expect(r).not.toBeNull();
    expect(r!.tokens).toEqual({ input: 1100, output: 550, cacheWrite: 2000, cacheRead: 8000 });
    // 0.042 (logged) + costForUsage('claude-sonnet',{in100,out50}) = 0.042 + (100*3+50*15)/1e6
    expect(r!.costUsd).toBeCloseTo(0.042 + 0.00105, 12);
  });

  it('trusts a logged cost of exactly 0 (fully cached) instead of re-pricing', () => {
    const f = JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 5, tokensOut: 0, cacheReads: 9000, cacheWrites: 0, cost: 0 }) },
    ]);
    expect(parseClineTaskFile(f)!.costUsd).toBe(0);
  });

  it('returns null for non-array JSON and for arrays with no completed metrics', () => {
    expect(parseClineTaskFile('{"not":"an array"}')).toBeNull();
    expect(parseClineTaskFile('not json at all')).toBeNull();
    expect(parseClineTaskFile(JSON.stringify([{ type: 'say', say: 'text', text: 'hi' }]))).toBeNull();
    // an api_req_started with no token fields = request not yet completed
    expect(parseClineTaskFile(JSON.stringify([{ type: 'say', say: 'api_req_started', text: '{"request":"x"}' }]))).toBeNull();
  });

  it('coerces missing/non-numeric token fields to 0 without NaN-poisoning', () => {
    const f = JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 10, tokensOut: 'bad', cacheReads: null, cost: 0.001 }) },
    ]);
    const r = parseClineTaskFile(f)!;
    expect(r.tokens).toEqual({ input: 10, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(r.costUsd).toBeCloseTo(0.001, 12);
  });
});
