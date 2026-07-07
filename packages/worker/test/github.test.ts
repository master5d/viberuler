import { describe, it, expect } from 'vitest';
import { verifyGithubToken } from '../src/github.js';

const okFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  expect(String(url)).toBe('https://api.github.com/user');
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok_1');
  return new Response(
    JSON.stringify({ id: 42, login: 'master5d', avatar_url: 'https://a.png', created_at: '2020-01-01T00:00:00Z' }),
    { status: 200 },
  );
}) as typeof fetch;

describe('verifyGithubToken', () => {
  it('maps a valid /user response to GhUser', async () => {
    const u = await verifyGithubToken('tok_1', okFetch);
    expect(u).toEqual({ gh_id: 42, gh_login: 'master5d', avatar_url: 'https://a.png', gh_created_at: '2020-01-01T00:00:00Z' });
  });
  it('returns null on 401', async () => {
    const bad = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    expect(await verifyGithubToken('nope', bad)).toBeNull();
  });
  it('returns null on thrown fetch', async () => {
    const boom = (async () => { throw new Error('net'); }) as typeof fetch;
    expect(await verifyGithubToken('tok', boom)).toBeNull();
  });
});
