import { describe, it, expect, beforeEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { upsertUser, insertScore } from '../src/db.js';
import { storyHtml } from '../src/routes/story.js';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
  const a = await upsertUser(env.DB, { gh_id: 1, gh_login: 'master5d', avatar_url: null, gh_created_at: null });
  await insertScore(env.DB, a, {
    vibe_score: 4123, loc: 19979, projects: 47, tokens: 10_900_000_000, cost_usd: 24, streak_days: 125,
    tok_per_usd: 450300, achievements: [], breakdown: {}, client_version: '0.3.0',
  }, false);
});

describe('GET /story/:login.png', () => {
  it('renders a vertical PNG for a known login', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/story/master5d.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('renders for the path-versioned URL (version segment ignored)', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/story/master5d/20260709171746.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });

  it('404 for unknown login', async () => {
    expect((await exports.default.fetch('https://viberuler.dev/story/ghost.png')).status).toBe(404);
  });
});

describe('storyHtml', () => {
  it('composes the Wrapped-style bands, score, rank and certification for a clean row', () => {
    const html = storyHtml({
      gh_login: 'master5d', vibe_score: 4123, rank: 12, sus: 0,
      loc: 19979, tokens: 10_900_000_000, projects: 47, tok_per_usd: 450300, streak_days: 125,
    });
    expect(html).toContain('CERTIFICATE OF VIBE MEASUREMENT');
    expect(html).toContain('@master5d');
    expect(html).toContain('10.9B'); // compact tokens
    expect(html).toContain('tokens burned');
    expect(html).toContain('450.3K'); // compact tok/$
    expect(html).toContain('19,979');
    expect(html).toContain('47');
    expect(html).toContain('125');
    expect(html).toContain('4,123');
    expect(html).toContain('GLOBAL RANK #12');
    expect(html).toContain('The Bureau certifies: CONTEXT GOBLIN');
    expect(html).toContain('npx viberuler');
  });

  it('hides score/stats and shows UNDER REVIEW for a sus row', () => {
    const html = storyHtml({
      gh_login: 'sussy', vibe_score: 9999, rank: 0, sus: 1,
      loc: 88888, tokens: 5_000_000_000, projects: 9, tok_per_usd: 500, streak_days: 77,
    });
    expect(html).toContain('UNDER REVIEW');
    expect(html).not.toContain('9,999');
    expect(html).not.toContain('tokens burned');
    expect(html).not.toContain('GLOBAL RANK');
  });
});
