import { describe, it, expect, afterEach } from 'vitest';
import { exports } from 'cloudflare:workers';
import { handleContact } from '../src/routes/contact.js';
import type { Env } from '../src/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const post = (body: unknown) =>
  new Request('https://viberuler.dev/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const fakeEnv = (over: Partial<Env> = {}): Env =>
  ({ RESEND_API_KEY: 'test-key', CONTACT_TO: 'to@x.com', CONTACT_FROM: 'from@x.com', ...over }) as unknown as Env;

describe('handleContact', () => {
  it('sends via Resend for a valid submission and reports ok', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response('{"id":"abc"}', { status: 200 });
    }) as typeof fetch;

    const res = await handleContact(post({ name: 'Ada', email: 'ada@example.com', message: 'hello bureau' }), fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(captured!.url).toBe('https://api.resend.com/emails');
    const sent = JSON.parse(String(captured!.init.body));
    expect(sent.to).toEqual(['to@x.com']);
    expect(sent.from).toBe('from@x.com');
    expect(sent.reply_to).toBe('ada@example.com');
    expect(sent.text).toContain('hello bureau');
    expect(sent.text).toContain('Ada');
    expect((captured!.init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
  });

  it('drops honeypot hits silently without sending', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const res = await handleContact(
      post({ email: 'bot@spam.com', message: 'spam', fax: '555-0100' }),
      fakeEnv(),
    );
    expect(res.status).toBe(200);
    expect(called).toBe(false);
  });

  it('rejects an invalid email', async () => {
    const res = await handleContact(post({ email: 'not-an-email', message: 'hi there' }), fakeEnv());
    expect(res.status).toBe(400);
  });

  it('rejects an empty message', async () => {
    const res = await handleContact(post({ email: 'a@b.co', message: '' }), fakeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 502 when Resend rejects', async () => {
    globalThis.fetch = (async () => new Response('{"error":"nope"}', { status: 422 })) as typeof fetch;
    const res = await handleContact(post({ email: 'a@b.co', message: 'valid message' }), fakeEnv());
    expect(res.status).toBe(502);
  });

  it('returns 503 when the API key is not configured', async () => {
    const res = await handleContact(post({ email: 'a@b.co', message: 'valid message' }), fakeEnv({ RESEND_API_KEY: undefined }));
    expect(res.status).toBe(503);
  });
});

describe('POST /api/contact routing', () => {
  it('is wired and validates (503 without a configured key in test env)', async () => {
    const res = await exports.default.fetch(post({ email: 'a@b.co', message: 'routed message' }));
    // test env has no RESEND_API_KEY secret → route reaches the handler and 503s
    expect(res.status).toBe(503);
  });

  it('rejects a bad email through the route', async () => {
    const res = await exports.default.fetch(post({ email: 'bad', message: 'x y' }));
    expect(res.status).toBe(400);
  });
});
