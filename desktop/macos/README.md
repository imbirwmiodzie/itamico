# macOS widget

A small panel showing your hardest Italian words, one at a time, pinned to a fixed spot on screen. It stays visible on every Space and over full-screen apps.

- Each word stays up for a minute. The answer appears after 20 seconds, giving you time to recall it first.
- Under the answer: the note, the sentence where you first got stuck, and what you said the last time you got it wrong.
- Click the panel to show the answer straight away. Click again to move to the next word.
- The top line shows how many words are due today and your practice streak.
- The words come from the server every 10 minutes. If the Mac is offline, the panel keeps the last words it loaded and shows a red dot.

It runs on [Hammerspoon](https://www.hammerspoon.org), a free macOS automation app. The panel is a borderless web view of `https://<host>/widget/<MCP_TOKEN>`.

## Setup

1. Install Hammerspoon: `brew install --cask hammerspoon`, or download it from hammerspoon.org. Open it, grant Accessibility access when asked, and turn on **Launch Hammerspoon at login** in its preferences.
2. Copy `itamico.lua` into `~/.hammerspoon/`.
3. Add this to `~/.hammerspoon/init.lua`, with your server and token:

   ```lua
   itamico = require("itamico").start({
     url = "https://tutor.example.com/widget/<MCP_TOKEN>",
     corner = "bottom-right",
   })
   ```

4. Choose **Reload Config** from the Hammerspoon menu bar icon.

The panel appears right away, and again at every login.

## Placement and options

All options are optional except `url`.

| Option | Default | |
|---|---|---|
| `corner` | `"bottom-right"` | `top-left`, `top-right`, `bottom-left` or `bottom-right` |
| `margin` | `20` | Distance from the screen edges, in points. The menu bar and Dock are always left clear. |
| `x`, `y` | – | Pin it at an exact spot instead of a corner: points from the top-left of the usable screen area |
| `width`, `height` | `340`, `170` | Panel size |
| `screen` | `"primary"` | The screen with the menu bar, or a display name such as `"DELL U2720Q"` |
| `layer` | `"floating"` | `"floating"` keeps it above all windows. `"desktop"` puts it on the desktop, under your windows, like a classic widget. |
| `alpha` | `1.0` | Opacity, from 0 to 1 |
| `every` | `60` | Seconds per word |
| `reveal` | `every / 3` | Seconds before the answer appears |
| `words` | `12` | How many of the hardest words to cycle through |
| `side` | `"italian"` | `"english"` shows the English first, so you recall the Italian, the same direction as the drills |
| `theme` | follows macOS | `"light"` or `"dark"` |
| `toggleKey` | ⌃⌥⌘I | Show or hide the panel. Set to `false` to turn it off. |
| `cornerKey` | ⌃⌥⌘O | Move the panel to the next corner. The choice is remembered across reloads. Set to `false` to turn it off. |

The panel moves back into place when you connect, disconnect or rearrange displays. It reloads after the Mac wakes from sleep.

### Which words

The words are ordered by how often you've failed them, then by lowest SM-2 ease, then by due date. Words with an interval of three weeks or more count as learned and are left out, unless they're due.

## Other uses of the page

The page works in any browser. Open `https://<host>/widget/<MCP_TOKEN>?every=30&side=english` in a small window to try different settings. The same URL can go in any app that shows a web page on the desktop.

The URL contains your token, so treat it like the connector URL. The page is served with `no-store` and `no-referrer`, and a wrong token returns 404.
