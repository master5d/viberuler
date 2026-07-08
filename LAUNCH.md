# LAUNCH.md — day-zero runbook

> **Status (2026-07-08): LAUNCHED.**
> ✅ 0 preflight · ✅ 1 repo public · ✅ 2 D1+deploy · ✅ 3 viberuler.dev · ✅ 4 OAuth App (device flow verified in prod) · ✅ 5 `viberuler@0.1.0` on npm · ✅ 6 board seeded (`/u/master5d`, VIBE 6,065) · ⚪ 7 demo.gif (tape ready, needs vhs) · ✅ 8 six issues up · ⚪ 9 Show HN / X posts (drafts in `docs/launch/`) · 🔄 10 watch mode.
> Field notes: seed with `--scan-dir` pointing BELOW an umbrella git repo (nested repos aren't scanned — [#6](https://github.com/master5d/viberuler/issues/6)); npm publish with passkey-2FA needs a real TTY (browser flow); satori root div needs explicit px dims (fixed).

Every step below is a **user-gated, outward-facing action**. Run them in order; each has a verify. Nothing in this file is automated by CI.

## 0. Preflight

```bash
npm run typecheck && npm test && npm run build && npm run check -w viberuler-api
```
All green, working tree clean, on `master`.

## 1. GitHub repo

```bash
gh repo create master5d/viberuler --public --source . --push
gh repo edit master5d/viberuler --add-topic cli --add-topic developer-tools --add-topic ai --add-topic benchmark --add-topic vibe-coding
```
Verify: README renders, the SVG hero animates, CI goes green on the 3-OS matrix.

## 2. Cloudflare: D1 + deploy

```bash
cd packages/worker
npx wrangler d1 create viberuler          # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply viberuler --remote
npx wrangler deploy
```
Verify: `curl https://viberuler-api.<account>.workers.dev/api/health` → `{"ok":true}`.
(Note: `GITHUB_CLIENT_ID` is still the placeholder at this point — step 4 sets it and redeploys.)

## 3. Domain

Buy/own `viberuler.dev` → Cloudflare dashboard → Workers → viberuler-api → Domains → add `viberuler.dev`.
Verify: `curl https://viberuler.dev/api/health` → `{"ok":true}`.

## 4. GitHub OAuth App (device flow)

GitHub → Settings → Developer settings → OAuth Apps → New:
- Name `viberuler`, homepage `https://viberuler.dev`, **Enable Device Flow** (callback URL can be the homepage; unused by device flow).
- Copy the Client ID (it is public) into BOTH places — they must stay in sync:
  1. `packages/worker/wrangler.jsonc` → `vars.GITHUB_CLIENT_ID` → `npx wrangler deploy`
  2. `packages/cli/src/submit.ts` → `DEFAULT_CLIENT_ID`
- Commit, push.

## 5. npm publish

```bash
cd packages/cli
npm whoami                 # logged in?
npm publish                # prepublishOnly runs typecheck+test+build
```
Verify: `npx viberuler@latest --version` from a clean temp dir.

## 6. Seed the board

```bash
npx viberuler --submit --scan-dir C:\telo
```
Verify: `https://viberuler.dev/u/master5d` renders card + rank #1; `https://viberuler.dev/og/master5d.png` renders the OG image; paste the /u/ link into an X draft — the card preview shows.

## 7. Demo GIF

On a machine with [vhs](https://github.com/charmbracelet/vhs): `vhs assets/demo.tape` → commit `assets/demo.gif` → optionally swap into README below the SVG hero.

## 8. good first issues

Create one issue per collector (Cursor, Gemini CLI, Windsurf, Aider, Cline), each labeled `good first issue`, body: link to `packages/cli/src/types.ts` Collector interface + `collectors/codex.ts` as the reference implementation + fixture-testing pattern from `test/codex.test.ts`.

## 9. Post

1. X thread — `docs/launch/social.md` (attach the /u/ card link so the OG preview renders)
2. Show HN — `docs/launch/show-hn.md`, Tue–Thu, ~8:00 PT
3. Later same day: r/ClaudeAI, dev.to crosspost

## 10. Watch

- shields badge on README flips from `invalid` to live token count
- `npx wrangler d1 execute viberuler --remote --command "SELECT COUNT(*) FROM scores"` — submissions
- sus queue: `SELECT u.gh_login, s.vibe_score FROM scores s JOIN users u ON u.id=s.user_id WHERE s.sus=1`
- GitHub trending: stars velocity in first 24h decides project-of-the-day; reply to every issue fast
