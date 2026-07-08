# VibeRuler in your statusline

Flex your VIBE score in every terminal, every agent, all day.

## The pattern: cache, don't scan

A statusline redraws constantly; a full scan takes seconds. So: refresh a cache in the background, read it instantly from the statusline. Every snippet below reads `~/.viberuler/score.json`.

**Refresh the cache** (cron / Task Scheduler / shell profile — every few hours is plenty):

```bash
# macOS / Linux
mkdir -p ~/.viberuler && npx viberuler --json --scan-dir ~/code > ~/.viberuler/score.json
```

```powershell
# Windows
New-Item -ItemType Directory -Force "$HOME\.viberuler" | Out-Null
npx viberuler --json --scan-dir C:\code > "$HOME\.viberuler\score.json"
```

The JSON fields you'll want: `.vibe` (number), `.rank` (string), `.tokPerUsd` (number|null), `.stats.commits`, `.stats.streakDays`.

---

## Claude Code

`~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "bash ~/.claude/viberuler-statusline.sh" }
}
```

Windows:

```json
{
  "statusLine": { "type": "command", "command": "pwsh -NoProfile -File \"%USERPROFILE%\\.claude\\viberuler-statusline.ps1\"" }
}
```

Copy [`viberuler-statusline.sh`](viberuler-statusline.sh) / [`viberuler-statusline.ps1`](viberuler-statusline.ps1) from this directory into `~/.claude/`. They print `model · ⚡vibe RANK · tok/$` and degrade gracefully when the cache is missing. Claude Code pipes session JSON on stdin — the scripts use it for the model name and ignore the rest.

## Starship (any shell, any OS)

`~/.config/starship.toml`:

```toml
[custom.viberuler]
command = '''jq -r '"⚡\(.vibe) \(.rank)"' ~/.viberuler/score.json'''
when = '''test -f ~/.viberuler/score.json'''
format = '[$output]($style) '
style = 'bold purple'
```

## oh-my-posh (Windows-friendly)

Add a segment to your theme JSON:

```json
{
  "type": "command",
  "style": "plain",
  "foreground": "#b388ff",
  "properties": {
    "shell": "pwsh",
    "command": "if (Test-Path $HOME/.viberuler/score.json) { $s = Get-Content $HOME/.viberuler/score.json -Raw | ConvertFrom-Json; \"⚡$($s.vibe) $($s.rank)\" }"
  }
}
```

## tmux

`~/.tmux.conf`:

```tmux
set -g status-interval 60
set -g status-right "#(jq -r '\"⚡\\(.vibe) \\(.rank)\"' ~/.viberuler/score.json 2>/dev/null) | %H:%M"
```

## Raw bash / zsh prompt

```bash
viberuler_ps1() {
  [ -f ~/.viberuler/score.json ] && jq -r '"⚡\(.vibe) \(.rank)"' ~/.viberuler/score.json 2>/dev/null
}
# bash
PS1='$(viberuler_ps1) \w \$ '
# zsh (add to precmd or use single quotes so it re-evaluates)
setopt PROMPT_SUBST
PROMPT='$(viberuler_ps1) %~ %# '
```

## Any other coding agent

The contract is trivial: if your agent/TUI can run a command and display its stdout (Antigravity CLI status hooks, custom TUIs, IDE task bars), point it at:

```bash
jq -r '"⚡\(.vibe) \(.rank) · \((.tokPerUsd // 0) / 1e6 * 10 | round / 10)M tok/$"' ~/.viberuler/score.json
```

…or the PowerShell equivalent from the oh-my-posh segment. No stdin required; everything comes from the cache file. PRs with configs for your favorite agent are welcome — same energy as the collector `good first issue`s.
