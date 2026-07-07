import { describe, it, expect, beforeEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { upsertUser, insertScore } from '../src/db.js';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
  const a = await upsertUser(env.DB, { gh_id: 1, gh_login: 'master5d', avatar_url: null, gh_created_at: null });
  await insertScore(env.DB, a, {
    vibe_score: 3101, loc: 1, projects: 1, tokens: 1000, cost_usd: 1,
    tok_per_usd: 1000, achievements: [], breakdown: {}, client_version: '0.1.0',
  }, false);
});

describe('GET /og/:login.png', () => {
  it('renders a PNG for a known login', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/og/master5d.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const buf = new Uint8Array(await res.arrayBuffer());
    // PNG magic bytes
    expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('404 for unknown login', async () => {
    expect((await exports.default.fetch('https://viberuler.dev/og/ghost.png')).status).toBe(404);
  });
});
