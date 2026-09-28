import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENTS } from '../src/achievements.js';

/**
 * The worker marks a submission sus when it carries an achievement id it does not
 * know (packages/worker/src/validation.ts, KNOWN_ACHIEVEMENTS). high-roller and
 * table-hopper were added to the CLI on 2026-08-07 without landing there, and the
 * first 0.8.0 submit that earned them went "under review" (2026-09-28).
 *
 * The check lives on the CLI side for the same reason as format-drift.test.ts:
 * Node runtime, real fs. It reads the file directly and fails loudly if the file
 * moved — a drift check that cannot find its neighbour must not pass.
 */
const VALIDATION = fileURLToPath(new URL('../../worker/src/validation.ts', import.meta.url));

function knownOnServer(): string[] {
  const src = readFileSync(VALIDATION, 'utf8');
  const block = /KNOWN_ACHIEVEMENTS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src);
  if (!block) throw new Error(`KNOWN_ACHIEVEMENTS not found in ${VALIDATION}`);
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('achievement ids: CLI ⊆ worker allowlist', () => {
  it('every id the CLI can award is known to the server', () => {
    const known = new Set(knownOnServer());
    expect(known.size).toBeGreaterThan(0);
    const missing = ACHIEVEMENTS.map((a) => a.id).filter((id) => !known.has(id));
    expect(missing).toEqual([]);
  });
});
