import { describe, it, expect, beforeEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { upsertUser, insertScore } from '../src/db.js';
import { escapeHtml } from '../src/routes/share.js';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
  const a = await upsertUser(env.DB, { gh_id: 1, gh_login: 'master5d', avatar_url: null, gh_created_at: null });
  await insertScore(env.DB, a, {
    vibe_score: 3101, loc: 312441, projects: 47, tokens: 1_200_000_000, cost_usd: 184.2,
    tok_per_usd: 6_500_000, tok_per_loc: 8400, achievements: ['token-billionaire'], breakdown: {}, client_version: '0.1.0',
  }, false);
});

describe('GET /u/:login', () => {
  it('renders the certificate page with score, rank, og meta and CTA', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/u/master5d');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('master5d');
    expect(html).toContain('3,101');
    expect(html).toContain('npx viberuler');
    expect(html).toContain('og:image');
    expect(html).toContain('/og/master5d.png');
    expect(html).toContain('summary_large_image');
  });

  it('renders the certificate framing: subject, tier, paper texture', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/u/master5d');
    const html = await res.text();
    expect(html).toContain('subject');
    expect(html).toContain('master5d');
    expect(html).toContain('The Bureau certifies: TOKEN BURNER');
    expect(html).toContain('.paper');
    expect(html).toContain('tokens per dollar');
    expect(html).toContain('6,500,000');
  });

  it('404 page for unknown login still sells the CTA, Bureau voice', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/u/ghost');
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('npx viberuler');
    expect(html).toContain('subject not on file');
  });

  it('sus rows do not expose the inflated score on the share page', async () => {
    const b = await upsertUser(env.DB, { gh_id: 2, gh_login: 'cheater', avatar_url: null, gh_created_at: null });
    await insertScore(env.DB, b, {
      vibe_score: 999999, loc: 1, projects: 1, tokens: 1000, cost_usd: 1,
      tok_per_usd: 1000, achievements: [], breakdown: {}, client_version: '0.1.0',
    }, true);
    const res = await exports.default.fetch('https://viberuler.dev/u/cheater');
    const html = await res.text();
    expect(html).toContain('UNDER REVIEW');
    expect(html).toContain('PENDING CERTIFICATION');
    expect(html).not.toContain('999,999');
    expect(html).not.toContain('tokens per dollar');
    expect(html).not.toContain('per line');
    expect(html).not.toContain('TOKEN BURNER');
  });

  it('shows tok/line shipped for a clean row', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/u/master5d');
    const html = await res.text();
    expect(html).toContain('8,400');
    expect(html).toContain('per line');
  });

  it('hides tok/line for a sus row even when tok_per_loc is set', async () => {
    const b = await upsertUser(env.DB, { gh_id: 3, gh_login: 'cheater2', avatar_url: null, gh_created_at: null });
    await insertScore(env.DB, b, {
      vibe_score: 999999, loc: 1, projects: 1, tokens: 1000, cost_usd: 1,
      tok_per_usd: 1000, tok_per_loc: 500, achievements: [], breakdown: {}, client_version: '0.1.0',
    }, true);
    const html = await (await exports.default.fetch('https://viberuler.dev/u/cheater2')).text();
    expect(html).toContain('UNDER REVIEW');
    expect(html).not.toContain('per line');
  });
});

describe('escapeHtml', () => {
  it('escapes the dangerous five', () => {
    expect(escapeHtml(`<img src=x onerror="a&'b">`)).toBe('&lt;img src=x onerror=&quot;a&amp;&#39;b&quot;&gt;');
  });
});

describe('GET /api/stats-badge', () => {
  it('returns shields endpoint schema', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/api/stats-badge');
    const body = (await res.json()) as any;
    expect(body.schemaVersion).toBe(1);
    expect(body.label).toBe('tokens benchmarked');
    expect(body.message).toBe('1.2B');
  });
});
