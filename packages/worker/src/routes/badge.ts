import type { Env } from '../index.js';
import { json } from '../index.js';
import { totals } from '../db.js';
import { fmtCompact } from '../format.js';


export async function handleBadge(_req: Request, env: Env): Promise<Response> {
  const t = await totals(env.DB);
  return json(
    { schemaVersion: 1, label: 'tokens benchmarked', message: fmtCompact(t.tokens), color: 'blueviolet' },
    200,
    { 'cache-control': 'public, max-age=300' },
  );
}
