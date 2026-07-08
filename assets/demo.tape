Output assets/demo.gif
Set FontSize 18
Set Width 900
Set Height 560
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 60ms
Set Shell bash

# Recording tips (see LAUNCH.md field notes):
# - warm the npx cache first (`npx -y viberuler --version`) or the
#   "Ok to proceed?" prompt eats the hidden sleep
# - run as a non-root user (chromium refuses --no-sandbox as root)
# - the Hide/Sleep/Show sandwich skips the scan wait in the rendered gif;
#   size the hidden Sleep to your measured scan time + margin

Type "npx viberuler"
Sleep 500ms
Enter
Sleep 1500ms
Hide
Sleep 28s
Show
Sleep 4s
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
Sleep 8s
