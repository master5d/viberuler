import { ImageResponse } from 'workers-og';
import type { Env } from '../index.js';
import { json } from '../index.js';
import { latestForLogin } from '../db.js';
import { escapeHtml } from './share.js';
import { gaugeHtml, rankForVibe, certifyLine, PALETTE } from '../brand.js';
// wrangler Data rule (wrangler.jsonc "rules") imports .ttf as ArrayBuffer
import font from '../assets/JetBrainsMono-Regular.ttf';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

// Punchy compact numbers for the Wrapped-style stat bands (10.9B, 450K).
function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

export type StoryRow = {
  gh_login: string;
  vibe_score: number;
  rank: number;
  sus: number;
  loc: number;
  tokens: number;
  projects: number;
  tok_per_usd: number | null;
  streak_days: number | null;
};

// One Wrapped-style band: a big number over a muted label.
function band(value: string, label: string, color: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;margin:18px 0">
    <div style="display:flex;font-size:78px;font-weight:700;color:${color};line-height:1">${value}</div>
    <div style="display:flex;font-size:26px;color:${PALETTE.muted};margin-top:8px;letter-spacing:1px">${label}</div>
  </div>`;
}

// Text seal stand-in — satori can't render the <textPath>/gradient SVG seal,
// so the story uses a bordered monogram that reads as an official stamp.
function sealBlock(): string {
  return `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="display:flex;align-items:center;justify-content:center;width:150px;height:150px;
                border:5px solid ${PALETTE.violet};border-radius:75px;background:${PALETTE.base};
                font-size:76px;font-weight:700;color:${PALETTE.amber}">VR</div>
    <div style="display:flex;font-size:20px;letter-spacing:4px;color:${PALETTE.violet};margin-top:16px">CERTIFICATE OF VIBE MEASUREMENT</div>
  </div>`;
}

export function storyHtml(row: StoryRow): string {
  const sus = !!row.sus;
  const rank = rankForVibe(row.vibe_score);

  const bands = sus
    ? `<div style="display:flex;font-size:46px;color:${PALETTE.stamp};margin:40px 0">— UNDER REVIEW —</div>`
    : [
        band(fmtCompact(row.tokens), 'tokens burned', PALETTE.green),
        row.tok_per_usd !== null ? band(fmtCompact(row.tok_per_usd), 'tokens per dollar', PALETTE.amber) : '',
        band(fmtInt(row.loc), 'lines of code shipped', PALETTE.ivory),
        band(fmtInt(row.projects), row.projects === 1 ? 'project' : 'projects', PALETTE.ivory),
        row.streak_days && row.streak_days > 0
          ? band(String(row.streak_days), row.streak_days === 1 ? 'day streak' : 'day streak', PALETTE.violet)
          : '',
      ]
        .filter(Boolean)
        .join('');

  const scoreBlock = sus
    ? ''
    : `<div style="display:flex;flex-direction:column;align-items:center;margin-top:12px">
        <div style="display:flex;font-size:34px;letter-spacing:3px;color:${PALETTE.muted}">VIBE SCORE</div>
        <div style="display:flex;font-size:120px;font-weight:700;color:${PALETTE.green};line-height:1;margin:8px 0">${fmtInt(row.vibe_score)}</div>
        <div style="display:flex;font-size:30px;color:${PALETTE.stamp};margin-top:6px">GLOBAL RANK #${row.rank}</div>
        <div style="display:flex;font-size:32px;color:${PALETTE.amber};margin-top:14px">${escapeHtml(certifyLine(rank))}</div>
      </div>`;

  const hairline = `<div style="display:flex;width:820px;height:1px;background:${PALETTE.hairline};margin:22px 0"></div>`;

  return `
    <div style="display:flex;flex-direction:column;justify-content:space-between;align-items:center;
                width:1080px;height:1920px;background:${PALETTE.base};color:${PALETTE.ivory};
                font-family:'JetBrains Mono';padding:90px 70px">
      <div style="display:flex;flex-direction:column;align-items:center">
        ${sealBlock()}
        <div style="display:flex;font-size:30px;color:${PALETTE.ivory};margin-top:18px">subject: @${escapeHtml(row.gh_login)}</div>
      </div>
      ${hairline}
      <div style="display:flex;flex-direction:column;align-items:center">${bands}</div>
      ${hairline}
      <div style="display:flex;flex-direction:column;align-items:center">
        ${scoreBlock}
        <div style="display:flex;margin-top:26px">${gaugeHtml(row.vibe_score, { sus, compact: true })}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;margin-top:20px">
        <div style="display:flex;font-size:22px;color:${PALETTE.muted}">— The Bureau · calibrated to ±0.001 vibes</div>
        <div style="display:flex;font-size:34px;color:${PALETTE.green};margin-top:14px">npx viberuler</div>
      </div>
    </div>`;
}

export async function handleStory(_req: Request, env: Env, url: URL): Promise<Response> {
  // /story/<login>.png and /story/<login>/<version>.png (version is a
  // cache-buster path segment, ignored here — same scheme as /og).
  const m = url.pathname.match(/^\/story\/([^/]+)(?:\/[^/]+)?\.png$/);
  let login: string | null = null;
  if (m?.[1]) {
    try { login = decodeURIComponent(m[1]); } catch { login = null; }
  }
  const row = login ? await latestForLogin(env.DB, login) : null;
  if (!row) return json({ error: 'not found' }, 404);

  const img = new ImageResponse(storyHtml(row), {
    width: 1080,
    height: 1920,
    fonts: [{ name: 'JetBrains Mono', data: font as unknown as ArrayBuffer, weight: 400, style: 'normal' }],
  });
  const headers = new Headers(img.headers);
  headers.set('cache-control', 'public, max-age=3600');
  return new Response(img.body, { status: img.status, headers });
}
