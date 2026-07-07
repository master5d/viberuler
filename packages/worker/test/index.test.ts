import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

describe('router', () => {
  it('GET /api/health returns ok', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown route returns 404 json', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/nope');
    expect(res.status).toBe(404);
  });
});
