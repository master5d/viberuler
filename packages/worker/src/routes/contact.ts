import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage, Mailbox } from 'mimetext';
import type { Env } from '../index.js';
import { json } from '../index.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_TO = 'mamaev.sasha@gmail.com';
const DEFAULT_FROM = 'contact@viberuler.dev';

// Build the raw RFC 5322 message. mimetext handles UTF-8 header/body encoding
// (Cyrillic names/messages) and Message-ID/Date, so the mail is deliverable.
export function buildContactMime(opts: {
  name: string;
  email: string;
  message: string;
  from: string;
  to: string;
}): string {
  const msg = createMimeMessage();
  msg.setSender({ name: 'VibeRuler Bureau', addr: opts.from });
  msg.setRecipient(opts.to);
  msg.setHeader('Reply-To', new Mailbox({ addr: opts.email })); // reply lands on the submitter
  msg.setSubject(`VibeRuler contact from ${opts.name || opts.email}`);
  msg.addMessage({
    contentType: 'text/plain',
    data: `New VibeRuler contact submission\n\nFrom: ${opts.name || '(no name)'} <${opts.email}>\n\n${opts.message}\n`,
  });
  return msg.asRaw();
}

// Home-page contact form → Cloudflare Email Routing (send_email binding).
// Validates, drops honeypot hits, forwards a plain-text email to the Bureau
// inbox. No PII persisted — the message only lives in the outbound mail.
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

  if (!env.CONTACT_EMAIL) {
    console.log(JSON.stringify({ level: 'error', msg: 'contact: CONTACT_EMAIL binding not configured' }));
    return json({ error: 'contact is temporarily unavailable' }, 503);
  }

  const from = env.CONTACT_FROM || DEFAULT_FROM;
  const to = env.CONTACT_TO || DEFAULT_TO;

  try {
    const raw = buildContactMime({ name, email, message, from, to });
    await env.CONTACT_EMAIL.send(new EmailMessage(from, to, raw));
  } catch (err) {
    // Email Routing not yet enabled / destination unverified / send failure.
    console.log(JSON.stringify({ level: 'error', msg: 'contact: send failed', err: String(err) }));
    return json({ error: 'could not send — try again later' }, 502);
  }

  return json({ ok: true });
}
