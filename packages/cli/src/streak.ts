const DAY_MS = 86_400_000;

export function longestStreak(days: Iterable<string>): number {
  const stamps = [...new Set(days)]
    .map((d) => Date.parse(d + 'T00:00:00Z'))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (stamps.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < stamps.length; i++) {
    const cur = stamps[i]!;
    const prev = stamps[i - 1]!;
    run = cur - prev === DAY_MS ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}
