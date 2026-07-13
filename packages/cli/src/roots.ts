import { realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ScanContext } from './types.js';

/**
 * Where one agent keeps its logs.
 *
 * The single-home assumption breaks on real multi-agent rigs: people relocate
 * their agents (C:\agents\Claude\.claude, C:\agents\codex\data, ...), and every
 * collector that hardcodes `join(ctx.home, '.codex')` goes blind. So a collector
 * declares WHERE it lives, and this resolves that against every known home plus
 * the agent's own relocation env var.
 *
 * New collectors: take this contract from day one rather than reaching for
 * ctx.home directly.
 */
export interface RootSpec {
  /** Path segments under an agent home, e.g. ['.claude', 'projects']. */
  under: string[];
  /**
   * The env var the agent itself uses to relocate its config dir — CODEX_HOME,
   * CLAUDE_CONFIG_DIR. It points AT the config dir (…/.claude), not at the home
   * above it, which is why it needs its own sub-path.
   */
  env?: string;
  /** Segments under the env-pointed dir, e.g. ['projects']. */
  envUnder?: string[];
}

const isDir = async (p: string): Promise<boolean> => stat(p).then((s) => s.isDirectory(), () => false);

/**
 * Canonical key for dedup. Two mounts of the same directory must not be counted
 * twice — and they arrive here as different strings: a repeated --agent-home, a
 * home that is also passed explicitly, a junction, a case-different Windows path.
 */
async function canonical(p: string): Promise<string> {
  let out = resolve(p);
  try {
    out = await realpath(out);
  } catch {
    /* not yet on disk — resolve() is the best we can do */
  }
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

/** Every home this run knows about: the OS home, then any extra --agent-home. */
export function agentHomes(ctx: ScanContext): string[] {
  return [ctx.home, ...(ctx.agentHomes ?? [])];
}

/**
 * Existing log dirs for one agent, deduped. Order is stable: the OS home first,
 * then extra homes in the order given, then the env override.
 */
export async function resolveRoots(ctx: ScanContext, spec: RootSpec): Promise<string[]> {
  const env = ctx.env ?? process.env;
  const candidates = agentHomes(ctx).map((h) => join(h, ...spec.under));

  const relocated = spec.env ? env[spec.env] : undefined;
  if (relocated) candidates.push(join(relocated, ...(spec.envUnder ?? [])));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = await canonical(c);
    if (seen.has(key)) continue;
    seen.add(key);
    if (await isDir(c)) out.push(c);
  }
  return out;
}

/** Parse a PATH-style list (VIBERULER_AGENT_HOMES), tolerating both separators. */
export function parseHomeList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;:]/)
    // A Windows drive letter — "C:\agents" — must not be split into "C" and "\agents".
    .reduce<string[]>((acc, part) => {
      const prev = acc[acc.length - 1];
      if (prev !== undefined && /^[a-zA-Z]$/.test(prev) && /^[\\/]/.test(part)) {
        acc[acc.length - 1] = `${prev}:${part}`;
        return acc;
      }
      acc.push(part);
      return acc;
    }, [])
    .map((s) => s.trim())
    .filter(Boolean);
}
