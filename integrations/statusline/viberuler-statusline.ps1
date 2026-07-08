# VibeRuler statusline for Claude Code (Windows).
# Install: copy to ~\.claude\viberuler-statusline.ps1, then in ~\.claude\settings.json:
#   "statusLine": { "type": "command", "command": "pwsh -NoProfile -File \"%USERPROFILE%\\.claude\\viberuler-statusline.ps1\"" }
# Cache refresh (Task Scheduler or $PROFILE):
#   npx viberuler --json --scan-dir C:\code > "$HOME\.viberuler\score.json"

$model = 'Claude'
try {
  $session = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($session.model.display_name) { $model = $session.model.display_name }
} catch {}

$cache = Join-Path $HOME '.viberuler\score.json'
if (Test-Path $cache) {
  try {
    $s = Get-Content $cache -Raw | ConvertFrom-Json
    $tpd = ''
    if ($s.tokPerUsd) {
      $v = [double]$s.tokPerUsd
      $tpd = if ($v -ge 1e6) { ' · {0:0.#}M tok/$' -f ($v / 1e6) }
             elseif ($v -ge 1e3) { ' · {0:0.#}K tok/$' -f ($v / 1e3) }
             else { " · $([math]::Floor($v)) tok/`$" }
    }
    "$model · ⚡$($s.vibe) $($s.rank)$tpd"
  } catch { "$model · viberuler cache unreadable" }
} else {
  "$model · vibe unknown — npx viberuler --json > `$HOME\.viberuler\score.json"
}
