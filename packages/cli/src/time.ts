/**
 * Pure functions for analyzing timestamp metrics and parsing time events from Claude JSONL logs.
 */

export function analyzeTimestamps(
  tsMs: number[],
  gapMs: number
): { wallMs: number; activeMs: number } {
  if (tsMs.length < 2) {
    return { wallMs: 0, activeMs: 0 };
  }

  const sorted = [...tsMs].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    return { wallMs: 0, activeMs: 0 };
  }

  const wallMs = Math.max(0, last - first);

  let activeMs = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (curr !== undefined && next !== undefined) {
      const diff = next - curr;
      const clampedDiff = Math.max(0, diff);
      if (clampedDiff <= gapMs) {
        activeMs += clampedDiff;
      }
    }
  }

  return { wallMs, activeMs };
}

export function timeEventsFromClaudeJsonl(
  content: string
): { ts: number; cwd: string | null }[] {
  const lines = content.split('\n');
  const results: { ts: number; cwd: string | null }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof parsed.timestamp === 'string') {
          const ts = Date.parse(parsed.timestamp);
          if (!Number.isNaN(ts)) {
            const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : null;
            results.push({ ts, cwd });
          }
        }
      }
    } catch {
      // skip malformed lines silently
    }
  }

  return results;
}
