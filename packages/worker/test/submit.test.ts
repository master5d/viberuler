import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';

// NOTE (API drift from the task brief): the installed @cloudflare/vitest-pool-workers
// (0.18.0) does not export a `fetchMock` from 'cloudflare:test' — its cloudflare-test.d.ts
// has no such binding (only `env`, `SELF`, DO/Workflow introspection helpers, D1 migration
// helpers, etc.), and nothing under its dist references `fetchMock` either. Tests run inside
// the same workerd isolate as the worker under test (`exports.default.fetch`), so we get the
// same effect by swapping the global `fetch` for a small queue-based stub: the route's
// `verifyGithubToken(token)` call resolves its `fetchImpl` default parameter against the
// live global `fetch` at call time, so overriding `globalThis.fetch` here is intercepted by
// the route exactly like the brief's `fetchMock` would have been. Assertions and route
// behavior are unchanged from the brief.
const originalFetch = globalThis.fetch;
let ghQueue: Array<{ status: number; body: object }> = [];

function installGithubFetchStub() {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
    if (href === 'https://api.github.com/user') {
      const next = ghQueue.shift();
      if (!next) throw new Error('unexpected github fetch: no mock queued');
      return new Response(JSON.stringify(next.body), { status: next.status });
    }
    return originalFetch(url, init);
  }) as typeof fetch;
}

const VALID = {
  client_version: '0.1.0', vibe_score: 3101, loc: 312441, projects: 47,
  tokens: 1_200_000_000, cost_usd: 184.2, tok_per_usd: 6_500_000,
  achievements: ['token-billionaire'], breakdown: { volume: 1000 },
};

const GH_USER = { id: 42, login: 'master5d', avatar_url: 'https://a.png', created_at: '2020-01-01T00:00:00Z' };

function mockGithub(status = 200, body: object = GH_USER) {
  ghQueue.push({ status, body });
}

function post(payload: unknown, token = 'tok_1') {
  return exports.default.fetch('https://viberuler.dev/api/submit', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeAll(() => {
  installGithubFetchStub();
});

beforeEach(async () => {
  ghQueue = [];
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
});

afterEach(() => {
  expect(ghQueue).toEqual([]);
});

describe('POST /api/submit', () => {
  it('401 without a token', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/api/submit', {
      method: 'POST', body: JSON.stringify(VALID), headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('401 when github rejects the token', async () => {
    mockGithub(401, {});
    expect((await post(VALID)).status).toBe(401);
  });

  it('400 on invalid payload', async () => {
    mockGithub();
    expect((await post({ ...VALID, evil: 1 })).status).toBe(400);
  });

  it('200 stores score and returns url + rank + percentile', async () => {
    mockGithub();
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.login).toBe('master5d');
    expect(body.url).toBe('https://viberuler.dev/u/master5d');
    expect(body.rank).toBe(1);
    expect(body.sus).toBe(false);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('caps trip sus: stored but rank null', async () => {
    mockGithub();
    const res = await post({ ...VALID, loc: 50_000_001 });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.sus).toBe(true);
    expect(body.rank).toBeNull();
  });

  it('429 on the 6th submit within an hour', async () => {
    for (let i = 0; i < 5; i++) {
      mockGithub();
      expect((await post(VALID)).status).toBe(200);
    }
    mockGithub();
    expect((await post(VALID)).status).toBe(429);
  });
});
