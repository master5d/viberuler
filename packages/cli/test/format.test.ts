import { describe, it, expect } from 'vitest';
import { fmtInt, fmtCompact, fmtUsd } from '../src/format.js';

describe('formatters', () => {
  it('fmtInt adds thousands separators', () => {
    expect(fmtInt(312441)).toBe('312,441');
    expect(fmtInt(0)).toBe('0');
  });
  it('fmtCompact scales to K/M/B', () => {
    expect(fmtCompact(950)).toBe('950');
    expect(fmtCompact(6_500_000)).toBe('6.5M');
    expect(fmtCompact(1_234_000_000)).toBe('1.2B');
    expect(fmtCompact(12_300)).toBe('12.3K');
  });
  it('fmtUsd renders two decimals', () => {
    expect(fmtUsd(184.2)).toBe('$184.20');
    expect(fmtUsd(0)).toBe('$0.00');
  });
});
