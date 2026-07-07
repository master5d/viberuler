import { ImageResponse } from 'workers-og';
import type { Env } from '../index.js';
import { json } from '../index.js';
import { latestForLogin } from '../db.js';
import { escapeHtml } from './share.js';
// wrangler Data rule (wrangler.jsonc "rules") imports .ttf as ArrayBuffer
import font from '../assets/JetBrainsMono-Regular.ttf';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export async function handleOg(_req: Request, env: Env, url: URL): Promise<Response> {
  const m = url.pathname.match(/^\/og\/(.+)\.png$/);
  const login = m?.[1] ? decodeURIComponent(m[1]) : null;
  const row = login ? await latestForLogin(env.DB, login) : null;
  if (!row) return json({ error: 'not found' }, 404);

  const rankLine = row.sus ? 'UNRANKED' : `GLOBAL RANK #${row.rank}`;
  const html = `
    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;
                width:100%;height:100%;background:#0b0e14;color:#e6e6e6;
                font-family:'JetBrains Mono';padding:60px">
      <div style="display:flex;font-size:36px;color:#b388ff">@${escapeHtml(row.gh_login)} · VIBERULER</div>
      <div style="display:flex;font-size:120px;color:#69f0ae;margin:20px 0">${fmtInt(row.vibe_score)}</div>
      <div style="display:flex;font-size:40px;color:#ff80ab">${rankLine}</div>
      ${row.tok_per_usd !== null
        ? `<div style="display:flex;font-size:30px;color:#ffd54f;margin-top:16px">${fmtInt(row.tok_per_usd)} tokens per dollar</div>`
        : ''}
      <div style="display:flex;font-size:26px;color:#666;margin-top:30px">npx viberuler</div>
    </div>`;

  const img = new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: [{ name: 'JetBrains Mono', data: font as unknown as ArrayBuffer, weight: 400, style: 'normal' }],
  });
  const headers = new Headers(img.headers);
  headers.set('cache-control', 'public, max-age=3600');
  return new Response(img.body, { status: img.status, headers });
}
