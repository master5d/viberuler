import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';
import { handleContact, buildContactMime } from '../src/routes/contact.js';
import type { Env } from '../src/index.js';

const post = (body: unknown) =>
  new Request('https://viberuler.dev/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// A fake send_email binding capturing the message; `fail` makes send throw.
function fakeEnv(over: { fail?: boolean; noBinding?: boolean } = {}): { env: Env; sent: unknown[] } {
  const sent: unknown[] = [];
  const CONTACT_EMAIL = over.noBinding
    ? undefined
    : {
        async send(m: unknown) {
          if (over.fail) throw new Error('email routing not enabled');
          sent.push(m);
        },
      };
  return { env: { CONTACT_EMAIL, CONTACT_TO: 'to@x.com', CONTACT_FROM: 'from@x.com' } as unknown as Env, sent };
}

describe('buildContactMime', () => {
  it('produces a raw message with the recipient, sender and reply-to headers', () => {
    const raw = buildContactMime({ name: 'Ada', email: 'ada@example.com', message: 'hello world body', from: 'from@x.com', to: 'to@x.com' });
    expect(raw).toContain('to@x.com');
    expect(raw).toContain('from@x.com');
    expect(raw).toMatch(/Reply-To:.*ada@example\.com/);
    expect(raw).toContain('Content-Type: text/plain');
    // plain-text body carries the submitter and message
    expect(raw).toContain('Ada <ada@example.com>');
    expect(raw).toContain('hello world body');
  });
});

describe('handleContact', () => {
  it('sends via the email binding for a valid submission and reports ok', async () => {
    const { env, sent } = fakeEnv();
    const res = await handleContact(post({ name: 'Ada', email: 'ada@example.com', message: 'hello bureau' }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
  });

  it('drops honeypot hits silently without sending', async () => {
    const { env, sent } = fakeEnv();
    const res = await handleContact(post({ email: 'bot@spam.com', message: 'spam', fax: '555-0100' }), env);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    const res = await handleContact(post({ email: 'not-an-email', message: 'hi there' }), fakeEnv().env);
    expect(res.status).toBe(400);
  });

  it('rejects an empty message', async () => {
    const res = await handleContact(post({ email: 'a@b.co', message: '' }), fakeEnv().env);
    expect(res.status).toBe(400);
  });

  it('returns 502 when the email send throws', async () => {
    const res = await handleContact(post({ email: 'a@b.co', message: 'valid message' }), fakeEnv({ fail: true }).env);
    expect(res.status).toBe(502);
  });

  it('returns 503 when the email binding is not configured', async () => {
    const res = await handleContact(post({ email: 'a@b.co', message: 'valid message' }), fakeEnv({ noBinding: true }).env);
    expect(res.status).toBe(503);
  });
});

describe('POST /api/contact routing', () => {
  it('rejects a bad email through the route', async () => {
    const res = await exports.default.fetch(post({ email: 'bad', message: 'x y' }));
    expect(res.status).toBe(400);
  });
});
