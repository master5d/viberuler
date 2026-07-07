import { describe, it, expect, afterEach } from 'vitest';
import { githubCollector } from '../src/collectors/github.js';

afterEach(() => {
  githubCollector.fetchImpl = undefined;
});

describe('githubCollector', () => {
  it('does not detect without a handle (privacy default)', async () => {
    expect(await githubCollector.detect({ home: '/x', scanDirs: [] })).toBe(false);
  });

  it('detects with a handle and sums stars from the repos API', async () => {
    githubCollector.fetchImpl = (async (url: any) => {
      expect(String(url)).toContain('/users/master5d/repos');
      return new Response(
        JSON.stringify([{ stargazers_count: 10 }, { stargazers_count: 32 }]),
        { status: 200 },
      );
    }) as typeof fetch;

    const ctx = { home: '/x', scanDirs: [], githubHandle: 'master5d' };
    expect(await githubCollector.detect(ctx)).toBe(true);
    const r = await githubCollector.collect(ctx);
    expect(r.ghStars).toBe(42);
    expect(r.sources).toEqual(['github']);
  });

  it('degrades to a warning on HTTP failure', async () => {
    githubCollector.fetchImpl = (async () => new Response('nope', { status: 403 })) as typeof fetch;
    const r = await githubCollector.collect({ home: '/x', scanDirs: [], githubHandle: 'master5d' });
    expect(r.ghStars).toBeUndefined();
    expect(r.warnings?.[0]).toContain('github');
  });
});
