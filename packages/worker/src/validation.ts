import { z } from 'zod';

export const KNOWN_ACHIEVEMENTS = [
  'token-billionaire', 'free-tier-martyr', 'cache-whisperer', 'polyglot',
  'monorepo-menace', 'streak-freak', '3am-committer', 'yolo-force-pusher',
] as const;

export const submitPayloadSchema = z
  .object({
    client_version: z.string().max(20),
    vibe_score: z.number().nonnegative(),
    loc: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    cost_usd: z.number().nonnegative(),
    tok_per_usd: z.number().nonnegative().nullable(),
    tok_per_loc: z.number().nonnegative().nullable().optional(),
    achievements: z.array(z.string().max(40)).max(32),
    breakdown: z.record(z.string().max(40), z.number()),
  })
  .strict();

export type SubmitPayload = z.infer<typeof submitPayloadSchema>;

const KNOWN = new Set<string>(KNOWN_ACHIEVEMENTS);

export function susReason(p: SubmitPayload): string | null {
  if (p.loc > 50_000_000) return 'loc';
  if (p.tokens > 100_000_000_000) return 'tokens';
  if (p.tokens > 1_000_000 && p.cost_usd < 0.01) return 'cost';
  if (p.tok_per_usd !== null && p.tok_per_usd > 100_000_000) return 'efficiency';
  if (p.vibe_score > 50_000) return 'vibe';
  if (p.achievements.some((a) => !KNOWN.has(a))) return 'achievements';
  return null;
}
