import { ImageResponse } from 'workers-og';
import type { Env } from '../index.js';
import { json } from '../index.js';
import { latestForLogin, type BoardRow } from '../db.js';
import { escapeHtml } from './share.js';
import { gaugeHtml, rankForVibe, certifyLine, PALETTE } from '../brand.js';
// wrangler Data rule (wrangler.jsonc "rules") imports .ttf as ArrayBuffer
import font from '../assets/JetBrainsMono-Regular.ttf';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

type OgRow = BoardRow & { rank: number; sus: number };

export function certificateHtml(row: OgRow): string {
  const sus = !!row.sus;
  const rankLine = sus ? 'UNDER REVIEW' : `GLOBAL RANK #${row.rank}`;
  const scoreDisplay = sus ? '—' : fmtInt(row.vibe_score);
  const rank = rankForVibe(row.vibe_score);
  const certLine = sus
    ? `<div style="display:flex;font-size:24px;color:${PALETTE.stamp};margin-top:16px">— PENDING CERTIFICATION —</div>`
    : `<div style="display:flex;font-size:24px;color:${PALETTE.amber};margin-top:16px">${escapeHtml(certifyLine(rank))}</div>`;

  const tokPerUsd =
    !sus && row.tok_per_usd !== null
      ? `<div style="display:flex;font-size:32px;color:${PALETTE.amber};margin-top:16px">${fmtInt(row.tok_per_usd)} tokens per dollar</div>`
      : '';
  const tokPerLoc =
    !sus && row.tok_per_loc !== null
      ? `<div style="display:flex;font-size:18px;color:${PALETTE.violet};margin-top:6px">${fmtInt(row.tok_per_loc)} tokens / line shipped</div>`
      : '';

  return `
    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;
                width:1200px;height:630px;background:${PALETTE.base};color:${PALETTE.ivory};
                font-family:'JetBrains Mono';padding:60px">
      <div style="display:flex;font-size:28px;letter-spacing:4px;color:${PALETTE.violet}">CERTIFICATE OF VIBE MEASUREMENT</div>
      <div style="display:flex;font-size:26px;color:${PALETTE.ivory};margin-top:12px">subject: @${escapeHtml(row.gh_login)}</div>
      <div style="display:flex;font-size:110px;color:${PALETTE.green};margin:20px 0">${scoreDisplay}</div>
      ${gaugeHtml(row.vibe_score, { sus, compact: true })}
      ${tokPerUsd}
      ${tokPerLoc}
      <div style="display:flex;font-size:36px;color:${PALETTE.stamp};margin-top:24px">${rankLine}</div>
      ${certLine}
      <div style="display:flex;font-size:20px;color:${PALETTE.muted};margin-top:24px">— The Bureau · calibrated to ±0.001 vibes</div>
      <div style="display:flex;font-size:20px;color:${PALETTE.muted};margin-top:10px">npx viberuler</div>
    </div>`;
}

export async function handleOg(_req: Request, env: Env, url: URL): Promise<Response> {
  const m = url.pathname.match(/^\/og\/(.+)\.png$/);
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
