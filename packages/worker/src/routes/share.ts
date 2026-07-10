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
  .ship{color:${PALETTE.violet};font-size:16px;margin-top:8px}
  .meta{color:${PALETTE.ivory};font-size:15px;margin-top:6px}
  .gauge{display:flex;flex-direction:column;align-items:center;margin:16px 0}
  .rank{color:${PALETTE.stamp};letter-spacing:1px;margin-top:16px}
  .certify{color:${PALETTE.amber};font-size:16px;margin-top:12px}
  .pending{color:${PALETTE.stamp};font-size:16px;margin-top:12px}
  .signoff{color:${PALETTE.muted};font-size:12px;margin-top:24px}
  .cta{margin-top:28px;text-align:center}
  code{background:${PALETTE.surface};border:1px solid ${PALETTE.hairline};border-radius:8px;padding:12px 20px;
       font-size:18px;color:${PALETTE.green};display:inline-block;cursor:pointer}
  .hint{color:${PALETTE.muted};font-size:12px;margin-top:8px}
  .share{display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:24px}
  .share button{background:${PALETTE.violet};color:${PALETTE.base};border:none;border-radius:10px;
       padding:14px 28px;font-size:18px;font-weight:700;font-family:inherit;cursor:pointer}
  .share button:hover{filter:brightness(1.08)}
  .share .wa{color:${PALETTE.green};font-size:14px;text-decoration:none;border-bottom:1px dotted ${PALETTE.green}}
  .share .stint{color:${PALETTE.muted};font-size:12px;max-width:340px;text-align:center}
`;

function page(
  title: string,
  ogLogin: string | null,
  body: string,
  origin: string,
  description: string,
  ogVersion?: string,
): string {
  const canonical = ogLogin ? `${origin}/u/${encodeURIComponent(ogLogin)}` : origin;
  // Version the image URL by submission time so LinkedIn/X/Slack — which cache
  // the og:image by URL, separately from the page — re-fetch the fresh
  // certificate after a re-submit instead of serving a stale render. The
  // version is a PATH segment, not a ?query: some crawlers (LinkedIn) are
  // finicky about query-string image URLs and fall back to the small card.
  const img = ogLogin
    ? `${origin}/og/${encodeURIComponent(ogLogin)}${ogVersion ? `/${encodeURIComponent(ogVersion)}` : ''}.png`
    : '';
  const og = ogLogin
    ? `<meta property="og:image" content="${img}">
       <meta property="og:image:width" content="1200">
       <meta property="og:image:height" content="630">
       <meta name="twitter:card" content="summary_large_image">
       <meta name="twitter:image" content="${img}">`
    : '';
  const desc = escapeHtml(description);
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${desc}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="VibeRuler">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${desc}">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${desc}">${og}
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
    return new Response(
      page(
        'viberuler — subject not on file',
        null,
        body,
        url.origin,
        'The official benchmark for vibe coders. Scan your rig, get your VIBE score: npx viberuler',
      ),
      { status: 404, headers },
    );
  }

  const sus = !!row.sus;
  const safe = escapeHtml(row.gh_login);
  const rank = rankForVibe(row.vibe_score);
  const scoreDisplay = sus ? '—' : fmtInt(row.vibe_score);
  const rankLine = sus ? '' : `<div class="rank">GLOBAL RANK #${row.rank}</div>`;
  const certOrPending = sus
    ? `<div class="pending">— PENDING CERTIFICATION —</div>`
    : `<div class="certify">${escapeHtml(certifyLine(rank))}</div>`;
  const locLine = !sus && row.loc > 0 ? `<div class="loc">${fmtInt(row.loc)} lines of code shipped</div>` : '';
  const tokPerUsd =
    !sus && row.tok_per_usd !== null ? `<div>${fmtInt(row.tok_per_usd)} tokens per dollar</div>` : '';
  const tokPerLoc =
    !sus && row.tok_per_loc !== null ? `<div>${fmtInt(row.tok_per_loc)} tokens per line shipped</div>` : '';
  const feats = row.feats_shipped ?? 0;
  const prs = row.prs_merged ?? 0;
  const shipParts: string[] = [];
  if (!sus && feats > 0) shipParts.push(`${fmtInt(feats)} features shipped`);
  if (!sus && prs > 0) shipParts.push(`${fmtInt(prs)} PRs merged`);
  const shipLine = shipParts.length ? `<div class="ship">${shipParts.join(' · ')}</div>` : '';

  let agentsList: string[] = [];
  try {
    const v = row.agents ? JSON.parse(row.agents) : [];
    if (Array.isArray(v)) agentsList = v.filter((x) => typeof x === 'string');
  } catch { agentsList = []; }
  const streakLine =
    !sus && row.streak_days != null && row.streak_days > 0
      ? `<div class="meta">${row.streak_days}-day streak</div>`
      : '';
  const agentsLine =
    !sus && agentsList.length
      ? `<div class="meta">${agentsList.length} agents in the stable: ${agentsList.map(escapeHtml).join(' · ')}</div>`
      : '';

  const card = `<div class="card paper">${SEAL_SVG(78)}
    <div class="title">CERTIFICATE OF VIBE MEASUREMENT</div>
    <div class="subject">subject: @${safe}</div>
    <div class="vibe">${scoreDisplay}</div>
    <div class="gauge">${gaugeHtml(row.vibe_score, { sus })}</div>
    ${locLine}
    ${tokPerUsd}
    ${tokPerLoc}
    ${shipLine}
    ${streakLine}
    ${agentsLine}
    ${rankLine}
    ${certOrPending}
    <div class="signoff">— The Bureau · calibrated to ±0.001 vibes</div>
    </div>`;

  // Story/reels share: a vertical 9:16 card handed to the phone's native share
  // sheet via the Web Share API (files) — Instagram, WhatsApp, Facebook stories
  // are app-only, so this (or a download fallback on desktop) is the only way
  // to get the image into a story. Version the story image URL the same way as
  // the og image so re-submits re-render.
  const ogVersionForStory = String(row.submitted_at ?? '').replace(/[^0-9]/g, '') || String(row.vibe_score);
  const storyImg = `${url.origin}/story/${encodeURIComponent(row.gh_login)}/${ogVersionForStory}.png`;
  const caption = `My VIBE score is ${fmtInt(row.vibe_score)} — certified ${rank.toUpperCase()}. What's yours? npx viberuler  ${url.origin}/u/${encodeURIComponent(row.gh_login)}`;
  const shareBlock = sus
    ? ''
    : `<div class="share">
      <button id="story-share" type="button">📲 Share to Stories</button>
      <a class="wa" href="https://wa.me/?text=${encodeURIComponent(caption)}" target="_blank" rel="noopener">or send via WhatsApp</a>
      <div class="stint">opens your phone's share sheet — Instagram, Facebook, WhatsApp. On desktop it downloads the card to post.</div>
    </div>
    <script>(function(){var S=${JSON.stringify(storyImg)},C=${JSON.stringify(caption)},b=document.getElementById('story-share');if(!b)return;b.addEventListener('click',async function(){try{var r=await fetch(S);var f=new File([await r.blob()],'viberuler-story.png',{type:'image/png'});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],text:C});return;}}catch(e){}var a=document.createElement('a');a.href=S;a.download='viberuler-story.png';document.body.appendChild(a);a.click();a.remove();});})();</script>`;
  const body = card + shareBlock;
  const title = sus
    ? `@${row.gh_login} — under review`
    : `@${row.gh_login} — VIBE ${fmtInt(row.vibe_score)}`;
  const description = sus
    ? `@${row.gh_login}'s submission is under review by the Bureau of Vibe Measurement. Get your own VIBE score: npx viberuler`
    : [
        `VIBE ${fmtInt(row.vibe_score)}`,
        row.tok_per_usd !== null ? `${fmtInt(row.tok_per_usd)} tokens/$` : null,
        row.loc > 0 ? `${fmtInt(row.loc)} lines shipped` : null,
        `certified ${rank}`,
      ]
        .filter(Boolean)
        .join(' · ') + `. GitHub-verified benchmark for vibe coders — get yours: npx viberuler`;
  const ogVersion = String(row.submitted_at ?? '').replace(/[^0-9]/g, '') || String(row.vibe_score);
  return new Response(page(title, row.gh_login, body, url.origin, description, ogVersion), {
    status: 200, headers,
  });
}
