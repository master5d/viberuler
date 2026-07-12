Output assets/demo.gif

# VibeRuler demo — the "Bureau of Vibe Measurement" left-rail scorecard.
# Render with: vhs assets/demo.tape   (charmbracelet/vhs)  — macOS / Linux only.
#
# ON WINDOWS THIS TAPE DOES NOT RENDER. vhs drives ttyd plus a headless browser
# and hangs there regardless of `Set Shell`. Use assets/gen-cast.mjs + agg
# instead — it needs neither, and produces the same two gifs. (Rendering from
# WSL is not a workaround: the scan takes 615s over the 9p mount vs 12s native.)
#
# Recording notes (see LAUNCH.md field notes):
# - PUBLISH FIRST — the tape runs the published `npx viberuler`, so a new card
#   only shows once that version is on npm. To dry-run against a local build,
#   swap the command lines for `node packages/cli/dist/bin.js ...`.
# - warm the npx cache first (`npx -y viberuler --version`) or the hidden
#   "Ok to proceed?" prompt eats the Sleep.
# - run as a non-root user (chromium refuses --no-sandbox as root).
# - the Hide/Sleep/Show sandwich skips the scan wait in the rendered gif;
#   size each hidden Sleep to your MEASURED scan time + margin. On the author's
#   rig (10.8k transcripts): scorecard 26s, audit 12s.
# - scene 2 is deliberately NOT `--submit`: that runs GitHub device-flow OAuth,
#   which has no browser to open inside vhs and would record a hang. `audit` is
#   also the more defensible thing to show — it needs no network at all.

Set FontSize 16
Set Width 1080
Set Height 1150
Set Padding 22
Set TypingSpeed 55ms
Set Shell bash
Set Theme { "name": "Bureau", "background": "#0b0e14", "foreground": "#c9c2ad", "cursor": "#b388ff", "selection": "#2a2f3a", "black": "#11151f", "brightBlack": "#8a8f9c", "red": "#ff5252", "brightRed": "#ff8a80", "green": "#69f0ae", "brightGreen": "#b9f6ca", "yellow": "#ffd54f", "brightYellow": "#ffe082", "blue": "#b388ff", "brightBlue": "#c9a9ff", "magenta": "#b388ff", "brightMagenta": "#c9a9ff", "cyan": "#4dd0e1", "brightCyan": "#84ffff", "white": "#c9c2ad", "brightWhite": "#f5f2e9" }

# 1) The hero: scan locally, print the scorecard.
Type "npx viberuler"
Sleep 500ms
Enter
Sleep 1500ms
Hide
Sleep 40s
Show
Sleep 6s

Type "clear"
Enter
Sleep 300ms

# 2) The point: audit the rig itself. No network, no submit — just the receipts.
Type "npx viberuler audit"
Sleep 500ms
Enter
Sleep 1500ms
Hide
Sleep 25s
Show
Sleep 8s
