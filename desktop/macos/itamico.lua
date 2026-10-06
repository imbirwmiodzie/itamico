-- Italian words widget for macOS, for Hammerspoon (https://www.hammerspoon.org).
--
-- Pins the /widget/<token> page in a small borderless panel at a fixed spot on
-- screen: in a corner, or at an exact position. It stays there on every Space
-- and over full-screen apps, and the page itself cycles the words and
-- refreshes them from the server. See desktop/macos/README.md for setup.
--
--   local itamico = require("itamico")
--   itamico.start({ url = "https://tutor.example.com/widget/<MCP_TOKEN>" })

local M = {}

M.defaults = {
  url = nil,              -- https://<host>/widget/<MCP_TOKEN> (required)

  -- Where: a corner of the screen, `margin` points from its edges. The menu
  -- bar and the Dock are left clear. Set `x` and `y` instead to pin it at an
  -- exact spot, in points from the top-left of the usable screen area.
  corner = "bottom-right", -- "top-left", "top-right", "bottom-left", "bottom-right"
  margin = 20,
  x = nil,
  y = nil,
  width = 340,
  height = 170,
  screen = "primary",      -- "primary" (with the menu bar) or a screen name, e.g. "DELL U2720Q"

  -- "floating": above all windows, always visible.
  -- "desktop": on the desktop under your windows, like a classic widget.
  layer = "floating",
  alpha = 1.0,

  -- Page options.
  every = 60,              -- seconds per word
  reveal = nil,            -- seconds until the answer shows (default: a third of `every`)
  words = 12,              -- how many of the hardest words to cycle through
  side = "italian",        -- "english": show English first and recall the Italian
  theme = nil,             -- "light" or "dark"; default follows macOS

  -- Hotkeys; set one to false to turn it off.
  toggleKey = { { "ctrl", "alt", "cmd" }, "I" }, -- show / hide
  cornerKey = { { "ctrl", "alt", "cmd" }, "O" }, -- move to the next corner
}

local CORNERS = { "top-left", "top-right", "bottom-right", "bottom-left" }
local cfg, view, retryTimer
local watchers, hotkeys = {}, {}

local function pageUrl()
  local q = { "every=" .. cfg.every, "n=" .. cfg.words, "side=" .. cfg.side }
  if cfg.reveal then q[#q + 1] = "reveal=" .. cfg.reveal end
  if cfg.theme then q[#q + 1] = "theme=" .. cfg.theme end
  return cfg.url .. "?" .. table.concat(q, "&")
end

local function targetScreen()
  if cfg.screen ~= "primary" then
    local s = hs.screen.find(cfg.screen)
    if s then return s end
  end
  return hs.screen.primaryScreen()
end

-- The panel's frame: an exact x/y if given, else the configured corner.
local function frame()
  local s = targetScreen():frame() -- excludes the menu bar and the Dock
  local x, y
  if cfg.x and cfg.y then
    x, y = s.x + cfg.x, s.y + cfg.y
  else
    local left = cfg.corner:find("left") ~= nil
    local top = cfg.corner:find("top") ~= nil
    x = left and s.x + cfg.margin or s.x + s.w - cfg.width - cfg.margin
    y = top and s.y + cfg.margin or s.y + s.h - cfg.height - cfg.margin
  end
  return hs.geometry.rect(x, y, cfg.width, cfg.height)
end

local function place()
  if view then view:frame(frame()) end
end

local function load()
  if retryTimer then retryTimer:stop() end
  view:url(pageUrl())
end

local function build()
  local levels = hs.drawing.windowLevels
  view = hs.webview.new(frame())
    :windowStyle({ "borderless", "nonactivating" }) -- clicks never steal focus from your app
    :level(cfg.layer == "desktop" and levels.desktopIcon or levels.floating)
    :behaviorAsLabels({ "canJoinAllSpaces", "stationary", "ignoresCycle", "fullScreenAuxiliary" })
    :transparent(true) -- the page draws its own rounded card
    :allowTextEntry(false)
    :allowNavigationGestures(false)
    :alpha(cfg.alpha)
    :navigationCallback(function(action)
      -- Offline at login or the server restarting: try again in a minute.
      if action == "didFailNavigation" or action == "didFailProvisionalNavigation" then
        retryTimer = hs.timer.doAfter(60, load)
      end
    end)
  load()
  view:show()
end

function M.show() if view then view:show() end end
function M.hide() if view then view:hide() end end

function M.toggle()
  if not view then return end
  if view:isVisible() then view:hide() else view:show() end
end

function M.nextCorner()
  cfg.x, cfg.y = nil, nil
  local i = 1
  for k, c in ipairs(CORNERS) do
    if c == cfg.corner then i = k end
  end
  cfg.corner = CORNERS[i % #CORNERS + 1]
  hs.settings.set("itamico.corner", cfg.corner) -- remembered across reloads
  place()
end

function M.reload()
  if view then load() end
end

function M.stop()
  for _, w in ipairs(watchers) do w:stop() end
  for _, h in ipairs(hotkeys) do h:delete() end
  watchers, hotkeys = {}, {}
  if retryTimer then retryTimer:stop() end
  if view then view:delete() end
  view = nil
end

function M.start(opts)
  M.stop()
  cfg = {}
  for k, v in pairs(M.defaults) do cfg[k] = v end
  for k, v in pairs(opts or {}) do cfg[k] = v end
  assert(cfg.url and cfg.url:match("^https?://"), "itamico: set url to https://<host>/widget/<MCP_TOKEN>")
  cfg.url = cfg.url:gsub("/+$", "")
  -- A corner picked with the hotkey wins over the configured one, unless x/y are set.
  if not (cfg.x and cfg.y) then cfg.corner = hs.settings.get("itamico.corner") or cfg.corner end

  build()

  -- Re-place it when displays are plugged in or rearranged, and reload after
  -- sleep so the words are fresh and the rotation timer is running again.
  watchers[#watchers + 1] = hs.screen.watcher.new(place):start()
  watchers[#watchers + 1] = hs.caffeinate.watcher.new(function(event)
    local w = hs.caffeinate.watcher
    if event == w.systemDidWake or event == w.screensDidUnlock then load() end
  end):start()

  if cfg.toggleKey then hotkeys[#hotkeys + 1] = hs.hotkey.bind(cfg.toggleKey[1], cfg.toggleKey[2], M.toggle) end
  if cfg.cornerKey then hotkeys[#hotkeys + 1] = hs.hotkey.bind(cfg.cornerKey[1], cfg.cornerKey[2], M.nextCorner) end
  return M
end

return M
