import type { Env } from '../index.js';
import { latestForLogin } from '../db.js';

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

const PAGE_CSS = `
  body{background:#0b0e14;color:#e6e6e6;font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;
       display:flex;flex-direction:column;align-items:center;padding:48px 16px;margin:0}
  .card{border:1px solid #2a2f3a;border-radius:12px;padding:32px;max-width:560px;width:100%;
        background:#11151f;box-shadow:0 0 40px rgba(140,82,255,.25)}
  h1{color:#b388ff;font-size:20px;margin:0 0 16px}
  .vibe{font-size:42px;color:#69f0ae;margin:8px 0}
  .rank{color:#ff80ab;letter-spacing:1px}
  .badges{color:#ffd54f;margin-top:12px}
  .cta{margin-top:28px;text-align:center}
  code{background:#1a1f2b;border:1px solid #2a2f3a;border-radius:8px;padding:12px 20px;
       font-size:18px;color:#69f0ae;display:inline-block;cursor:pointer}
  .hint{color:#666;font-size:12px;margin-top:8px}
`;

function page(title: string, ogLogin: string | null, body: string, origin: string): string {
  const og = ogLogin
    ? `<meta property="og:image" content="${origin}/og/${encodeURIComponent(ogLogin)}.png">
       <meta name="twitter:card" content="summary_large_image">
       <meta name="twitter:image" content="${origin}/og/${encodeURIComponent(ogLogin)}.png">`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}">${og}
    <style>${PAGE_CSS}</style></head>
    <body>${body}
    <div class="cta"><code onclick="navigator.clipboard.writeText('npx viberuler')">npx viberuler</code>
    <div class="hint">click to copy — get YOUR vibe score</div></div>
    </body></html>`;
}

export async function handleShare(_req: Request, env: Env, url: URL): Promise<Response> {
  let login: string;
  try { login = decodeURIComponent(url.pathname.slice('/u/'.length)); } catch { login = ''; }
  const row = await latestForLogin(env.DB, login);
  const headers = { 'content-type': 'text/html; charset=utf-8' };

  if (!row) {
    const body = `<div class="card"><h1>404 — NPC detected</h1>
      <p>No vibes found for <b>${escapeHtml(login)}</b>. This player hasn't entered the arena.</p></div>`;
    return new Response(page('viberuler — NPC', null, body, url.origin), { status: 404, headers });
  }

  const safe = escapeHtml(row.gh_login);
  const achievements = (JSON.parse(row.achievements) as string[]).join(' · ');
  const scoreBlock = row.sus
    ? `<div class="vibe">—</div><div class="rank">UNDER REVIEW</div>`
    : `<div class="vibe">${fmtInt(row.vibe_score)}</div><div class="rank">GLOBAL RANK #${row.rank}</div>`;
  const body = `<div class="card"><h1>@${safe} on VIBERULER</h1>
    ${scoreBlock}
    ${!row.sus && row.tok_per_usd !== null ? `<div>${fmtInt(row.tok_per_usd)} tokens per dollar</div>` : ''}
    <div class="badges">${escapeHtml(achievements)}</div></div>`;
  const title = row.sus
    ? `@${row.gh_login} — under review`
    : `VIBE ${fmtInt(row.vibe_score)}`;
  return new Response(page(title, row.gh_login, body, url.origin), {
    status: 200, headers,
  });
}
