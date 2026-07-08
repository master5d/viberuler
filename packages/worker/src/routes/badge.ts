import type { Env } from '../index.js';
import { json } from '../index.js';
import { totals } from '../db.js';

export function fmtCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

export async function handleBadge(_req: Request, env: Env): Promise<Response> {
  const t = await totals(env.DB);
  return json(
    { schemaVersion: 1, label: 'tokens benchmarked', message: fmtCompact(t.tokens), color: 'blueviolet' },
    200,
    { 'cache-control': 'public, max-age=300' },
  );
}
