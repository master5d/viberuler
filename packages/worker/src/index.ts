import { handleSubmit } from './routes/submit.js';
import { handleLeaderboard, handlePercentile } from './routes/leaderboard.js';

export interface Env {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
}

export type RouteHandler = (req: Request, env: Env, url: URL) => Promise<Response>;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        return json({ ok: true });
      }
      if (request.method === 'GET' && pathname === '/api/leaderboard') return handleLeaderboard(request, env, url);
      if (request.method === 'GET' && pathname === '/api/percentile') return handlePercentile(request, env, url);
      if (request.method === 'POST' && pathname === '/api/submit') {
        return handleSubmit(request, env, url);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.log(JSON.stringify({ level: 'error', msg: String(err), path: pathname }));
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
