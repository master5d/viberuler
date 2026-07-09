import { describe, it, expect } from 'vitest';
import { githubDeviceFlow, fetchPercentile, submitScore, shareLinks } from '../src/submit.js';

const PAYLOAD = {
  client_version: '0.1.0', vibe_score: 3101, loc: 100, projects: 1, tokens: 1_200_000_000,
  cost_usd: 184.2, tok_per_usd: 6_500_000, tok_per_loc: 8400, streak_days: 32,
  agents: ['Claude Code', 'Codex'], achievements: [], breakdown: {},
};

function seqFetch(responses: Array<() => Response>): typeof fetch {
  let i = 0;
  return (async () => responses[Math.min(i++, responses.length - 1)]!()) as typeof fetch;
}

describe('githubDeviceFlow', () => {
  it('prints the user code and polls until token', async () => {
    const lines: string[] = [];
    const fetchImpl = seqFetch([
      () => new Response(JSON.stringify({
        device_code: 'dev1', user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device', interval: 0,
      }), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 200 }),
      () => new Response(JSON.stringify({ access_token: 'gho_tok' }), { status: 200 }),
    ]);
    const token = await githubDeviceFlow('cid', { fetchImpl, out: (s) => lines.push(s), pollIntervalMs: 1 });
    expect(token).toBe('gho_tok');
    expect(lines.join('\n')).toContain('ABCD-1234');
    expect(lines.join('\n')).toContain('github.com/login/device');
  });

  it('throws on expired_token', async () => {
    const fetchImpl = seqFetch([
      () => new Response(JSON.stringify({ device_code: 'd', user_code: 'X', verification_uri: 'u', interval: 0 }), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'expired_token' }), { status: 200 }),
    ]);
    await expect(githubDeviceFlow('cid', { fetchImpl, out: () => {}, pollIntervalMs: 1 })).rejects.toThrow(/expired/);
  });
});

describe('fetchPercentile', () => {
  it('returns percentile from the API', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ percentile: 0.87, sample: 10 }))) as typeof fetch;
    expect(await fetchPercentile('https://api.test', 100, fetchImpl)).toBe(0.87);
  });
  it('null on failure (offline fallback)', async () => {
    const fetchImpl = (async () => { throw new Error('offline'); }) as typeof fetch;
    expect(await fetchPercentile('https://api.test', 100, fetchImpl)).toBeNull();
  });
});

describe('submitScore', () => {
  it('POSTs payload with bearer and returns server body', async () => {
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.test/api/submit');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
      expect(JSON.parse(String(init?.body)).vibe_score).toBe(3101);
      return new Response(JSON.stringify({ ok: true, url: 'https://api.test/u/x', rank: 3, sus: false }), { status: 200 });
    }) as typeof fetch;
    const r = await submitScore('https://api.test', 'tok', PAYLOAD, fetchImpl);
    expect(r.ok).toBe(true);
    expect(r.rank).toBe(3);
  });
  it('surfaces 429 as error', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'rate limit' }), { status: 429 })) as typeof fetch;
    const r = await submitScore('https://api.test', 'tok', PAYLOAD, fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });
});

describe('shareLinks', () => {
  it('builds encoded intents for x/linkedin/facebook/bluesky', () => {
    const links = shareLinks('https://viberuler.dev/u/master5d', PAYLOAD);
    expect(links.x).toContain('https://twitter.com/intent/tweet?text=');
    expect(links.x).toContain(encodeURIComponent('npx viberuler'));
    expect(links.x).toContain(encodeURIComponent('https://viberuler.dev/u/master5d'));
    expect(links.linkedin).toContain('linkedin.com');
    expect(links.facebook).toContain('facebook.com/sharer/sharer.php?u=');
    expect(links.bluesky).toContain('bsky.app');
  });

  it('escapes the apostrophe so terminals do not split the link ("What\'s yours?")', () => {
    const links = shareLinks('https://viberuler.dev/u/master5d', PAYLOAD);
    // encodeURIComponent leaves ' raw; we must emit %27 so the URL is one token
    for (const link of [links.x, links.bluesky]) {
      expect(link).not.toContain("'");
      expect(link).toContain('%27'); // the apostrophe from "What's"
    }
  });
});
