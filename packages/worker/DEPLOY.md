# Deploying viberuler-api

> **Status: DEPLOYED 2026-07-08.** Prod = `viberuler.dev` (custom domain via `routes` in wrangler.jsonc), D1 `viberuler` (id already in wrangler.jsonc), `GITHUB_CLIENT_ID` = real OAuth App id. Redeploy: `npx wrangler deploy`; new migrations first: `npx wrangler d1 migrations apply viberuler --remote`.

## Redeploy ritual

- **Migrations (remote-first):** `npx wrangler d1 migrations apply viberuler --remote` BEFORE `npx wrangler deploy`. Migration `0002` adds `tok_per_loc` + `sus_reason` (additive, nullable — safe on the live table). Verify with `npx wrangler d1 execute viberuler --remote --command "PRAGMA table_info(scores)"`.
- **Sus queue (moderation):** `npx wrangler d1 execute viberuler --remote --command "SELECT u.gh_login, s.sus_reason, s.vibe_score, s.submitted_at FROM scores s JOIN users u ON u.id=s.user_id WHERE s.sus=1 ORDER BY s.id DESC LIMIT 50"` (or the `susRows` helper in db.ts).

The original launch-day sequence, kept for reference:

1. `npx wrangler d1 create viberuler` → paste `database_id` into wrangler.jsonc
2. `npx wrangler d1 migrations apply viberuler --remote`
3. Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps):
   - Device flow: ENABLED; callback URL not needed for device flow
   - Put the Client ID into wrangler.jsonc `vars.GITHUB_CLIENT_ID` and ship the same
     value as `DEFAULT_CLIENT_ID` in packages/cli/src/submit.ts (it is public)
4. `npx wrangler deploy`
5. Custom domain: Workers → viberuler-api → Domains → add viberuler.dev
6. Smoke: `curl https://viberuler.dev/api/health` → `{"ok":true}`
7. Seed the board: `npx viberuler --submit` from the owner machine

No secrets exist in this worker. `GITHUB_CLIENT_ID` is public by design.
