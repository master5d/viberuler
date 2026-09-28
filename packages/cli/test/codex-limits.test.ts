import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCodexSession, codexCollector } from '../src/collectors/codex.js';
import { formatCodexLimits } from '../src/render.js';
import { buildPayload } from '../src/payload.js';
import type { CodexLimits } from '../src/types.js';

// Shape copied from a real Codex rollout (2026-09-27), values changed.
const rlLine = (ts: string, used5h: number, usedWeek: number, resets5h: number, resetsWeek: number) =>
  JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 } },
      rate_limits: {
        limit_id: 'codex',
        primary: { used_percent: used5h, window_minutes: 300, resets_at: resets5h },
        secondary: { used_percent: usedWeek, window_minutes: 10080, resets_at: resetsWeek },
        credits: { has_credits: false, unlimited: false, balance: '0' },
        plan_type: 'plus',
      },
    },
  });

const T0 = Date.parse('2026-09-27T12:00:00.000Z');
const sec = (ms: number) => Math.floor(ms / 1000);

describe('Codex rate_limits', () => {
  it('keeps the LAST record of a session', () => {
    const s = parseCodexSession(
      [
        rlLine('2026-09-27T10:00:00.000Z', 5, 1, sec(T0 + 3_600_000), sec(T0 + 86_400_000)),
        rlLine('2026-09-27T11:00:00.000Z', 12, 2, sec(T0 + 3_600_000), sec(T0 + 86_400_000)),
      ].join('\n'),
    )!;
    expect(s.limits).toEqual({
      plan: 'plus',
      primary: { usedPercent: 12, windowMinutes: 300, resetsAt: new Date(T0 + 3_600_000).toISOString() },
      secondary: { usedPercent: 2, windowMinutes: 10080, resetsAt: new Date(T0 + 86_400_000).toISOString() },
      observedAt: '2026-09-27T11:00:00.000Z',
    });
  });

  it('ignores a record without a timestamp — its freshness is unknowable', () => {
    const line = JSON.parse(rlLine('x', 12, 2, 1, 2));
    delete line.timestamp;
    expect(parseCodexSession(JSON.stringify(line))!.limits).toBeNull();
  });

  it('reports the newest snapshot per Codex home and never invents one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vibe-codex-rl-'));
    const dir = join(home, '.codex', 'sessions', '2026', '09');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.jsonl'), rlLine('2026-09-27T09:00:00.000Z', 40, 9, sec(T0), sec(T0)));
    await writeFile(join(dir, 'b.jsonl'), rlLine('2026-09-27T11:30:00.000Z', 12, 2, sec(T0), sec(T0)));
    const r = await codexCollector.collect({ home, scanDirs: [] });
    expect(r.codexLimits).toHaveLength(1);
    expect(r.codexLimits![0]!.primary!.usedPercent).toBe(12);

    const bare = await mkdtemp(join(tmpdir(), 'vibe-codex-nolimits-'));
    const d2 = join(bare, '.codex', 'sessions');
    await mkdir(d2, { recursive: true });
    await writeFile(
      join(d2, 'c.jsonl'),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5, output_tokens: 1 } } } }),
    );
    // No record → no field. Absent data must never render as "0% used".
    expect((await codexCollector.collect({ home: bare, scanDirs: [] })).codexLimits).toBeUndefined();
  });
});

describe('formatCodexLimits', () => {
  const l: CodexLimits = {
    root: '/x',
    plan: 'plus',
    primary: { usedPercent: 12, windowMinutes: 300, resetsAt: new Date(T0 + (3 * 60 + 12) * 60_000).toISOString() },
    secondary: { usedPercent: 2, windowMinutes: 10080, resetsAt: new Date(T0 + 5 * 86_400_000).toISOString() },
    observedAt: new Date(T0 - 60_000).toISOString(),
  };

  it('prints used share and time to reset per window', () => {
    expect(formatCodexLimits(l, new Date(T0))).toBe(
      '⏳ Codex limits (plus) · 5h 12% used · resets in 3h 12m · week 2% used · resets in 5d',
    );
  });

  it('refuses to repeat a percentage for a window that has already reset', () => {
    expect(formatCodexLimits(l, new Date(T0 + 4 * 3_600_000))).toContain('5h reset since last seen');
  });

  it('stays out of the submit payload', () => {
    const report = {
      vibe: 1, rank: 'x', breakdown: {}, tokPerUsd: null, tokPerLoc: null, effPercentile: 0, achievements: [],
      stats: { tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, codexLimits: [l] },
    } as unknown as Parameters<typeof buildPayload>[0];
    expect(JSON.stringify(buildPayload(report, '0.0.0'))).not.toContain('plus');
  });
});
