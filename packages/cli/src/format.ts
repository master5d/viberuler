export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtCompact(n: number): string {
  // Порог по МОДУЛЮ. Раньше сравнивался сам n, и любое отрицательное значение
  // проваливалось в ветку «как есть»: -6 500 000 печаталось как «-6500000» посреди
  // компактных чисел. Копия в воркере (routes/story.ts) это уже чинила, но улучшение
  // жило только там — ровно то, чем платят за копипаст. Выровнено 2026-08-24, обе
  // намеренные копии держит тест-сверка packages/worker/test/format-drift.test.ts.
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
