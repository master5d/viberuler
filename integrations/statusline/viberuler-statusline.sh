#!/usr/bin/env bash
# VibeRuler statusline for Claude Code.
# Install: cp to ~/.claude/viberuler-statusline.sh, then in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash ~/.claude/viberuler-statusline.sh" }
# Cache refresh (cron or shell profile):
#   npx viberuler --json --scan-dir ~/code > ~/.viberuler/score.json
# Deps: jq

input=$(cat)
model=$(printf '%s' "$input" | jq -r '.model.display_name // "Claude"' 2>/dev/null || echo Claude)

cache="$HOME/.viberuler/score.json"
if [ -f "$cache" ]; then
  line=$(jq -r '
    def compact: if . >= 1e6 then "\(. / 1e5 | floor / 10)M" elif . >= 1e3 then "\(. / 1e2 | floor / 10)K" else "\(. | floor)" end;
    "⚡\(.vibe) \(.rank)" + (if .tokPerUsd then " · \(.tokPerUsd | compact) tok/$" else "" end)
  ' "$cache" 2>/dev/null)
  printf '%s · %s' "$model" "${line:-viberuler cache unreadable}"
else
  printf '%s · vibe unknown — npx viberuler --json > ~/.viberuler/score.json' "$model"
fi
