import { ImageResponse } from 'workers-og';
import type { Env } from '../index.js';
import { json } from '../index.js';
import { latestForLogin, type BoardRow } from '../db.js';
import { escapeHtml } from './share.js';
import { gaugeHtml, rankForVibe, certifyLine, PALETTE } from '../brand.js';
// wrangler Data rule (wrangler.jsonc "rules") imports .ttf as ArrayBuffer
import font from '../assets/JetBrainsMono-Regular.ttf';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

type OgRow = BoardRow & {
  rank: number;
  sus: number;
  loc: number;
  streak_days: number | null;
  feats_shipped: number | null;
  prs_merged: number | null;
  agents: string | null;
};

function parseAgents(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function certificateHtml(row: OgRow): string {
  const sus = !!row.sus;
  const rankLine = sus ? 'UNDER REVIEW' : `GLOBAL RANK #${row.rank}`;
  const scoreDisplay = sus ? '—' : fmtInt(row.vibe_score);
  const rank = rankForVibe(row.vibe_score);
  const certLine = sus
    ? `<div style="display:flex;font-size:24px;color:${PALETTE.stamp};margin-top:16px">— PENDING CERTIFICATION —</div>`
    : `<div style="display:flex;font-size:24px;color:${PALETTE.amber};margin-top:16px">${escapeHtml(certifyLine(rank))}</div>`;

  const locLine =
    !sus && row.loc > 0
      ? `<div style="display:flex;font-size:26px;color:${PALETTE.green};margin-top:14px">${fmtInt(row.loc)} lines of code shipped</div>`
      : '';

  const tokPerUsd =
    !sus && row.tok_per_usd !== null
      ? `<div style="display:flex;font-size:32px;color:${PALETTE.amber};margin-top:16px">${fmtInt(row.tok_per_usd)} tokens per dollar</div>`
      : '';
  const tokPerLoc =
    !sus && row.tok_per_loc !== null
      ? `<div style="display:flex;font-size:18px;color:${PALETTE.violet};margin-top:6px">${fmtInt(row.tok_per_loc)} tokens / line shipped</div>`
      : '';

  const feats = row.feats_shipped ?? 0;
  const prs = row.prs_merged ?? 0;
  const shipParts: string[] = [];
  if (!sus && feats > 0) shipParts.push(`${fmtInt(feats)} features shipped`);
  if (!sus && prs > 0) shipParts.push(`${fmtInt(prs)} PRs merged`);
  const shipLine = shipParts.length
    ? `<div style="display:flex;font-size:24px;color:${PALETTE.violet};margin-top:14px">${shipParts.join('   ·   ')}</div>`
    : '';

  const agentsList = parseAgents(row.agents);
  const metaParts: string[] = [];
  if (!sus && row.streak_days != null && row.streak_days > 0) metaParts.push(`${row.streak_days}-day streak`);
  if (!sus && agentsList.length) {
    const shown = agentsList.slice(0, 3).map(escapeHtml).join(' · ');
    const extra = agentsList.length > 3 ? ` +${agentsList.length - 3}` : '';
    metaParts.push(`${agentsList.length} agents in the stable: ${shown}${extra}`);
  }
  const metaLine = metaParts.length
    ? `<div style="display:flex;font-size:20px;color:${PALETTE.ivory};margin-top:14px">${metaParts.join('   ·   ')}</div>`
    : '';

  return `
    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;
                width:1200px;height:630px;background:${PALETTE.base};color:${PALETTE.ivory};
                font-family:'JetBrains Mono';padding:60px">
      <div style="display:flex;font-size:28px;letter-spacing:4px;color:${PALETTE.violet}">CERTIFICATE OF VIBE MEASUREMENT</div>
      <div style="display:flex;font-size:26px;color:${PALETTE.ivory};margin-top:12px">subject: @${escapeHtml(row.gh_login)}</div>
      <div style="display:flex;font-size:92px;color:${PALETTE.green};margin:14px 0">${scoreDisplay}</div>
      ${gaugeHtml(row.vibe_score, { sus, compact: true })}
      ${locLine}
      ${tokPerUsd}
      ${tokPerLoc}
      ${shipLine}
      ${metaLine}
      <div style="display:flex;font-size:34px;color:${PALETTE.stamp};margin-top:18px">${rankLine}</div>
      ${certLine}
      <div style="display:flex;font-size:20px;color:${PALETTE.muted};margin-top:24px">— The Bureau · calibrated to ±0.001 vibes</div>
      <div style="display:flex;font-size:20px;color:${PALETTE.muted};margin-top:10px">npx viberuler</div>
    </div>`;
}

export async function handleOg(_req: Request, env: Env, url: URL): Promise<Response> {
  // Accept both /og/<login>.png and /og/<login>/<version>.png. The version
  // segment is a cache-buster only (ignored here) — a path segment rather than
  // a ?query so crawlers (LinkedIn) unambiguously treat the URL as an image.
  const m = url.pathname.match(/^\/og\/([^/]+)(?:\/[^/]+)?\.png$/);
  let login: string | null = null;
  if (m?.[1]) {
    try { login = decodeURIComponent(m[1]); } catch { login = null; }
  }
  const row = login ? await latestForLogin(env.DB, login) : null;
  if (!row) return json({ error: 'not found' }, 404);

  const html = certificateHtml(row);

  const img = new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: [{ name: 'JetBrains Mono', data: font as unknown as ArrayBuffer, weight: 400, style: 'normal' }],
  });
  const headers = new Headers(img.headers);
  headers.set('cache-control', 'public, max-age=3600');
  return new Response(img.body, { status: img.status, headers });
}
