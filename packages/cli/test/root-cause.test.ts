// packages/cli/test/root-cause.test.ts
import { describe, it, expect } from 'vitest';
import {
  attributeRootCauses,
  SUBAGENT_RETURN_BUDGET_TOKENS,
  type WasteEvent,
} from '../src/root-cause.js';

const ev = (p: Partial<WasteEvent>): WasteEvent => ({
  path: '', tokens: 0, kind: 'read',
  oversized: false, sliced: false, repeat: false, exploratory: false, ...p,
});
const idUsd = (t: number) => t; // 1 token = 1 "usd" for easy assertions

describe('attributeRootCauses', () => {
  it('returns [] for a clean trajectory (no waste flags)', () => {
    const events = [ev({ path: 'a.ts', tokens: 500, sliced: true })];
    expect(attributeRootCauses(events, idUsd)).toEqual([]);
  });

  it('attributes each motif and ranks by tokens desc', () => {
    const events = [
      ev({ path: 'big.ts', tokens: 300, repeat: true }),                 // motif 1
      ev({ path: 'huge.ts', tokens: 900, oversized: true }),            // motif 2
      ev({ path: 'x.ts', tokens: 100, exploratory: true }),            // motif 3
      ev({ kind: 'agent', tokens: 5000 }),                              // motif 4: 5000-2000=3000
    ];
    const out = attributeRootCauses(events, idUsd);
    expect(out.map((r) => r.motif)).toEqual([
      'subagent-result-bloat',      // 3000
      'oversized-unslice',          // 900
      'read-whole-then-reread',     // 300
      'explore-wide-use-narrow',    // 100
    ]);
    expect(out[0]!.attributableTokens).toBe(3000);
    expect(out[0]!.attributableUsd).toBe(3000);
    expect(out.find((r) => r.motif === 'read-whole-then-reread')!.evidence[0]).toContain('big.ts');
  });

  it('single-ownership: a repeat AND oversized event is counted once under motif 1', () => {
    const events = [ev({ path: 'f.ts', tokens: 400, repeat: true, oversized: true })];
    const out = attributeRootCauses(events, idUsd);
    expect(out).toHaveLength(1);
    expect(out[0]!.motif).toBe('read-whole-then-reread');
    // invariant: total attributed == the single event's tokens, never doubled
    const total = out.reduce((s, r) => s + r.attributableTokens, 0);
    expect(total).toBe(400);
  });

  it('invariant: Σ attributableTokens ≤ Σ waste-event tokens on a mixed fixture', () => {
    const events = [
      ev({ path: 'a', tokens: 200, repeat: true, oversized: true, exploratory: true }),
      ev({ path: 'b', tokens: 150, oversized: true, exploratory: true }),
      ev({ path: 'c', tokens: 80, sliced: true }),          // clean → 0
      ev({ kind: 'agent', tokens: 1500 }),                   // under budget → 0
    ];
    const out = attributeRootCauses(events, idUsd);
    const attributed = out.reduce((s, r) => s + r.attributableTokens, 0);
    const totalEventTokens = events.reduce((s, e) => s + e.tokens, 0);
    expect(attributed).toBeLessThanOrEqual(totalEventTokens);
    expect(attributed).toBe(200 + 150); // a→motif1(200), b→motif2(150), c/agent→0
  });

  it('agent return under budget contributes nothing', () => {
    const events = [ev({ kind: 'agent', tokens: SUBAGENT_RETURN_BUDGET_TOKENS })];
    expect(attributeRootCauses(events, idUsd)).toEqual([]);
  });
});
