import { createColors } from 'picocolors';
import type { AuditReport } from './audit.js';
import { railCard } from './render.js';
import { fmtCompact, fmtInt, fmtUsd } from './format.js';
import type { RootCause } from './root-cause.js';
import { repriceMix } from './market.js';

const TOP_TOOLS = 8;

export function renderRootCauses(rootCauses: RootCause[]): string {
  if (!rootCauses.length) return '';
  const total = rootCauses.reduce((s, r) => s + r.attributableTokens, 0);
  const lines: string[] = [];
  lines.push('');
  lines.push('Root causes — structural attribution: these motifs precede the waste and');
  lines.push('are the most actionable fix — not proven causation.');
  for (const r of rootCauses) {
    lines.push('');
    lines.push(`  ${r.motif}  —  ${r.attributableTokens} tok  ($${r.attributableUsd.toFixed(4)})`);
    lines.push(`    cause: ${r.rootCause}`);
    lines.push(`    fix:   ${r.fix}`);
    for (const e of r.evidence) lines.push(`    · ${e}`);
  }
  lines.push('');
  lines.push(`  attributed ${total} tok across ${rootCauses.length} root cause(s).`);
  return lines.join('\n');
}

function fmtDuration(ms: number): string {
  if (ms >= 3600000) {
    return `${(ms / 3600000).toFixed(1)}h`;
  }
  const mins = Math.round(ms / 60000);
  if (mins === 0 && ms > 0) {
    return '<1m';
  }
  return `${mins}m`;
}

function fmtSignedCompact(n: number): string {
  if (n > 0) return `+${fmtCompact(n)}`;
  if (n < 0) return `-${fmtCompact(Math.abs(n))}`;
  return '0';
}

export function renderAudit(r: AuditReport, opts: { colors: boolean; version: string }): string {
  const c = createColors(opts.colors);
  const rows: string[] = [];

  rows.push(c.bold(c.magenta(`VIBERULER v${opts.version} — RIG AUDIT`)));
  rows.push(c.dim('· bureau of vibe measurement'));
  rows.push('');

  if (r.compare) {
    const comp = r.compare;
    rows.push(c.bold('CONTEXT WASTE — TWO WINDOWS'));
    const sA = comp.windows.a.since.slice(0, 10);
    const uA = comp.windows.a.until.slice(0, 10);
    const sB = comp.windows.b.since.slice(0, 10);
    const uB = comp.windows.b.until.slice(0, 10);
    rows.push(c.dim(`  window A: ${sA}..${uA}   window B: ${sB}..${uB}`));
    rows.push('');

    if (comp.warnings && comp.warnings.length > 0) {
      for (const w of comp.warnings) {
        if (w.includes('extends past now')) {
          rows.push(c.yellow(`  ⚠️  ${w}`));
          rows.push('');
        }
      }
    }

    if (comp.insufficient && comp.insufficient.length > 0) {
      if (comp.insufficient.includes('a')) {
        rows.push(c.dim(`  not enough data in window A (${comp.windows.a.sessions} sessions)`));
      }
      if (comp.insufficient.includes('b')) {
        rows.push(c.dim(`  not enough data in window B (${comp.windows.b.sessions} sessions)`));
      }
    } else if (comp.classes.length > 0) {
      const maxLabelLen = Math.max(...comp.classes.map((cls) => cls.label.length));
      const aStrs = comp.classes.map((cls) => `${fmtInt(cls.a.calls)} calls · ${fmtCompact(cls.a.tokens)} tok`);
      const bStrs = comp.classes.map((cls) => `${fmtInt(cls.b.calls)} calls · ${fmtCompact(cls.b.tokens)} tok`);
      const maxALen = Math.max(...aStrs.map((s) => s.length));
      const maxBLen = Math.max(...bStrs.map((s) => s.length));

      for (let i = 0; i < comp.classes.length; i++) {
        const cls = comp.classes[i]!;
        const aStr = aStrs[i]!;
        const bStr = bStrs[i]!;
        const deltaStr = fmtSignedCompact(cls.deltaTokens);
        rows.push(
          `  ${cls.label.padEnd(maxLabelLen)}   ${aStr.padStart(maxALen)} → ${bStr.padStart(maxBLen)}   (Δ ${deltaStr})`,
        );
      }
    } else {
      rows.push(c.dim('  no waste recorded in either window'));
    }

    // Total burn per window, stated as a fact. The multiple is workload growth
    // as much as anything — the note below already owns that caveat.
    if ((!comp.insufficient || comp.insufficient.length === 0) && (comp.windows.a.tokens > 0 || comp.windows.b.tokens > 0)) {
      const mult =
        comp.windows.a.tokens > 0 && comp.windows.b.tokens > 0
          ? `   (×${(comp.windows.b.tokens / comp.windows.a.tokens).toFixed(1)})`
          : '';
      rows.push('');
      rows.push(`  total burn: ${fmtCompact(comp.windows.a.tokens)} tok → ${fmtCompact(comp.windows.b.tokens)} tok${mult}`);
    }

    rows.push(c.dim('  classes overlap — an oversized read can also be exploratory; do not sum them'));
    rows.push(c.dim(`  ${comp.note}`));
    rows.push('');
    rows.push(c.dim('— The Bureau · calibrated to ±0.001 vibes'));
    return railCard(rows, opts.colors);
  }

  if (r.sessions === 0) {
    rows.push(c.dim('No Claude Code transcripts found on this rig.'));
    rows.push(c.dim('Nothing to audit.'));
    return railCard(rows, opts.colors);
  }

  // 1. Token economy — what caching is actually buying you.
  const saved = r.costNoCacheUsd - r.costUsd;
  rows.push(c.bold('TOKEN ECONOMY'));
  const totalTokens = r.main.inputSideTokens + r.sub.inputSideTokens + r.tokens.output;
  rows.push(`  ${c.bold(fmtInt(r.sessions))} sessions · ${c.bold(fmtCompact(totalTokens))} tokens`);
  rows.push(`  🗄️  cache hit ${c.bold(`${r.cacheHitPct.toFixed(1)}%`)}`);
  rows.push(`  💸 ${c.bold(fmtUsd(r.costUsd))} spent · ${c.bold(fmtUsd(r.costNoCacheUsd))} without caching`);
  if (saved > 0) rows.push(`  ✅ caching saved ${c.bold(c.green(fmtUsd(saved)))}`);
  rows.push('');

  if (r.time && r.time.totalActiveMs > 0) {
    const attentionStr = fmtDuration(r.time.totalActiveMs);
    const wallStr = fmtDuration(r.time.totalWallMs);
    const nDays = r.time.days.length;
    const daysStr = `(across ${nDays} ${nDays === 1 ? 'day' : 'days'})`;

    rows.push(
      `  ⏱  session time     ${c.bold(attentionStr)} attention · ${c.bold(wallStr)} wall ${c.dim(daysStr)}`,
    );

    if (r.time.projects.length > 0) {
      const top3 = r.time.projects.slice(0, 3);
      const rest = r.time.projects.slice(3);
      const items = top3.map((p) => `${p.name} ${fmtDuration(p.activeMs)}`);
      if (rest.length > 0) {
        const restMs = rest.reduce((sum, p) => sum + p.activeMs, 0);
        items.push(`+${rest.length} more ${fmtDuration(restMs)}`);
      }
      rows.push(`     by project       ${items.join(' · ')}`);
    }
    rows.push('');
  }

  if (r.waste && r.waste.classes && r.waste.classes.length > 0) {
    rows.push(c.bold('CONTEXT WASTE'));
    const maxTokLen = Math.max(...r.waste.classes.map((cls) => `${fmtCompact(cls.tokens)} tok`.length), 8);
    const maxCallsLen = Math.max(...r.waste.classes.map((cls) => `${fmtInt(cls.calls)} calls`.length), 9);
    const maxLabelLen = Math.max(...r.waste.classes.map((cls) => cls.label.length));
    for (const cls of r.waste.classes) {
      const tokStr = `${fmtCompact(cls.tokens)} tok`;
      const callsStr = `${fmtInt(cls.calls)} calls`;
      rows.push(
        `  ${tokStr.padStart(maxTokLen)} · ${callsStr.padStart(maxCallsLen)}   ${cls.label.padEnd(maxLabelLen)}   → ${cls.lever}`,
      );
    }
    rows.push(c.dim('  classes overlap — an oversized read can also be exploratory; do not sum them'));
    rows.push(c.dim(`  ${r.waste.note}`));
    rows.push('');
  }

  // 2. Context amplification — MAIN THREAD only. Pooling subagent contexts in
  // here would halve the number: they are short-lived and drag the average
  // down, understating what a token actually costs in the thread you live in.
  if (r.main.amplification > 0) {
    rows.push(c.bold('CONTEXT AMPLIFICATION') + c.dim(' (main thread)'));
    rows.push(`  ${c.bold(fmtCompact(r.main.admittedTokens))} tokens admitted by tools`);
    rows.push(`  ↳ re-read ${c.bold(c.yellow(`${r.main.amplification.toFixed(0)}×`))} on average (${fmtCompact(r.main.inputSideTokens)} input-side)`);
    rows.push(c.dim('  every token you let in is paid for again on every later turn'));
    rows.push('');
  }

  // 3. Subagents — the one big lever you actually control.
  const s = r.subagents;
  if (s.calls > 0) {
    rows.push(c.bold('SUBAGENTS'));
    rows.push(`  ${c.bold(fmtInt(s.agents))} agents · ${c.bold(fmtInt(s.calls))} dispatches`);
    rows.push(
      `  🗜️  ${c.bold(c.green(`${s.compression.toFixed(1)}×`))} compression — ${c.bold(fmtCompact(s.keptOutTokens))} tokens kept out of the main thread`,
    );
    if (r.main.amplification > 0) {
      const avoided = s.keptOutTokens * r.main.amplification;
      rows.push(c.dim(`  ↳ at ${r.main.amplification.toFixed(0)}× that is ~${fmtCompact(avoided)} tokens of traffic avoided`));
    }
    rows.push(c.dim(`  they are not free: ${s.shareOfSpendPct.toFixed(1)}% of total spend is subagent overhead`));
    rows.push('');
  }

  // 4. Cold context — what you pay before you type a word. It is re-paid on
  // every session and every subagent spawn, so it scales with how you work
  // rather than what you work on, and it is the cost that uninstalling fixes.
  if (r.coldMain.sessions > 0) {
    rows.push(c.bold('COLD CONTEXT') + c.dim(' (before you type)'));
    rows.push(`  🧊 ${c.bold(fmtCompact(r.coldMain.medianTokens))} tokens median at session start`);
    if (r.coldSub.sessions > 0) {
      rows.push(
        `  ↳ every subagent spawn re-pays ${c.bold(fmtCompact(r.coldSub.medianTokens))} of it (${fmtInt(r.coldSub.sessions)} spawns)`,
      );
    }
    rows.push(c.dim('  system prompt + tool names + agent/skill descriptions + memory'));
    rows.push('');
  }

  // 5. Ghost tokens — the stuff an output-rewriting hook claims to fix. Printed
  // as measurements, not advice: on a disciplined rig the famous repeat-read
  // trick is worth ~nothing, and the real weight sits in oversized results.
  const g = r.ghosts;
  if (g.readCalls > 0 || g.oversizedCalls > 0) {
    rows.push(c.bold('👻 GHOST TOKENS') + c.dim(' (main thread)'));
    if (r.main.admittedTokens > 0) {
      const pct = (100 * g.oversizedTokens) / r.main.admittedTokens;
      rows.push(
        `  ${c.bold(fmtCompact(g.oversizedTokens))} tok in ${fmtInt(g.oversizedCalls)} oversized results ${c.dim(`(>4KB) — ${pct.toFixed(0)}% of all admitted`)}`,
      );
    }
    if (g.readCalls > 0) {
      const slicedPct = (100 * g.slicedCalls) / g.readCalls;
      rows.push(
        `  📖 ${fmtInt(g.readCalls)} reads · ${c.bold(`${slicedPct.toFixed(0)}%`)} sliced with offset/limit`,
      );
      rows.push(
        `  🔍 ${c.bold(fmtCompact(g.exploratoryTokens))} tok read whole and never edited ${c.dim('— outline-first territory')}`,
      );
    }
    if (g.repeatReadCalls > 0) {
      rows.push(
        c.dim(`  ♻️  ${fmtInt(g.repeatReadCalls)} redundant re-reads (${fmtCompact(g.repeatReadTokens)} tok) — dedupe would buy this back`),
      );
    }
    rows.push('');
  }

  // 6. Where the context actually comes from.
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

  // 7. The point of the audit: loaded every session, never called.
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

  // 8. Opt-in (--market): the same mix, repriced at market list rates. Pure
  // arithmetic on YOUR measured token counts — deliberately not a savings
  // estimate: another model would tokenize differently, answer differently,
  // and cache differently. It answers one question only: what does this
  // volume cost at each counter of the exchange.
  if (r.market && r.market.rates.length > 0) {
    rows.push('');
    const srcLabel = r.market.source === 'live' ? 'live' : r.market.source === 'cache' ? 'cached' : 'bundled snapshot';
    rows.push(c.bold('YOUR MIX AT MARKET RATES') + c.dim(` (${srcLabel} · as of ${r.market.asOf})`));
    const priced = r.market.rates.map((rate) => {
      const usd = repriceMix(r.tokens, rate);
      const perf = rate.intelligence !== undefined && usd > 0 ? rate.intelligence / usd : undefined;
      return { rate, usd, perf };
    });
    // Scored counters rank by AI-performance-per-dollar of YOUR mix, best
    // first; unscored ones trail, cheapest first, and say so.
    priced.sort((a, b) => {
      if (a.perf !== undefined && b.perf !== undefined) return b.perf - a.perf;
      if (a.perf !== undefined) return -1;
      if (b.perf !== undefined) return 1;
      return a.usd - b.usd;
    });
    const bestPerf = priced.find((p) => p.perf !== undefined);
    const width = Math.max(...priced.map((p) => p.rate.label.length));
    const fmtPerf = (n: number): string => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
    for (const p of priced) {
      const perfStr =
        p.perf !== undefined
          ? `intel ${p.rate.intelligence!.toFixed(1)} · ${fmtPerf(p.perf)} intel/$`
          : 'no published score';
      const crown = bestPerf && p === bestPerf ? ` 🏆 ${c.bold('max AI per dollar')}` : '';
      rows.push(`  ${p.rate.label.padEnd(width)}  ${fmtUsd(p.usd).padStart(12)}   ${c.dim(perfStr)}${crown}`);
    }
    rows.push(c.dim('  arithmetic, not advice: same token counts at each list price.'));
    rows.push(c.dim('  tokenizers, quality, and cache mechanics all differ — this is'));
    rows.push(c.dim('  what your volume costs per counter, not what you would save.'));
    rows.push(c.dim('  intel = Artificial Analysis intelligence index as republished in'));
    rows.push(c.dim('  the catalog — a third-party benchmark, not your workload.'));
  }

  rows.push('');
  rows.push(c.dim('— The Bureau · calibrated to ±0.001 vibes'));
  return railCard(rows, opts.colors) + renderRootCauses(r.rootCauses ?? []);
}
