import type { Collector, ScanContext } from '../types.js';

interface GithubCollector extends Collector {
  fetchImpl?: typeof fetch;
}

export const githubCollector: GithubCollector = {
  id: 'github',
  fetchImpl: undefined,

  async detect(ctx: ScanContext) {
    return Boolean(ctx.githubHandle);
  },

  async collect(ctx: ScanContext) {
    const doFetch = this.fetchImpl ?? fetch;
    try {
      let url: string | null =
        `https://api.github.com/users/${encodeURIComponent(ctx.githubHandle!)}/repos?per_page=100&type=owner`;
      let ghStars = 0;
      for (let page = 0; url && page < 5; page++) {
        const res: Response = await doFetch(url, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'viberuler' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return { sources: ['github'], warnings: [`github: API returned ${res.status}`] };
        const repos = (await res.json()) as Array<{ stargazers_count?: number }>;
        ghStars += repos.reduce((sum, r) => sum + (r.stargazers_count ?? 0), 0);
        const link = res.headers.get('link') ?? '';
        url = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
      }
      return { ghStars, sources: ['github'] };
    } catch {
      return { sources: ['github'], warnings: ['github: request failed or timed out'] };
    }
  },
};
