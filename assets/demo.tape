Output assets/demo.gif

# VibeRuler demo — the "Bureau of Vibe Measurement" left-rail scorecard.
# Render with: vhs assets/demo.tape   (charmbracelet/vhs)
#
# Recording notes (see LAUNCH.md field notes):
# - PUBLISH 0.3.3 FIRST — the tape runs the published `npx viberuler`, so the
#   new card (left rail, streak+agents, Bureau sign-off, Stories pointer) only
#   shows once 0.3.3 is on npm. To dry-run against local build, swap the two
#   command lines for `node packages/cli/dist/bin.js ...`.
# - warm the npx cache first (`npx -y viberuler --version`) or the hidden
#   "Ok to proceed?" prompt eats the Sleep.
# - run as a non-root user (chromium refuses --no-sandbox as root).
# - the Hide/Sleep/Show sandwich skips the scan wait in the rendered gif;
#   size each hidden Sleep to your measured scan time + margin.

Set FontSize 16
Set Width 1080
Set Height 900
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
Sleep 28s
Show
Sleep 5s

# 2) The flex: submit to the leaderboard, get the certificate + share links.
Type "npx viberuler --submit"
Sleep 500ms
Enter
Sleep 1500ms
Hide
Sleep 30s
Show
Sleep 3s
Type "y"
Enter
Sleep 9s
