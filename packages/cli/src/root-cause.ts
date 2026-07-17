// packages/cli/src/root-cause.ts

/** One tool result that could be waste: a non-side Read, or an Agent return. */
export interface WasteEvent {
  /** File path for reads; '' for agent returns. */
  path: string;
  /** Result size in tokens. */
  tokens: number;
  kind: 'read' | 'agent';
  /** Result exceeded the oversized threshold. */
  oversized: boolean;
  /** The Read used offset/limit (disciplined). */
  sliced: boolean;
  /** Identical-size re-read of the same path — the second+ read bought nothing. */
  repeat: boolean;
  /** Whole-file read of a path never subsequently edited (set post-parse). */
  exploratory: boolean;
}

export type Motif =
  | 'read-whole-then-reread'
  | 'oversized-unslice'
  | 'explore-wide-use-narrow'
  | 'subagent-result-bloat';

export interface RootCause {
  motif: Motif;
  /** Human root cause. */
  rootCause: string;
  /** Concrete fix. */
  fix: string;
  attributableTokens: number;
  attributableUsd: number;
  /** Top offending paths/counts, for traceability. */
  evidence: string[];
}

/** A subagent return under this many tokens is not waste; only the excess is attributed. */
export const SUBAGENT_RETURN_BUDGET_TOKENS = 2000;

const META: Record<Motif, { rootCause: string; fix: string }> = {
  'read-whole-then-reread': {
    rootCause: 're-read an unchanged file you had already read whole',
    fix: 'slice large reads (offset/limit); trust the first read',
  },
  'oversized-unslice': {
    rootCause: 'pulled a huge result whole instead of slicing',
    fix: 'use head_limit/offset; paginate large reads',
  },
  'explore-wide-use-narrow': {
    rootCause: 'read files you never edited',
    fix: 'outline/grep first; read only what you will touch',
  },
  'subagent-result-bloat': {
    rootCause: 'subagents returned large results into the parent context',
    fix: 'have subagents return files/summaries, not full dumps',
  },
};

/** Precedence 1>2>3 for reads; agents scored separately. Single-ownership by construction. */
function ownerOf(e: WasteEvent): Motif | null {
  if (e.kind === 'agent') return null; // handled separately (budget excess)
  if (e.repeat) return 'read-whole-then-reread';
  if (e.oversized && !e.sliced) return 'oversized-unslice';
  if (e.exploratory) return 'explore-wide-use-narrow';
  return null;
}

export function attributeRootCauses(
  events: WasteEvent[],
  tokensToUsd: (t: number) => number,
): RootCause[] {
  const buckets = new Map<Motif, { tokens: number; paths: Map<string, number> }>();
  const add = (m: Motif, tokens: number, path: string): void => {
    let b = buckets.get(m);
    if (!b) {
      b = { tokens: 0, paths: new Map() };
      buckets.set(m, b);
    }
    b.tokens += tokens;
    if (path) b.paths.set(path, (b.paths.get(path) ?? 0) + tokens);
  };

  for (const e of events) {
    if (e.kind === 'agent') {
      const excess = Math.max(0, e.tokens - SUBAGENT_RETURN_BUDGET_TOKENS);
      if (excess > 0) add('subagent-result-bloat', excess, '');
      continue;
    }
    const m = ownerOf(e);
    if (m) add(m, e.tokens, e.path);
  }

  const out: RootCause[] = [];
  for (const [motif, b] of buckets) {
    if (b.tokens <= 0) continue;
    const evidence = [...b.paths.entries()]
      .sort((a, z) => z[1] - a[1])
      .slice(0, 3)
      .map(([p, t]) => `${p} (${t} tok)`);
    out.push({
      motif,
      rootCause: META[motif].rootCause,
      fix: META[motif].fix,
      attributableTokens: b.tokens,
      attributableUsd: tokensToUsd(b.tokens),
      evidence,
    });
  }
  out.sort((a, z) => z.attributableTokens - a.attributableTokens);
  return out;
}
