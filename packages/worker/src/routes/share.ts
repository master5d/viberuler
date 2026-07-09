import type { Env } from '../index.js';
import { latestForLogin } from '../db.js';
import { SEAL_SVG, guillocheCss, gaugeHtml, rankForVibe, certifyLine, PALETTE } from '../brand.js';

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
  ${guillocheCss()}
  body{background:${PALETTE.base};color:${PALETTE.ivory};font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;
       display:flex;flex-direction:column;align-items:center;padding:48px 16px;margin:0}
  .card{border:1px solid ${PALETTE.violet};border-radius:12px;padding:32px;max-width:560px;width:100%;
        text-align:center;box-shadow:0 0 40px rgba(140,82,255,.25)}
  .title{color:${PALETTE.violet};font-size:16px;letter-spacing:4px;margin:12px 0 4px}
  .subject{color:${PALETTE.ivory};font-size:18px;margin:8px 0 16px}
  .vibe{font-size:56px;color:${PALETTE.green};margin:8px 0}
  .loc{color:${PALETTE.green};font-size:20px;margin-top:6px}
  .gauge{display:flex;flex-direction:column;align-items:center;margin:16px 0}
  .rank{color:${PALETTE.stamp};letter-spacing:1px;margin-top:16px}
  .certify{color:${PALETTE.amber};font-size:16px;margin-top:12px}
  .pending{color:${PALETTE.stamp};font-size:16px;margin-top:12px}
  .signoff{color:${PALETTE.muted};font-size:12px;margin-top:24px}
  .cta{margin-top:28px;text-align:center}
  code{background:${PALETTE.surface};border:1px solid ${PALETTE.hairline};border-radius:8px;padding:12px 20px;
       font-size:18px;color:${PALETTE.green};display:inline-block;cursor:pointer}
  .hint{color:${PALETTE.muted};font-size:12px;margin-top:8px}
`;

function page(title: string, ogLogin: string | null, body: string, origin: string): string {
  const og = ogLogin
    ? `<meta property="og:image" content="${origin}/og/${encodeURIComponent(ogLogin)}.png">
       <meta name="twitter:card" content="summary_large_image">
       <meta name="twitter:image" content="${origin}/og/${encodeURIComponent(ogLogin)}.png">`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}">${og}
    <style>${PAGE_CSS}</style></head>
    <body class="paper">${body}
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
    const body = `<div class="card paper">${SEAL_SVG(78)}
      <h1 class="title">404 — subject not on file</h1>
      <p>This coder has not submitted for certification. No record for <b>${escapeHtml(login)}</b>.</p></div>`;
    return new Response(page('viberuler — subject not on file', null, body, url.origin), { status: 404, headers });
  }

  const sus = !!row.sus;
  const safe = escapeHtml(row.gh_login);
  const rank = rankForVibe(row.vibe_score);
  const scoreDisplay = sus ? '—' : fmtInt(row.vibe_score);
  const rankLine = sus ? '' : `<div class="rank">GLOBAL RANK #${row.rank}</div>`;
  const certOrPending = sus
    ? `<div class="pending">— PENDING CERTIFICATION —</div>`
    : `<div class="certify">${escapeHtml(certifyLine(rank))}</div>`;
  const locLine = !sus ? `<div class="loc">${fmtInt(row.loc)} lines of code shipped</div>` : '';
  const tokPerUsd =
    !sus && row.tok_per_usd !== null ? `<div>${fmtInt(row.tok_per_usd)} tokens per dollar</div>` : '';
  const tokPerLoc =
    !sus && row.tok_per_loc !== null ? `<div>${fmtInt(row.tok_per_loc)} tokens per line shipped</div>` : '';

  const body = `<div class="card paper">${SEAL_SVG(78)}
    <div class="title">CERTIFICATE OF VIBE MEASUREMENT</div>
    <div class="subject">subject: @${safe}</div>
    <div class="vibe">${scoreDisplay}</div>
    <div class="gauge">${gaugeHtml(row.vibe_score, { sus })}</div>
    ${locLine}
    ${tokPerUsd}
    ${tokPerLoc}
    ${rankLine}
    ${certOrPending}
    <div class="signoff">— The Bureau · calibrated to ±0.001 vibes</div>
    </div>`;
  const title = sus
    ? `@${row.gh_login} — under review`
    : `@${row.gh_login} — VIBE ${fmtInt(row.vibe_score)}`;
  return new Response(page(title, row.gh_login, body, url.origin), {
    status: 200, headers,
  });
}
