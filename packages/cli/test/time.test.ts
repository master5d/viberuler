import { describe, it, expect } from 'vitest';
import { analyzeTimestamps, timeEventsFromClaudeJsonl } from '../src/time.js';

describe('analyzeTimestamps', () => {
  it('dense chain (every interval <= gap) -> activeMs === wallMs', () => {
    const tsMs = [1000, 2000, 3000, 4000];
    const gapMs = 1500;
    const res = analyzeTimestamps(tsMs, gapMs);
    expect(res).toEqual({ wallMs: 3000, activeMs: 3000 });
  });

  it('one interval above gap -> excluded from activeMs', () => {
    const tsMs = [1000, 2000, 10000, 11000];
    const gapMs = 2000;
    // Intervals: 1000 (<=2000 -> active), 8000 (>2000 -> excluded), 1000 (<=2000 -> active)
    // total wallMs = 11000 - 1000 = 10000
    // activeMs = 1000 + 1000 = 2000
    const res = analyzeTimestamps(tsMs, gapMs);
    expect(res).toEqual({ wallMs: 10000, activeMs: 2000 });
  });

  it('fewer than 2 events -> { wallMs: 0, activeMs: 0 }', () => {
    expect(analyzeTimestamps([], 5000)).toEqual({ wallMs: 0, activeMs: 0 });
    expect(analyzeTimestamps([1000], 5000)).toEqual({ wallMs: 0, activeMs: 0 });
  });

  it('unsorted input handled (sorted internally) without mutating caller array', () => {
    const input = [3000, 1000, 4000, 2000];
    const inputCopy = [...input];
    const gapMs = 1500;
    const res = analyzeTimestamps(input, gapMs);
    expect(res).toEqual({ wallMs: 3000, activeMs: 3000 });
    expect(input).toEqual(inputCopy); // caller's array not mutated
  });

  it('negative skew (duplicate/backwards timestamps) -> clamps, never negative', () => {
    const tsMs = [1000, 1000, 500]; // after sorting: [500, 1000, 1000] -> diffs: 500, 0
    const gapMs = 1000;
    const res = analyzeTimestamps(tsMs, gapMs);
    expect(res.wallMs).toBeGreaterThanOrEqual(0);
    expect(res.activeMs).toBeGreaterThanOrEqual(0);
    expect(res).toEqual({ wallMs: 500, activeMs: 500 });
  });
});

describe('timeEventsFromClaudeJsonl', () => {
  it('extracts ts+cwd, skips malformed lines and entries without timestamp, cwd null when absent', () => {
    const jsonl = [
      '{"timestamp":"2026-07-26T12:00:00.000Z","cwd":"/projects/app","user":"alice"}',
      'this is malformed json {{{',
      '{"cwd":"/projects/app"}', // no timestamp
      '{"timestamp":"not-a-valid-date","cwd":"/projects/app"}', // invalid timestamp
      '{"timestamp":"2026-07-26T12:05:00.000Z"}', // cwd absent
      '{"timestamp":"2026-07-26T12:10:00.000Z","cwd":12345}', // non-string cwd -> null
      '',
    ].join('\n');

    const res = timeEventsFromClaudeJsonl(jsonl);
    expect(res).toEqual([
      { ts: Date.parse('2026-07-26T12:00:00.000Z'), cwd: '/projects/app' },
      { ts: Date.parse('2026-07-26T12:05:00.000Z'), cwd: null },
      { ts: Date.parse('2026-07-26T12:10:00.000Z'), cwd: null },
    ]);
  });
});
