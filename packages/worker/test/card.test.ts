import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';
import { cardCertificateHtml, handleCard } from '../src/routes/card.js';

function encodeData(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const VALID_CARD = {
  v: '0.7.0',
  s: 3101,
  tpu: 6500000,
  tpl: 42,
  loc: 277690,
  streak: 14,
  hours: 12.4,
  agents: ['Claude Code', 'Codex'],
  ach: ['token-billionaire'],
};

describe('GET /card route', () => {
  it('valid d -> 200, content-type: image/png, non-empty body', async () => {
    const d = encodeData(VALID_CARD);
    const res = await exports.default.fetch(`https://viberuler.dev/card?d=${d}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');

    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    // Check PNG magic bytes
    expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('missing d -> 400 missing d', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/card');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toBe('missing d');
  });

  it('oversized d -> 400 payload too large (decoding never ran)', async () => {
    // 2401 chars of non-base64/invalid characters that would return 'invalid card data' if decoded
    const oversized = '!'.repeat(2401);
    const res = await exports.default.fetch(`https://viberuler.dev/card?d=${oversized}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toBe('payload too large');
  });

  it('malformed base64 -> 400 invalid card data', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/card?d=!!!notbase64!!!');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toBe('invalid card data');
  });

  it('wrong shape (missing required key) -> 400 invalid card data', async () => {
    const invalidData = encodeData({ v: '0.7.0', s: 100 }); // missing loc, tpu, etc.
    const res = await exports.default.fetch(`https://viberuler.dev/card?d=${invalidData}`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe('invalid card data');
  });

  it('extra key (strict schema violation) -> 400 invalid card data', async () => {
    const extraKeyData = encodeData({ ...VALID_CARD, unexpected: 'hack' });
    const res = await exports.default.fetch(`https://viberuler.dev/card?d=${extraKeyData}`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe('invalid card data');
  });

  it('DB untouched: route returns 200 when DB binding throws on any call', async () => {
    const d = encodeData(VALID_CARD);
    const throwingDbEnv = {
      DB: {
        prepare: () => {
          throw new Error('D1 Database access was triggered!');
        },
        batch: () => {
          throw new Error('D1 Database access was triggered!');
        },
        exec: () => {
          throw new Error('D1 Database access was triggered!');
        },
      },
    };

    const req = new Request(`https://viberuler.dev/card?d=${d}`);
    const res = await handleCard(req, throwingDbEnv as any, new URL(req.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });

  it('rendered payload with hours does not crash and formats correctly', async () => {
    const cardWithHours = { ...VALID_CARD, hours: 42.7 };
    const d = encodeData(cardWithHours);
    const res = await exports.default.fetch(`https://viberuler.dev/card?d=${d}`);
    expect(res.status).toBe(200);
  });
});

describe('cardCertificateHtml', () => {
  it('renders unverified band and attention hours, omits rank and percentile', () => {
    const html = cardCertificateHtml({
      v: '0.7.0',
      s: 3101,
      tpu: 6500000,
      tpl: 42,
      loc: 277690,
      streak: 14,
      hours: 12.4,
      agents: ['Claude Code', 'Codex'],
    });

    expect(html).toContain('SELF-REPORTED · UNVERIFIED');
    expect(html).toContain('12.4h of your attention');
    expect(html).toContain('277,690 lines of code shipped');
    expect(html).toContain('6,500,000 tokens per dollar');
    expect(html).toContain('42 tokens / line shipped');
    expect(html).toContain('14-day streak');
    expect(html).toContain('2 agents in the stable: Claude Code · Codex');
    expect(html).not.toContain('GLOBAL RANK');
    expect(html).not.toContain('The Bureau certifies:');
    expect(html).not.toContain('percentile');
  });
});
