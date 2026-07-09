import type { Env } from '../index.js';
import { leaderboard, totals } from '../db.js';
import { escapeHtml } from './share.js';
import { fmtCompact } from './badge.js';
import { PALETTE, SEAL_SVG, guillocheCss, rankForVibe } from '../brand.js';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

const HOME_CSS = `
  body{background:${PALETTE.base};color:#e6e6e6;font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;
       display:flex;flex-direction:column;align-items:center;padding:48px 16px;margin:0}
  .hero{text-align:center;max-width:720px;padding:32px 24px;border:1px solid ${PALETTE.hairline};border-radius:4px}
  .seal{margin-bottom:12px}
  h1{color:${PALETTE.ivory};font-size:22px;margin:0;letter-spacing:3px}
  .tag{color:${PALETTE.violet};margin:12px 0 4px;font-size:14px}
  .sub{color:${PALETTE.muted};font-size:13px}
  .cta{margin-top:24px;border:1px solid ${PALETTE.hairline};border-radius:4px;padding:20px 24px;display:inline-block}
  code{background:${PALETTE.surface};border:1px solid ${PALETTE.hairline};border-radius:8px;padding:12px 20px;
       font-size:18px;color:${PALETTE.green};display:inline-block;cursor:pointer}
  .hint{color:${PALETTE.muted};font-size:12px;margin-top:8px}
  .totals{color:${PALETTE.amber};margin-top:24px;font-size:14px}
  .standings{max-width:720px;width:100%;margin-top:32px;padding:24px;border:1px solid ${PALETTE.hairline};border-radius:4px;box-sizing:border-box}
  h2{color:${PALETTE.ivory};font-size:16px;letter-spacing:2px;margin:0 0 16px;text-align:center}
  table{border-collapse:collapse;width:100%}
  th{color:${PALETTE.muted};font-size:12px;text-align:left;padding:6px 12px;border-bottom:1px solid ${PALETTE.hairline}}
  td{padding:8px 12px;border-bottom:1px solid ${PALETTE.hairline};font-size:14px}
  td.num,th.num{text-align:right}
  .pos{color:${PALETTE.muted}}
  tr:first-child td .pos{color:${PALETTE.amber}}
  a{color:${PALETTE.violet};text-decoration:none}
  a:hover{text-decoration:underline}
  .vibe{color:${PALETTE.green};font-weight:bold}
  .rank{color:${PALETTE.ivory};font-size:12px}
  .empty{color:${PALETTE.muted};margin-top:32px}
  .disclaimer{color:${PALETTE.muted};font-size:12px;margin-top:40px;text-align:center}
  .links{margin-top:12px;color:${PALETTE.muted};font-size:13px}
  .links a{margin:0 10px}
  img.av{width:20px;height:20px;border-radius:50%;vertical-align:-4px;margin-right:8px}
  ${guillocheCss()}
`;

export async function handleHome(_req: Request, env: Env, url: URL): Promise<Response> {
  const [{ rows }, t] = await Promise.all([leaderboard(env.DB, 1, 25), totals(env.DB)]);

  const board =
    rows.length === 0
      ? `<p class="empty">No submissions are on file. Be the first — history remembers #1.</p>`
      : `<table>
      <tr><th>#</th><th>coder</th><th class="num">VIBE</th><th class="num">tok/$</th><th class="num">badges</th><th class="num">certified as</th></tr>
      ${rows
        .map((r, i) => {
          const login = escapeHtml(r.gh_login);
          const av = r.avatar_url ? `<img class="av" src="${escapeHtml(r.avatar_url)}&s=40" alt="">` : '';
          const badges = (JSON.parse(r.achievements) as string[]).length;
          return `<tr>
            <td><span class="pos">#${i + 1}</span></td>
            <td>${av}<a href="/u/${encodeURIComponent(r.gh_login)}">@${login}</a></td>
            <td class="num vibe">${fmtInt(r.vibe_score)}</td>
            <td class="num">${r.tok_per_usd !== null ? fmtCompact(r.tok_per_usd) : '—'}</td>
            <td class="num">${badges}</td>
            <td class="num rank">${escapeHtml(rankForVibe(r.vibe_score))}</td>
          </tr>`;
        })
        .join('')}
    </table>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>The International Bureau of Vibe Measurement</title>
    <meta name="description" content="How hard do you actually vibe? Scan your rig, get certified. Headline stat: tokens per dollar.">
    <meta property="og:title" content="The International Bureau of Vibe Measurement">
    <meta property="og:description" content="LoC shipped, tokens burned, tokens per dollar. npx viberuler.">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">
    <style>${HOME_CSS}</style></head>
    <body>
    <div class="hero paper">
      <div class="seal">${SEAL_SVG(96)}</div>
      <h1>THE INTERNATIONAL BUREAU OF VIBE MEASUREMENT</h1>
      <div class="tag">The official, peer-reviewed-by-nobody standard for how hard you actually vibe.</div>
      <div class="cta">
        <code onclick="navigator.clipboard.writeText('npx viberuler')">npx viberuler</code>
        <div class="sub">submit your rig for certification</div>
      </div>
      <div class="hint">click to copy — 100% local scan, nothing leaves your machine unless you --submit</div>
      <div class="totals">${fmtInt(t.users)} coder${t.users === 1 ? '' : 's'} certified · ${fmtCompact(t.tokens)} tokens on record</div>
      <div class="sub" style="margin-top:8px">Every certificate is GitHub-notarized (device-flow OAuth).</div>
    </div>
    <div class="standings paper">
      <h2>OFFICIAL STANDINGS</h2>
      ${board}
    </div>
    <div class="disclaimer">This measurement is scientifically meaningless. Notarized anyway.</div>
    <div class="links">
      <a href="https://github.com/master5d/viberuler">GitHub</a> ·
      <a href="https://github.com/master5d/viberuler/blob/master/METHODOLOGY.md">Methodology</a> ·
      <a href="https://github.com/master5d/viberuler/blob/master/PRIVACY.md">Privacy</a> ·
      <a href="/api/leaderboard">API</a>
    </div>
    </body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
  });
}
