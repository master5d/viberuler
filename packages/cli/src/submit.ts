import type { SubmitPayload } from './payload.js';
import { fmtCompact, fmtUsd } from './format.js';

export const DEFAULT_API = 'https://viberuler.dev';
export const DEFAULT_CLIENT_ID = 'Ov23li4ZfCaG86O8UGR3';

export interface SubmitDeps {
  fetchImpl?: typeof fetch;
  out: (s: string) => void;
  pollIntervalMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function githubDeviceFlow(clientId: string, deps: SubmitDeps): Promise<string> {
  const doFetch = deps.fetchImpl ?? fetch;
  const codeRes = await doFetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: '' }),
  });
  if (!codeRes.ok) throw new Error(`device code request failed: ${codeRes.status}`);
  const code = (await codeRes.json()) as {
    device_code: string; user_code: string; verification_uri: string; interval?: number;
  };

  deps.out('');
  deps.out(`  Open ${code.verification_uri} and enter code: ${code.user_code}`);
  deps.out('  Waiting for authorization...');

  let interval = deps.pollIntervalMs ?? Math.max(1, code.interval ?? 5) * 1000;
  for (;;) {
    await sleep(interval);
    const tokenRes = await doFetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: code.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const body = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (body.access_token) return body.access_token;
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') { interval += 5000; continue; }
    throw new Error(`device flow ${body.error ?? 'failed'}${body.error === 'expired_token' ? ' — code expired, run again' : ''}`);
  }
}

export async function fetchPercentile(
  apiBase: string,
  tokPerUsd: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const res = await fetchImpl(`${apiBase}/api/percentile?tok_per_usd=${encodeURIComponent(tokPerUsd)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { percentile?: number };
    return typeof body.percentile === 'number' ? body.percentile : null;
  } catch {
    return null;
  }
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  url?: string;
  rank?: number | null;
  percentile?: number | null;
  sus?: boolean;
  error?: string;
}

export async function submitScore(
  apiBase: string,
  token: string,
  payload: SubmitPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitResult> {
  try {
    const res = await fetchImpl(`${apiBase}/api/submit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: String(body.error ?? res.status) };
    return { ...(body as Partial<SubmitResult>), ok: true, status: res.status } as SubmitResult;
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export function shareLinks(shareUrl: string, payload: SubmitPayload): { x: string; linkedin: string; bluesky: string } {
  const text = `I burned ${fmtCompact(payload.tokens)} tokens for ${fmtUsd(payload.cost_usd)}. VIBE score ${payload.vibe_score}. What's yours? npx viberuler ${shareUrl}`;
  const enc = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${enc}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    bluesky: `https://bsky.app/intent/compose?text=${enc}`,
  };
}
