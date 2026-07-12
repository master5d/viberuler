import { createColors } from 'picocolors';
import type { AuditReport } from './audit.js';
import { railCard } from './render.js';
import { fmtCompact, fmtInt, fmtUsd } from './format.js';

const TOP_TOOLS = 8;

export function renderAudit(r: AuditReport, opts: { colors: boolean; version: string }): string {
  const c = createColors(opts.colors);
  const rows: string[] = [];

  rows.push(c.bold(c.magenta(`VIBERULER v${opts.version} — RIG AUDIT`)));
  rows.push(c.dim('· bureau of vibe measurement'));
  rows.push('');

  if (r.sessions === 0) {
    rows.push(c.dim('No Claude Code transcripts found on this rig.'));
    rows.push(c.dim('Nothing to audit.'));
    return railCard(rows, opts.colors);
  }

  // 1. Token economy — what caching is actually buying you.
  const saved = r.costNoCacheUsd - r.costUsd;
  rows.push(c.bold('TOKEN ECONOMY'));
  rows.push(`  ${c.bold(fmtInt(r.sessions))} sessions · ${c.bold(fmtCompact(r.inputSideTokens + r.tokens.output))} tokens`);
  rows.push(`  🗄️  cache hit ${c.bold(`${r.cacheHitPct.toFixed(1)}%`)}`);
  rows.push(`  💸 ${c.bold(fmtUsd(r.costUsd))} spent · ${c.bold(fmtUsd(r.costNoCacheUsd))} without caching`);
  if (saved > 0) rows.push(`  ✅ caching saved ${c.bold(c.green(fmtUsd(saved)))}`);
  rows.push('');

  // 2. Context amplification — why every admitted token costs ~Nx.
  if (r.amplification > 0) {
    rows.push(c.bold('CONTEXT AMPLIFICATION'));
    rows.push(`  ${c.bold(fmtCompact(r.admittedTokens))} tokens admitted by tools`);
    rows.push(`  ↳ re-read ${c.bold(c.yellow(`${r.amplification.toFixed(0)}×`))} on average (${fmtCompact(r.inputSideTokens)} input-side)`);
    rows.push(c.dim('  every token you let in is paid for again on every later turn'));
    rows.push('');
  }

  // 3. Where the context actually comes from.
  const top = r.tools.slice(0, TOP_TOOLS);
  if (top.length > 0) {
    rows.push(c.bold('TOP TOOLS'));
    const width = Math.max(...top.map((t) => t.name.length));
    for (const t of top) {
      rows.push(
        `  ${t.name.padEnd(width)}  ${String(t.calls).padStart(6)} calls  ${fmtCompact(t.resultTokens).padStart(7)} tok`,
      );
    }
    rows.push('');
  }

  // 4. The point of the audit: loaded every session, never called.
  if (r.dead.length > 0) {
    rows.push(c.bold(c.red('☠️  DEAD WEIGHT')));
    for (const d of r.dead) {
      rows.push(`  ${c.red('✗')} ${c.bold(d.name)} ${c.dim(`(${d.kind})`)} — 0 calls`);
    }
    rows.push(
      c.dim(`  ${r.dead.length} of ${r.surfaces.length} MCP surfaces never called. Each still spawns a`),
    );
    rows.push(c.dim('  server process and injects tool schemas on every session.'));
    // Precision matters: a plugin can ship hooks/skills that work hard while its
    // MCP tools sit idle. Only the MCP surface is measured here.
    rows.push(c.dim('  Note: this measures MCP tools only — a plugin\'s hooks and'));
    rows.push(c.dim('  skills may still be earning their keep.'));
  } else if (r.surfaces.length > 0) {
    rows.push(`${c.green('✅')} all ${c.bold(String(r.surfaces.length))} MCP surfaces earn their keep`);
  }

  rows.push('');
  rows.push(c.dim('— The Bureau · calibrated to ±0.001 vibes'));
  return railCard(rows, opts.colors);
}
