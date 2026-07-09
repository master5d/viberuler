import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

describe('GET /favicon.svg', () => {
  it('returns the VR notary seal as SVG', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/favicon.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');

    const body = await res.text();
    expect(body).toContain('>VR<');
    expect(body).not.toContain('BUREAU OF VIBE MEASUREMENT');
  });

  it('sets cache-control: public, max-age=604800, immutable', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/favicon.svg');
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, immutable');
  });
});
