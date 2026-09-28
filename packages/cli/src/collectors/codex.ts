import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, CodexLimits, LimitWindow, TokenUsage } from '../types.js';
import { costForUsage, hasKnownPrice } from '../pricing.js';
import { resolveRoots, type RootSpec } from '../roots.js';

/** The rate the table falls back to when a Codex session names a model it does not know. */
export const CODEX_FALLBACK_MODEL = 'codex-default';

export interface CodexSession {
  /** Token usage attributed to the model that was active when it was spent. */
  byModel: Map<string, TokenUsage>;
  total: TokenUsage;
  /** The session's last `rate_limits` record, if Codex logged one with a timestamp. */
  limits: Omit<CodexLimits, 'root'> | null;
}

function limitWindow(w: unknown): LimitWindow | null {
  const o = w as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown } | null;
  if (!o || typeof o.used_percent !== 'number' || typeof o.resets_at !== 'number') return null;
  return {
    usedPercent: o.used_percent,
    windowMinutes: typeof o.window_minutes === 'number' ? o.window_minutes : 0,
    resetsAt: new Date(o.resets_at * 1000).toISOString(),
  };
}

interface CumulativeUsage {
  input: number;
  cached: number;
  output: number;
}

const zero = (): TokenUsage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

function add(into: TokenUsage, u: TokenUsage): void {
  into.input += u.input;
  into.output += u.output;
  into.cacheWrite += u.cacheWrite;
  into.cacheRead += u.cacheRead;
}

/**
 * One rollout file → usage per model.
 *
 * Two traps, both of which used to inflate the numbers:
 * - `total_token_usage` is CUMULATIVE within a session, so the session total is
 *   the last record, and a model is charged the DELTA between consecutive records
 *   (a session can switch models mid-way via `turn_context`).
 * - `cached_input_tokens` is PART of `input_tokens`, not an addition to it
 *   (`total_tokens` = input + output). Fresh input = input − cached. Adding them
 *   counted every cached token twice — once at the full input rate.
 */
export function parseCodexSession(content: string): CodexSession | null {
  const byModel = new Map<string, TokenUsage>();
  let model = CODEX_FALLBACK_MODEL;
  let prev: CumulativeUsage = { input: 0, cached: 0, output: 0 };
  let seen = false;
  let limits: CodexSession['limits'] = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // malformed line — skip
    }
    if (obj?.type === 'turn_context' && typeof obj?.payload?.model === 'string' && obj.payload.model) {
      model = obj.payload.model;
      continue;
    }
    if (obj?.payload?.type !== 'token_count') continue;
    const rl = obj.payload.rate_limits;
    const observed = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN;
    // A snapshot without a timestamp can't say how stale it is — skip it rather than guess.
    if (rl && !Number.isNaN(observed)) {
      const primary = limitWindow(rl.primary);
      const secondary = limitWindow(rl.secondary);
      if (primary || secondary) {
        limits = {
          plan: typeof rl.plan_type === 'string' ? rl.plan_type : null,
          primary,
          secondary,
          observedAt: new Date(observed).toISOString(),
        };
      }
    }
    const t = obj.payload.info?.total_token_usage;
    if (!t) continue;
    const cur: CumulativeUsage = {
      input: t.input_tokens ?? 0,
      cached: t.cached_input_tokens ?? 0,
      output: t.output_tokens ?? 0,
    };
    const dIn = Math.max(cur.input - prev.input, 0);
    const dCached = Math.min(Math.max(cur.cached - prev.cached, 0), dIn);
    const dOut = Math.max(cur.output - prev.output, 0);
    const bucket = byModel.get(model) ?? zero();
    add(bucket, { input: dIn - dCached, output: dOut, cacheWrite: 0, cacheRead: dCached });
    byModel.set(model, bucket);
    prev = cur;
    seen = true;
  }
  if (!seen && !limits) return null;
  const total = zero();
  for (const u of byModel.values()) add(total, u);
  return { byModel, total, limits };
}

/** Session total only — kept for callers that do not care which model spent it. */
export function parseCodexJsonl(content: string): TokenUsage | null {
  const s = parseCodexSession(content);
  return s && s.byModel.size > 0 ? s.total : null;
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

// CODEX_HOME points at the .codex dir itself, so its sub-path is just 'sessions'.
const SESSIONS: RootSpec = {
  under: ['.codex', 'sessions'],
  env: 'CODEX_HOME',
  envUnder: ['sessions'],
};

export const codexCollector: Collector = {
  id: 'codex',
  async detect(ctx) {
    return (await resolveRoots(ctx, SESSIONS)).length > 0;
  },
  async collect(ctx) {
    const tokens = zero();
    let costUsd = 0;
    const unpriced = new Map<string, number>();
    const codexLimits: CodexLimits[] = [];
    // Roots are deduped upstream, so the same session file cannot be walked twice.
    for (const root of await resolveRoots(ctx, SESSIONS)) {
      let latest: CodexLimits | null = null;
      for await (const file of walkJsonl(root)) {
        let s: CodexSession | null;
        try {
          s = parseCodexSession(await readFile(file, 'utf8'));
        } catch {
          continue; // unreadable file — skip
        }
        if (!s) continue;
        // Newest record per home wins: each home is one account, and only the
        // latest snapshot says anything about the headroom left now.
        if (s.limits && (!latest || s.limits.observedAt > latest.observedAt)) {
          latest = { root, ...s.limits };
        }
        for (const [model, u] of s.byModel) {
          add(tokens, u);
          const known = model !== CODEX_FALLBACK_MODEL && hasKnownPrice(model);
          if (!known && model !== CODEX_FALLBACK_MODEL) {
            unpriced.set(model, (unpriced.get(model) ?? 0) + u.input + u.output + u.cacheRead);
          }
          costUsd += costForUsage(known ? model : CODEX_FALLBACK_MODEL, u);
        }
      }
      if (latest) codexLimits.push(latest);
    }
    const warnings = [...unpriced].map(
      ([m, n]) => `codex: model "${m}" is not in the price table — ${n.toLocaleString('en-US')} tokens priced at ${CODEX_FALLBACK_MODEL}`,
    );
    return { tokens, costUsd, sources: ['codex'], warnings, ...(codexLimits.length ? { codexLimits } : {}) };
  },
};
