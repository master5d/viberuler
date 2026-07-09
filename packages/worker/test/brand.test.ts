import { describe, it, expect } from 'vitest';
import { PALETTE, SEAL_SVG, guillocheCss, gaugeHtml, rankForVibe, certifyLine, SCALE_LABELS, GAUGE_CELLS } from '../src/brand.js';

const filled = (v: number) => Math.max(0, Math.min(GAUGE_CELLS, Math.round((v / 8000) * GAUGE_CELLS)));

describe('brand', () => {
  it('palette has the frozen hexes', () => {
    expect(PALETTE.violet).toBe('#b388ff');
    expect(PALETTE.green).toBe('#69f0ae');
    expect(PALETTE.amber).toBe('#ffd54f');
    expect(PALETTE.base).toBe('#0b0e14');
  });

  it('full seal carries ring text and a gradient', () => {
    const svg = SEAL_SVG(200);
    expect(svg).toContain('<svg');
    expect(svg).toContain('BUREAU OF VIBE MEASUREMENT');
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('CERTIFIED');
  });

  it('favicon seal drops ring text but keeps the VR mark', () => {
    const svg = SEAL_SVG(64, { ring: false });
    expect(svg).toContain('>VR<');
    expect(svg).not.toContain('BUREAU OF VIBE MEASUREMENT');
  });

  it('guilloche css defines the paper class', () => {
    expect(guillocheCss()).toContain('.paper');
  });

  it('gauge fill count tracks the shared math', () => {
    for (const v of [0, 2000, 5343, 8000, 12000]) {
      const html = gaugeHtml(v);
      const cells = (html.match(/data-cell="fill"/g) ?? []).length;
      expect(cells).toBe(filled(v));
    }
  });

  it('sus gauge shows the review band and no number', () => {
    const html = gaugeHtml(5343, { sus: true });
    expect(html).toContain('UNDER REVIEW');
    expect(html).not.toContain('5,343');
    expect(html).not.toContain('5343');
  });

  it('gauge renders the fixed absurd scale', () => {
    const html = gaugeHtml(5343);
    for (const label of SCALE_LABELS) expect(html).toContain(label);
    expect(SCALE_LABELS[0]).toBe('hello world');
    expect(SCALE_LABELS[SCALE_LABELS.length - 1]).toBe('AGI (by accident)');
  });

  it('compact gauge shows only 3 labels (endpoints + midpoint) so fixed-width rasters do not collide', () => {
    const html = gaugeHtml(5343, { compact: true });
    expect(html).toContain('hello world');
    expect(html).toContain('a wrapper');
    expect(html).toContain('AGI (by accident)');
    expect(html).not.toContain('a CRUD app');
    expect(html).not.toContain('another wrapper');
    expect(html).not.toContain('an AI startup');
  });

  // RANK_TABLE thresholds duplicated here as fixture — SOURCE OF TRUTH is
  // packages/cli/src/score.ts RANK_TABLE. If this drifts, fix brand.ts to match score.ts.
  it('rankForVibe agrees with score.ts RANK_TABLE at boundaries', () => {
    expect(rankForVibe(8000)).toBe('Singularity Adjacent');
    expect(rankForVibe(6500)).toBe('GIGACHAD SHIPPER');
    expect(rankForVibe(5000)).toBe('Ship Machine');
    expect(rankForVibe(3500)).toBe('Context Goblin');
    expect(rankForVibe(2000)).toBe('Token Burner');
    expect(rankForVibe(800)).toBe('Vibe Apprentice');
    expect(rankForVibe(0)).toBe('Prompt Peasant');
  });

  it('certify line uppercases the rank', () => {
    expect(certifyLine('Ship Machine')).toBe('The Bureau certifies: SHIP MACHINE');
  });
});
