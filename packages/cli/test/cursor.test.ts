import { describe, it, expect } from 'vitest';
import { parseCursorValues } from '../src/collectors/cursor.js';

describe('parseCursorValues', () => {
  it('sums the numeric leaves of promptTokenBreakdown per conversation', () => {
    const values = [
      JSON.stringify({ promptTokenBreakdown: { system: 1000, user: 2000, context: 500 }, other: 'ignored' }),
      JSON.stringify({ promptTokenBreakdown: { system: 300, fileContext: 700 } }),
    ];
    const r = parseCursorValues(values);
    expect(r.inputTokens).toBe(4500); // 3500 + 1000
    expect(r.conversations).toBe(2);
  });
  it('is robust to unknown sub-field names (sums whatever numbers are there)', () => {
    const values = [JSON.stringify({ promptTokenBreakdown: { futureFieldA: 10, nested: { deep: 5 }, label: 'x' } })];
    expect(parseCursorValues(values).inputTokens).toBe(15); // 10 + 5, string ignored
  });
  it('skips rows without a promptTokenBreakdown and malformed JSON', () => {
    const values = [
      JSON.stringify({ notABreakdown: { a: 1 } }),
      'not json at all',
      JSON.stringify({ promptTokenBreakdown: { a: 42 } }),
    ];
    const r = parseCursorValues(values);
    expect(r.inputTokens).toBe(42);
    expect(r.conversations).toBe(1);
  });
  it('returns zero for an empty input', () => {
    expect(parseCursorValues([])).toEqual({ inputTokens: 0, conversations: 0 });
  });
});
