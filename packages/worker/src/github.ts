import type { GhUser } from './db.js';

export async function verifyGithubToken(token: string, fetchImpl: typeof fetch = fetch): Promise<GhUser | null> {
  try {
    const res = await fetchImpl('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'viberuler-api',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: number; login?: string; avatar_url?: string; created_at?: string };
    if (typeof body.id !== 'number' || typeof body.login !== 'string') return null;
    return {
      gh_id: body.id,
      gh_login: body.login,
      avatar_url: body.avatar_url ?? null,
      gh_created_at: body.created_at ?? null,
    };
  } catch {
    return null;
  }
}
