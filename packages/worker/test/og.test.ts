import { describe, it, expect, beforeEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { upsertUser, insertScore } from '../src/db.js';
import { certificateHtml } from '../src/routes/og.js';

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

describe('certificateHtml', () => {
  it('composes a certificate for a clean row', () => {
    const html = certificateHtml({
      gh_login: 'master5d',
      vibe_score: 3101,
      rank: 4,
      sus: 0,
      tok_per_usd: 1000,
      tok_per_loc: 42,
    } as any);
    expect(html).toContain('CERTIFICATE OF VIBE MEASUREMENT');
    expect(html).toContain('@master5d');
    expect(html).toContain('The Bureau certifies:');
    expect(html).toContain('TOKEN BURNER');
    expect(html).toContain('GLOBAL RANK #4');
    expect(html).toContain('3,101');
    expect(html).toContain('1,000 tokens per dollar');
    expect(html).toContain('42 tokens / line shipped');
    expect(html).toContain('npx viberuler');
  });

  it('hides the score, tier, and stats and shows PENDING CERTIFICATION for a sus row', () => {
    const html = certificateHtml({
      gh_login: 'sussy',
      vibe_score: 9999,
      rank: 0,
      sus: 1,
      tok_per_usd: 500,
      tok_per_loc: 20,
    } as any);
    expect(html).toContain('UNDER REVIEW');
    expect(html).toContain('PENDING CERTIFICATION');
    expect(html).not.toContain('9,999');
    expect(html).not.toContain('The Bureau certifies:');
    expect(html).not.toContain('SINGULARITY ADJACENT');
    expect(html).not.toContain('tokens per dollar');
    expect(html).not.toContain('tokens / line shipped');
    expect(html).not.toContain('500');
    expect(html).not.toContain('20 tokens');
  });
});
