import type { Env } from '../index.js';
import { json } from '../index.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_TO = 'mamaev.sasha@gmail.com';
const DEFAULT_FROM = 'VibeRuler Bureau <contact@viberuler.dev>';

// Home-page contact form. Validates, drops honeypot hits, and forwards a
// plain-text email via Resend with the sender as reply-to. Secrets are never
// logged. No PII is persisted — the message only lives in the outbound email.
export async function handleContact(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid request body' }, 400);
  }

  const name = String(body.name ?? '').trim().slice(0, 100);
  const email = String(body.email ?? '').trim().slice(0, 200);
  const message = String(body.message ?? '').trim().slice(0, 5000);
  const honeypot = String(body.fax ?? '').trim();

  // A bot filled the hidden field — accept silently, send nothing.
  if (honeypot) return json({ ok: true });

  if (!EMAIL_RE.test(email)) return json({ error: 'a valid email is required' }, 400);
  if (message.length < 2) return json({ error: 'a message is required' }, 400);

  if (!env.RESEND_API_KEY) {
    console.log(JSON.stringify({ level: 'error', msg: 'contact: RESEND_API_KEY not configured' }));
    return json({ error: 'contact is temporarily unavailable' }, 503);
  }

  const text = `New VibeRuler contact submission\n\nFrom: ${name || '(no name)'} <${email}>\n\n${message}\n`;

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM || DEFAULT_FROM,
        to: [env.CONTACT_TO || DEFAULT_TO],
        reply_to: email,
        subject: `VibeRuler contact — ${name || email}`,
        text,
      }),
    });
  } catch (err) {
    console.log(JSON.stringify({ level: 'error', msg: 'contact: resend fetch threw', err: String(err) }));
    return json({ error: 'could not send — try again later' }, 502);
  }

  if (!res.ok) {
    // Log status only — never the response body or the key.
    console.log(JSON.stringify({ level: 'error', msg: 'contact: resend rejected', status: res.status }));
    return json({ error: 'could not send — try again later' }, 502);
  }

  return json({ ok: true });
}
