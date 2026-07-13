import type { Env } from '../index.js';
import { leaderboard, totals } from '../db.js';
import { escapeHtml } from './share.js';
import { fmtCompact } from './badge.js';
import { PALETTE, SEAL_SVG, guillocheCss, rankForVibe } from '../brand.js';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

const HOME_CSS = `
  body{background:${PALETTE.base};color:#e6e6e6;font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;
       display:flex;flex-direction:column;align-items:center;padding:48px 16px;margin:0}
  .hero{text-align:center;max-width:720px;width:100%;box-sizing:border-box;padding:32px 24px;
        border:1px solid ${PALETTE.hairline};border-radius:4px}
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
  /* Six columns cannot fit a phone: the table's min-content is 412px against
     ~310px of room, and it refuses to shrink — so it was pushing the whole page
     sideways. Let the board scroll inside its own frame instead of dropping
     columns: nothing is hidden, and the page itself stays put. */
  .boardwrap{width:100%;overflow-x:auto}
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
  /* Collapsed by default: <details> gives us keyboard support and the correct
     expanded state announced to screen readers for free — a hand-rolled toggle
     would have to earn both back. */
  /* the page is centred; an inline-block summary would otherwise hug the left */
  .contact{max-width:560px;width:100%;margin:20px 0 8px;box-sizing:border-box;text-align:center}
  .contact>summary{list-style:none;cursor:pointer;display:inline-block;
       border:1px solid ${PALETTE.hairline};border-radius:8px;padding:9px 18px;
       color:${PALETTE.muted};font-size:13px;background:transparent;user-select:none}
  .contact>summary::-webkit-details-marker{display:none}
  .contact>summary:hover{color:${PALETTE.ivory};border-color:${PALETTE.violet}}
  .contact>summary:focus-visible{outline:2px solid ${PALETTE.violet};outline-offset:2px}
  .contact[open]>summary{color:${PALETTE.ivory};border-color:${PALETTE.violet};margin-bottom:14px}
  .cbody{padding:24px;border:1px solid ${PALETTE.hairline};border-radius:4px;text-align:left}
  .contact .csub{color:${PALETTE.muted};font-size:12px;text-align:center;margin:0 0 16px}
  .contact form{display:flex;flex-direction:column;gap:12px}
  .contact input,.contact textarea{background:${PALETTE.surface};border:1px solid ${PALETTE.hairline};border-radius:8px;
       padding:12px 14px;color:${PALETTE.ivory};font-family:inherit;font-size:14px;box-sizing:border-box;width:100%}
  .contact textarea{resize:vertical;min-height:96px}
  .contact input:focus,.contact textarea:focus{outline:none;border-color:${PALETTE.violet}}
  .contact button{background:${PALETTE.violet};color:${PALETTE.base};border:none;border-radius:8px;padding:12px 22px;
       font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;align-self:flex-start}
  .contact button:hover{filter:brightness(1.08)}
  .contact button:disabled{opacity:.6;cursor:default}
  .contact .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
  .cstatus{font-size:13px;min-height:18px}
  .cstatus.ok{color:${PALETTE.green}}
  .cstatus.err{color:${PALETTE.stamp}}
  .calt{color:${PALETTE.muted};font-size:12px;text-align:center;margin-top:16px;border-top:1px solid ${PALETTE.hairline};padding-top:16px}

  @media (max-width: 480px) {
    body{padding:28px 12px}
    .hero{padding:22px 14px}
    /* 22px + 3px of letter-spacing is a lot of unbreakable width for one word */
    h1{font-size:17px;letter-spacing:1px}
    .tag{font-size:13px}
    code{font-size:16px;padding:10px 14px}
    .standings{padding:16px 12px}
    th,td{padding:6px 8px;font-size:13px}
    /* Six columns clipped at the frame edge read as a broken table, not a
       scrollable one. The rank name is the longest and the least load-bearing —
       it is on the coder's certificate a tap away — so it steps aside on a phone
       and the rest fits with nothing cut. */
    .rank{display:none}
    .links a{margin:0 6px;display:inline-block}
  }
  ${guillocheCss()}
`;

export async function handleHome(_req: Request, env: Env, url: URL): Promise<Response> {
  const [{ rows }, t] = await Promise.all([leaderboard(env.DB, 1, 25), totals(env.DB)]);

  const board =
    rows.length === 0
      ? `<p class="empty">No submissions are on file. Be the first — history remembers #1.</p>`
      : `<table>
      <tr><th>#</th><th>coder</th><th class="num">VIBE</th><th class="num">tok/$</th><th class="num">badges</th><th class="num rank">certified as</th></tr>
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
      <div class="boardwrap">${board}</div>
    </div>
    <div class="disclaimer">This measurement is scientifically meaningless. Notarized anyway.</div>
    <div class="links">
      <a href="https://github.com/master5d/viberuler">GitHub</a> ·
      <a href="https://github.com/master5d/viberuler/blob/master/METHODOLOGY.md">Methodology</a> ·
      <a href="https://github.com/master5d/viberuler/blob/master/PRIVACY.md">Privacy</a> ·
      <a href="/api/leaderboard">API</a>
    </div>
    <details class="contact" id="contact">
      <summary>Contact the Bureau</summary>
      <div class="cbody paper">
        <div class="csub">Bug, idea, or a collector for your favorite agent? File it below.</div>
        <form id="contact-form" novalidate>
          <input name="name" type="text" placeholder="name (optional)" maxlength="100" autocomplete="name">
          <input name="email" type="email" placeholder="you@example.com" maxlength="200" autocomplete="email" required>
          <textarea name="message" placeholder="your message to the Bureau" maxlength="5000" required></textarea>
          <input class="hp" name="fax" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button type="submit" id="contact-send">Send to the Bureau</button>
          <div class="cstatus" id="contact-status" role="status" aria-live="polite"></div>
        </form>
        <div class="calt">or email the Bureau directly: <a href="mailto:hello@viberuler.dev">hello@viberuler.dev</a></div>
      </div>
    </details>
    <script>(function(){var d=document.getElementById('contact');if(!d)return;
      // #contact must open the panel, or a link to it lands on a closed box.
      if(location.hash==='#contact')d.open=true;
      addEventListener('hashchange',function(){if(location.hash==='#contact')d.open=true;});
      // Opening it should put the cursor where the user is going anyway.
      d.addEventListener('toggle',function(){if(d.open){var e=d.querySelector('[name="email"]');if(e)e.focus();}});})();</script>
    <script>(function(){var f=document.getElementById('contact-form');if(!f)return;var s=document.getElementById('contact-status'),b=document.getElementById('contact-send');var g=function(n){var el=f.querySelector('[name="'+n+'"]');return el?el.value:'';};f.addEventListener('submit',async function(e){e.preventDefault();s.className='cstatus';s.textContent='filing…';b.disabled=true;try{var r=await fetch('/api/contact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:g('name'),email:g('email'),message:g('message'),fax:g('fax')})});if(r.ok){f.reset();s.className='cstatus ok';s.textContent='Filed with the Bureau. We’ll be in touch.';}else{var j=await r.json().catch(function(){return{};});s.className='cstatus err';s.textContent=j.error||'Something went wrong — try again.';}}catch(_){s.className='cstatus err';s.textContent='Network error — try again.';}b.disabled=false;});})();</script>
    </body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
  });
}
