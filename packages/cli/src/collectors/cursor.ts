// Recursively sum every finite number under an object (robust to unknown
// promptTokenBreakdown sub-field names across Cursor versions).
function sumNumericLeaves(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v && typeof v === 'object') {
    let total = 0;
    for (const val of Object.values(v as Record<string, unknown>)) total += sumNumericLeaves(val);
    return total;
  }
  return 0;
}

/**
 * Parse decoded cursorDiskKV `composerData:*` value strings. Cursor records
 * per-conversation INPUT tokens at `composerData.promptTokenBreakdown`; output
 * and cache are not stored locally. Returns the input-token lower bound and the
 * count of conversations that carried a breakdown.
 */
export function parseCursorValues(values: string[]): { inputTokens: number; conversations: number } {
  let inputTokens = 0;
  let conversations = 0;
  for (const raw of values) {
    let obj: unknown;
    try { obj = JSON.parse(raw); } catch { continue; }
    const breakdown = (obj as { promptTokenBreakdown?: unknown })?.promptTokenBreakdown;
    if (!breakdown || typeof breakdown !== 'object') continue;
    inputTokens += sumNumericLeaves(breakdown);
    conversations++;
  }
  return { inputTokens, conversations };
}
