import { ImageResponse } from 'workers-og';
import type { Env } from '../index.js';
import { gaugeHtml, PALETTE } from '../brand.js';
import font from '../assets/JetBrainsMono-Regular.ttf';
import { shareCardSchema, SANITY_CAPS, type ShareCardPayload } from '../validation.js';
import { escapeHtml } from './share.js';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function sanitizeLabel(s: string): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

export function cardCertificateHtml(data: ShareCardPayload): string {
  const scoreDisplay = fmtInt(data.s);

  const locLine =
    data.loc > 0
      ? `<div style="display:flex;font-size:24px;color:${PALETTE.green};margin-top:10px">${fmtInt(data.loc)} lines of code shipped</div>`
      : '';

  const hoursLine =
    data.hours !== undefined && data.hours > 0
      ? `<div style="display:flex;font-size:22px;color:${PALETTE.amber};margin-top:10px">${data.hours.toFixed(1)}h of your attention</div>`
      : '';

  const tokPerUsd =
    data.tpu !== null && data.tpu > 0
      ? `<div style="display:flex;font-size:28px;color:${PALETTE.amber};margin-top:10px">${fmtInt(data.tpu)} tokens per dollar</div>`
      : '';
  const tokPerLoc =
    data.tpl !== null && data.tpl > 0
      ? `<div style="display:flex;font-size:18px;color:${PALETTE.violet};margin-top:4px">${fmtInt(data.tpl)} tokens / line shipped</div>`
      : '';

  const metaParts: string[] = [];
  if (data.streak > 0) metaParts.push(`${data.streak}-day streak`);
  if (data.agents && data.agents.length > 0) {
    const shown = data.agents.slice(0, 3).map(escapeHtml).join(' · ');
    const extra = data.agents.length > 3 ? ` +${data.agents.length - 3}` : '';
    metaParts.push(`${data.agents.length} agents in the stable: ${shown}${extra}`);
  }
  const metaLine = metaParts.length
    ? `<div style="display:flex;font-size:18px;color:${PALETTE.ivory};margin-top:10px">${metaParts.join('   ·   ')}</div>`
    : '';

  return `
    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;
                width:1200px;height:630px;background:${PALETTE.base};color:${PALETTE.ivory};
                font-family:'JetBrains Mono';padding:40px">
      <div style="display:flex;font-size:26px;letter-spacing:4px;color:${PALETTE.violet}">CERTIFICATE OF VIBE MEASUREMENT</div>
      <div style="display:flex;font-size:20px;letter-spacing:2px;color:${PALETTE.stamp};margin-top:10px;padding:4px 16px;border:1px solid ${PALETTE.stamp}">SELF-REPORTED · UNVERIFIED</div>
      <div style="display:flex;font-size:84px;color:${PALETTE.green};margin:10px 0">${scoreDisplay}</div>
      ${gaugeHtml(data.s, { compact: true })}
      ${locLine}
      ${hoursLine}
      ${tokPerUsd}
      ${tokPerLoc}
      ${metaLine}
      <div style="display:flex;font-size:18px;color:${PALETTE.muted};margin-top:20px">— The Bureau · calibrated to ±0.001 vibes</div>
      <div style="display:flex;font-size:18px;color:${PALETTE.muted};margin-top:8px">npx viberuler</div>
    </div>`;
}

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function handleCard(_request: Request, _env: Env, url: URL): Promise<Response> {
  const d = url.searchParams.get('d');
  if (!d) {
    return new Response('missing d', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (d.length > 2400) {
    return new Response('payload too large', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  let parsedJson: unknown;
  try {
    const decoded = base64urlDecode(d);
    parsedJson = JSON.parse(decoded);
  } catch {
    return new Response('invalid card data', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const parseResult = shareCardSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    return new Response('invalid card data', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const raw = parseResult.data;
  const sanitizedAgents = raw.agents
    ? raw.agents
        .map(sanitizeLabel)
        .filter((s) => s.length > 0)
        .slice(0, 3)
    : undefined;

  const clampedData: ShareCardPayload = {
    v: raw.v,
    s: Math.min(raw.s, SANITY_CAPS.vibe_score),
    tpu: raw.tpu !== null ? Math.min(raw.tpu, SANITY_CAPS.tok_per_usd) : null,
    tpl: raw.tpl !== null ? Math.min(raw.tpl, SANITY_CAPS.tok_per_loc) : null,
    loc: Math.min(raw.loc, SANITY_CAPS.loc),
    streak: Math.min(raw.streak, SANITY_CAPS.streak),
    ...(raw.hours !== undefined ? { hours: Math.min(raw.hours, 100_000) } : {}),
    ...(sanitizedAgents && sanitizedAgents.length > 0 ? { agents: sanitizedAgents } : {}),
  };

  const html = cardCertificateHtml(clampedData);
  const img = new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: [{ name: 'JetBrains Mono', data: font as unknown as ArrayBuffer, weight: 400, style: 'normal' }],
  });

  const headers = new Headers(img.headers);
  headers.set('cache-control', 'public, max-age=300');
  headers.set('content-type', 'image/png');
  return new Response(img.body, { status: img.status, headers });
}
