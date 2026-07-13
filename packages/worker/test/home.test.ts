import { describe, it, expect, beforeEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { upsertUser, insertScore } from '../src/db.js';
import { rankForVibe } from '../src/brand.js';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
  await env.DB.prepare('DELETE FROM users').run();
});

async function seed(login: string, ghId: number, vibe: number, sus = false): Promise<void> {
  const id = await upsertUser(env.DB, { gh_id: ghId, gh_login: login, avatar_url: null, gh_created_at: null });
  await insertScore(env.DB, id, {
    vibe_score: vibe, loc: 1000, projects: 3, tokens: 5_000_000, cost_usd: 10,
    tok_per_usd: 500_000, achievements: ['token-billionaire'], breakdown: {}, client_version: '0.2.0',
  }, sus);
}

describe('GET /', () => {
  it('renders the Bureau letterhead landing with the top of the board and the CTA', async () => {
    await seed('master5d', 1, 6065);
    await seed('runnerup', 2, 3000);
    const res = await exports.default.fetch('https://viberuler.dev/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('THE INTERNATIONAL BUREAU OF VIBE MEASUREMENT');
    expect(html).toContain('OFFICIAL STANDINGS');
    expect(html).toContain('This measurement is scientifically meaningless. Notarized anyway.');
    expect(html).toContain('Every certificate is GitHub-notarized (device-flow OAuth).');
    expect(html).toContain('.paper');
    expect(html).toContain('npx viberuler');
    expect(html).toContain('@master5d');
    expect(html).toContain('6,065');
    expect(html).toContain('2 coders certified');
    expect(html).toContain(rankForVibe(6065));
    // #1 listed before #2
    expect(html.indexOf('master5d')).toBeLessThan(html.indexOf('runnerup'));
    // contact form: folded into a footer button, not sprawled across the page
    expect(html).toContain('<summary>Contact the Bureau</summary>');
    // <details> with no `open` attribute — collapsed on arrival
    expect(html).toContain('<details class="contact" id="contact">');
    expect(html).not.toContain('<details class="contact" id="contact" open>');
    // …but the form itself is still really there, not lazy-loaded behind a fetch
    expect(html).toContain('id="contact-form"');
    expect(html).toContain('/api/contact');
    expect(html).toContain('name="fax"'); // honeypot present
    expect(html).toContain('mailto:hello@viberuler.dev'); // direct email fallback
    // share links wired
    expect(html).toContain('/u/master5d');
  });

  it('keeps sus scores off the homepage board', async () => {
    await seed('honest', 1, 2000);
    await seed('cheater', 2, 999999, true);
    const html = await (await exports.default.fetch('https://viberuler.dev/')).text();
    expect(html).toContain('@honest');
    expect(html).not.toContain('@cheater');
    expect(html).not.toContain('999,999');
  });

  it('sells the CTA even on an empty board', async () => {
    const html = await (await exports.default.fetch('https://viberuler.dev/')).text();
    expect(html).toContain('npx viberuler');
    expect(html).toContain('Be the first');
    expect(html).toContain('THE INTERNATIONAL BUREAU OF VIBE MEASUREMENT');
  });

  it('serves the brand favicon at /favicon.svg and /favicon.ico', async () => {
    for (const path of ['/favicon.svg', '/favicon.ico']) {
      const res = await exports.default.fetch(`https://viberuler.dev${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
      expect(await res.text()).toContain('<svg');
    }
  });

  it('links the favicon from home and share pages', async () => {
    await seed('master5d', 1, 6065);
    const home = await (await exports.default.fetch('https://viberuler.dev/')).text();
    const share = await (await exports.default.fetch('https://viberuler.dev/u/master5d')).text();
    expect(home).toContain('href="/favicon.svg?v=2"');
    expect(share).toContain('href="/favicon.svg?v=2"');
  });

  it('serves /leaderboard as an alias', async () => {
    const res = await exports.default.fetch('https://viberuler.dev/leaderboard');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('THE INTERNATIONAL BUREAU OF VIBE MEASUREMENT');
  });

  it('carries the GitHub-notarization trust line', async () => {
    await seed('master5d', 1, 6065);
    const html = await (await exports.default.fetch('https://viberuler.dev/')).text();
    expect(html).toMatch(/GitHub-notarized/i);
  });
});
