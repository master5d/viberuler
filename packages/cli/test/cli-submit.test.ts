import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

const fixture = fileURLToPath(new URL('./fixtures/claude/session-a.jsonl', import.meta.url));
let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'vibe-submit-'));
  const proj = join(home, '.claude', 'projects', 'p1');
  await mkdir(proj, { recursive: true });
  await copyFile(fixture, join(proj, 's.jsonl'));
  process.env.VIBERULER_HOME = home;
  process.env.VIBERULER_API = 'https://api.test';
});

afterAll(() => {
  delete process.env.VIBERULER_HOME;
  delete process.env.VIBERULER_API;
});

function mockNet(): { calls: string[]; fetchImpl: typeof fetch } {
  const calls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/percentile')) return new Response(JSON.stringify({ percentile: 0.9, sample: 5 }));
    if (u.includes('login/device/code'))
      return new Response(JSON.stringify({ device_code: 'd', user_code: 'AB-12', verification_uri: 'https://gh/dev', interval: 0 }));
    if (u.includes('login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'tok' }));
    if (u.includes('/api/submit'))
      return new Response(JSON.stringify({ ok: true, url: 'https://api.test/u/me', rank: 2, percentile: 0.9, sus: false }));
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('main --submit', () => {
  it('runs the full flow with --yes: percentile → payload print → device flow → submit → share links', async () => {
    const lines: string[] = [];
    const { calls, fetchImpl } = mockNet();
    const code = await main(['--submit', '--yes', '--scan-dir', home], (l) => lines.push(l), { fetchImpl });
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('EVERYTHING that leaves your machine');
    expect(text).toContain('AB-12');
    expect(text).toContain('https://api.test/u/me');
    expect(text).toContain('twitter.com/intent/tweet');
    expect(calls.some((c) => c.includes('/api/percentile'))).toBe(true);
    expect(calls.some((c) => c.includes('/api/submit'))).toBe(true);
  });

  it('refuses without --yes when stdin is not a TTY', async () => {
    const { fetchImpl } = mockNet();
    const code = await main(['--submit', '--scan-dir', home], () => {}, { fetchImpl });
    expect(code).toBe(1);
  });

  it('default run makes zero network calls', async () => {
    const { calls, fetchImpl } = mockNet();
    const code = await main(['--no-color', '--scan-dir', home], () => {}, { fetchImpl });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
  });
});
