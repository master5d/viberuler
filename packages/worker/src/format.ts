// Форматирование чисел для воркера — ОДНО место на весь пакет.
//
// Заведено 2026-08-24. До него внутри одного пакета жили копии, и они разъехались:
//   · fmtCompact — экспортировался из routes/badge.ts, импортировался в routes/home.ts,
//     и ЗАНОВО написан локально в routes/story.ts. Причём версия из story.ts была
//     ЛУЧШЕ: она берёт Math.abs, поэтому умеет отрицательные (-6.5M), а копия из
//     badge.ts на отрицательном отдавала сырое «-6500000». Улучшение так и не
//     доехало до соседнего файла;
//   · fmtInt — переписан стрелкой в ЧЕТЫРЁХ файлах (card.ts, home.ts, og.ts, story.ts).
//
// Межпакетный дубль с packages/cli/src/format.ts — ОСОЗНАННЫЙ и задокументированный
// (docs/superpowers/plans/2026-07-07-viberuler-worker.md:1094: «duplicated locally —
// do NOT import across packages»): воркер не тянет зависимости из CLI. Он и остаётся,
// но теперь под тестом-сверкой (test/format-drift.test.ts) — намеренная копия ценна
// только пока она действительно копия, а эти две уже успели разойтись.

/** Компактные числа для баннеров и таблиц: 10.9B, 450K, -6.5M. */
export function fmtCompact(n: number): string {
  // Порог берём по МОДУЛЮ: сравнение самого n отбрасывало все отрицательные значения
  // в ветку «как есть», и −6 500 000 печаталось как «-6500000» посреди компактных чисел.
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

/** Целые с разделителями групп: 1 234 567 → «1,234,567». */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
