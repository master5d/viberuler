import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fmtCompact, fmtInt } from '../src/format.js';

/**
 * Сверка НАМЕРЕННОЙ копии format между пакетами.
 *
 * Дубль `fmtCompact`/`fmtInt` между packages/cli и packages/worker — осознанное
 * решение, записанное в docs/superpowers/plans/2026-07-07-viberuler-worker.md:1094:
 * «duplicated locally (8 lines — do NOT import across packages)». Воркер не тянет
 * зависимости из CLI, и это правильно.
 *
 * Но намеренная копия ценна ровно до тех пор, пока она действительно копия. К
 * 2026-08-24 эти две разошлись, и никто не заметил: версия воркера брала Math.abs и
 * умела отрицательные (-6.5M), а версия CLI на отрицательном отдавала сырое
 * «-6500000». Хуже того, CLI компенсировал это вручную на месте вызова
 * (render-audit.ts: fmtSignedCompact сам берёт Math.abs) — обход жил рядом с
 * причиной и маскировал её.
 *
 * Тест живёт ЗДЕСЬ, а не в воркере: у воркера Workers-рантайм без node-типов и без
 * __dirname, и первая версия этой проверки там молча не находила файл. Скип честно
 * сказал «не проверено» — иначе я бы записал незапущенную сверку в зелёные.
 *
 * Сверяется ПОВЕДЕНИЕ, а не текст: исходники законно отличаются комментариями и
 * стилем шаблонных строк, а вот выход обязан совпадать на всех интересных величинах.
 * Файл соседа ЧИТАЕТСЯ, но не импортируется — граница пакетов не нарушена.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_FORMAT = resolve(HERE, '../../worker/src/format.ts');

const CASES = [
  0, 1, 950, -950, 999, 1000, -1000, 1234, -1234, 12_300,
  999_999, 1e6, -6_500_000, 6_500_000, 999_999_999, 1e9, 1_234_000_000, -1_234_000_000,
  0.4, -0.4, 1499, 1500,
];

function loadWorkerImpl(src: string, name: 'fmtCompact' | 'fmtInt'): (n: number) => string {
  const m = new RegExp(
    `export function ${name}\\(n: number\\): string \\{([\\s\\S]*?)\\n\\}`,
  ).exec(src);
  if (!m || m[1] === undefined) throw new Error(`не найдена функция ${name} в ${WORKER_FORMAT}`);
  const body = m[1].replace(/: number/g, '');
  // eslint-disable-next-line no-new-func
  return new Function('n', body) as (n: number) => string;
}

describe('намеренная копия format между cli и worker', () => {
  const present = existsSync(WORKER_FORMAT);

  it('пакет воркера найден — иначе сверка не выполнена, а не «прошла»', () => {
    // Явное утверждение вместо тихого скипа: если раскладка пакетов поедет, тест
    // обязан КРАСНЕТЬ. Ровно на этом первая версия проверки и попалась — она
    // молча скипалась, потому что искала файл не там.
    expect(present, `не найден ${WORKER_FORMAT}`).toBe(true);
  });

  it('fmtCompact совпадает с копией воркера на всех величинах', () => {
    const impl = loadWorkerImpl(readFileSync(WORKER_FORMAT, 'utf8'), 'fmtCompact');
    for (const n of CASES) {
      expect(fmtCompact(n), `расхождение на ${n}`).toBe(impl(n));
    }
  });

  it('fmtInt совпадает с копией воркера на всех величинах', () => {
    const impl = loadWorkerImpl(readFileSync(WORKER_FORMAT, 'utf8'), 'fmtInt');
    for (const n of CASES) {
      expect(fmtInt(n), `расхождение на ${n}`).toBe(impl(n));
    }
  });
});

describe('fmtCompact на отрицательных', () => {
  it('держит знак и масштаб — ради этого копии и разошлись', () => {
    expect(fmtCompact(-6_500_000)).toBe('-6.5M');
    expect(fmtCompact(-1234)).toBe('-1.2K');
    expect(fmtCompact(-950)).toBe('-950');
  });
});
