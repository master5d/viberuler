import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { getTokenPath } from '../src/submit.js';

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

  it('token cache: first submit writes cache, second submit reuses without device flow, 401 clears cache and invokes device flow once', async () => {
    const testHome = await mkdtemp(join(tmpdir(), 'vibe-submit-cache-'));
    process.env.VIBERULER_HOME = testHome;

    let deviceFlowCount = 0;
    const fetchImplOk = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/percentile')) return new Response(JSON.stringify({ percentile: 0.9 }));
      if (u.includes('login/device/code')) {
        deviceFlowCount++;
        return new Response(JSON.stringify({ device_code: 'd', user_code: 'DF-1', verification_uri: 'https://gh/dev', interval: 0 }));
      }
      if (u.includes('login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'fresh_tok' }));
      if (u.includes('/api/submit')) {
        return new Response(JSON.stringify({ ok: true, url: 'https://api.test/u/me', rank: 1 }), { status: 200 });
      }
      throw new Error(`unexpected url ${u}`);
    }) as typeof fetch;

    // 1st submit: writes cache
    const lines1: string[] = [];
    const code1 = await main(['--submit', '--yes', '--scan-dir', home], (l) => lines1.push(l), { fetchImpl: fetchImplOk });
    expect(code1).toBe(0);
    expect(deviceFlowCount).toBe(1);
    expect(lines1.join('\n')).not.toContain('using saved GitHub auth');

    const cacheFile = getTokenPath(testHome);
    const st = await stat(cacheFile);
    expect(st.isFile()).toBe(true);
    if (process.platform !== 'win32') {
      expect((st.mode & 0o777).toString(8)).toBe('600');
    }

    // 2nd submit: reuses cached token (no device flow invocation)
    const lines2: string[] = [];
    const code2 = await main(['--submit', '--yes', '--scan-dir', home], (l) => lines2.push(l), { fetchImpl: fetchImplOk });
    expect(code2).toBe(0);
    expect(deviceFlowCount).toBe(1);
    expect(lines2.join('\n')).toContain('using saved GitHub auth');

    // 3rd submit: cached token returns 401 -> device flow invoked once, fresh token saved and submitted
    let submitAttempt = 0;
    const fetchImpl401 = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/percentile')) return new Response(JSON.stringify({ percentile: 0.9 }));
      if (u.includes('login/device/code')) {
        deviceFlowCount++;
        return new Response(JSON.stringify({ device_code: 'd2', user_code: 'DF-2', verification_uri: 'https://gh/dev', interval: 0 }));
      }
      if (u.includes('login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'new_tok' }));
      if (u.includes('/api/submit')) {
        submitAttempt++;
        if (submitAttempt === 1) {
          return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true, url: 'https://api.test/u/me', rank: 1 }), { status: 200 });
      }
      throw new Error(`unexpected url ${u}`);
    }) as typeof fetch;

    const lines3: string[] = [];
    const code3 = await main(['--submit', '--yes', '--scan-dir', home], (l) => lines3.push(l), { fetchImpl: fetchImpl401 });
    expect(code3).toBe(0);
    expect(deviceFlowCount).toBe(2);
    expect(lines3.join('\n')).toContain('using saved GitHub auth');

    process.env.VIBERULER_HOME = home;
  });
});
