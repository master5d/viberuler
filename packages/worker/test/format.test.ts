import { describe, expect, it } from 'vitest';
import { fmtCompact, fmtInt } from '../src/format.js';

/**
 * Общий модуль форматирования воркера (заведён 2026-08-24).
 *
 * До него fmtCompact экспортировался из routes/badge.ts, импортировался в
 * routes/home.ts и был ЗАНОВО написан в routes/story.ts — причём версия story.ts
 * была лучше (умела отрицательные), и это улучшение никуда не доехало. fmtInt при
 * этом жил стрелкой в ПЯТИ файлах: card.ts, home.ts, og.ts, story.ts, share.ts.
 *
 * Сверка с намеренной межпакетной копией CLI живёт в packages/cli/test/format-drift.test.ts:
 * там Node-рантайм с node-типами, а здесь Workers — первая версия сверки, написанная
 * в этом пакете, молча не находила файл соседа и скипалась.
 */
describe('fmtCompact', () => {
  it('масштабирует до K/M/B', () => {
    expect(fmtCompact(950)).toBe('950');
    expect(fmtCompact(12_300)).toBe('12.3K');
    expect(fmtCompact(6_500_000)).toBe('6.5M');
    expect(fmtCompact(1_234_000_000)).toBe('1.2B');
  });

  it('держит отрицательные — ради этого копии и разошлись', () => {
    expect(fmtCompact(-6_500_000)).toBe('-6.5M');
    expect(fmtCompact(-1234)).toBe('-1.2K');
    expect(fmtCompact(-950)).toBe('-950');
  });

  it('срезает хвост .0', () => {
    expect(fmtCompact(1000)).toBe('1K');
    expect(fmtCompact(2e6)).toBe('2M');
  });
});

describe('fmtInt', () => {
  it('ставит разделители групп и округляет', () => {
    expect(fmtInt(1_234_567)).toBe('1,234,567');
    expect(fmtInt(999.6)).toBe('1,000');
  });
});
