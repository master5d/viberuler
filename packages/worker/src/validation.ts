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

// Server-side plausibility scoring — stateful checks the static caps in susReason
// can't make. Thresholds are intentionally generous (flag the blatant, not the
// merely impressive) and are documented verbatim in METHODOLOGY §6.
export const PLAUSIBILITY = {
  newAccountDays: 7,          // "brand new" GitHub account
  newAccountTokenCeil: 1_000_000_000,
  tokenRatePerDayCeil: 2_000_000_000, // tokens per day of account age
  velocityWindowHours: 24,
  velocityTokenJump: 5_000_000_000,   // token increase vs previous submit in-window
} as const;

export interface PlausibilityContext {
  accountAgeDays: number | null;                          // null when gh_created_at unknown
  previous: { tokens: number; submittedAt: string } | null;
  now: string;                                            // ISO timestamp (server-supplied)
}

export function plausibilityReason(p: SubmitPayload, ctx: PlausibilityContext): string | null {
  // 1. breakdown must sum to ~vibe_score (catches a hand-bumped vibe_score)
  const bsum = Object.values(p.breakdown).reduce((a, b) => a + b, 0);
  if (p.vibe_score > 0 && Math.abs(bsum - p.vibe_score) > Math.max(50, p.vibe_score * 0.05)) {
    return 'inconsistent-breakdown';
  }
  // 2. tok_per_usd must match tokens/cost when both are present
  if (p.tok_per_usd !== null && p.cost_usd > 0) {
    const derived = p.tokens / p.cost_usd;
    if (Math.abs(derived - p.tok_per_usd) > derived * 0.1 + 1) return 'inconsistent-efficiency';
  }
  // 3. brand-new account claiming enormous volume
  if (ctx.accountAgeDays !== null && ctx.accountAgeDays < PLAUSIBILITY.newAccountDays &&
      p.tokens > PLAUSIBILITY.newAccountTokenCeil) {
    return 'new-account-volume';
  }
  // 4. superhuman token accumulation rate for the account's age
  if (ctx.accountAgeDays !== null && ctx.accountAgeDays >= 1 &&
      p.tokens / ctx.accountAgeDays > PLAUSIBILITY.tokenRatePerDayCeil) {
    return 'token-rate';
  }
  // 5. implausible token jump since the previous submit within a short window
  if (ctx.previous) {
    const dHours = (Date.parse(ctx.now) - Date.parse(ctx.previous.submittedAt)) / 3_600_000;
    if (dHours >= 0 && dHours < PLAUSIBILITY.velocityWindowHours &&
        p.tokens - ctx.previous.tokens > PLAUSIBILITY.velocityTokenJump) {
      return 'velocity';
    }
  }
  return null;
}
