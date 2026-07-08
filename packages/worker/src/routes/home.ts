import type { Env } from '../index.js';
import { leaderboard, totals } from '../db.js';
import { escapeHtml } from './share.js';
import { fmtCompact } from './badge.js';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

const HOME_CSS = `
  body{background:#0b0e14;color:#e6e6e6;font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;
       display:flex;flex-direction:column;align-items:center;padding:48px 16px;margin:0}
  .hero{text-align:center;max-width:720px}
  h1{color:#b388ff;font-size:40px;margin:0;letter-spacing:2px}
  .tag{color:#e6e6e6;margin:12px 0 4px}
  .sub{color:#666;font-size:13px}
  code{background:#1a1f2b;border:1px solid #2a2f3a;border-radius:8px;padding:12px 20px;
       font-size:18px;color:#69f0ae;display:inline-block;cursor:pointer;margin-top:20px}
  .hint{color:#666;font-size:12px;margin-top:8px}
  .totals{color:#ffd54f;margin-top:24px;font-size:14px}
  table{border-collapse:collapse;margin-top:32px;width:100%;max-width:720px}
  th{color:#666;font-size:12px;text-align:left;padding:6px 12px;border-bottom:1px solid #2a2f3a}
  td{padding:8px 12px;border-bottom:1px solid #1a1f2b;font-size:14px}
  td.num,th.num{text-align:right}
  .pos{color:#666}
  tr:first-child td .pos{color:#ffd54f}
  a{color:#b388ff;text-decoration:none}
  a:hover{text-decoration:underline}
  .vibe{color:#69f0ae;font-weight:bold}
  .empty{color:#666;margin-top:32px}
  .links{margin-top:40px;color:#666;font-size:13px}
  .links a{margin:0 10px}
  img.av{width:20px;height:20px;border-radius:50%;vertical-align:-4px;margin-right:8px}
`;

const FAVICON =
  'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📏</text></svg>';

export async function handleHome(_req: Request, env: Env, url: URL): Promise<Response> {
  const [{ rows }, t] = await Promise.all([leaderboard(env.DB, 1, 25), totals(env.DB)]);

  const board =
    rows.length === 0
      ? `<p class="empty">The board is empty. Be the first — history remembers #1.</p>`
      : `<table>
      <tr><th>#</th><th>coder</th><th class="num">VIBE</th><th class="num">tok/$</th><th class="num">badges</th></tr>
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
          </tr>`;
        })
        .join('')}
    </table>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>viberuler — the benchmark for vibe coders</title>
    <meta name="description" content="How hard do you actually vibe? Scan your rig, get your VIBE SCORE, flex it. Headline stat: tokens per dollar.">
    <meta property="og:title" content="viberuler — the benchmark for vibe coders">
    <meta property="og:description" content="LoC shipped, tokens burned, tokens per dollar. npx viberuler.">
    <link rel="icon" href="${FAVICON}">
    <style>${HOME_CSS}</style></head>
    <body>
    <div class="hero">
      <h1>VIBERULER</h1>
      <div class="tag">The benchmark for vibe coders.</div>
      <div class="sub">LoC shipped · tokens burned · the headline stat: <b>tokens per dollar</b></div>
      <code onclick="navigator.clipboard.writeText('npx viberuler')">npx viberuler</code>
      <div class="hint">click to copy — 100% local scan, nothing leaves your machine unless you --submit</div>
      <div class="totals">${fmtInt(t.users)} coder${t.users === 1 ? '' : 's'} on the board · ${fmtCompact(t.tokens)} tokens benchmarked</div>
    </div>
    ${board}
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
