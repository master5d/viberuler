declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GITHUB_CLIENT_ID: string;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
