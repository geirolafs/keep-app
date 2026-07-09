# KEEP Clipper

Browser extension for saving into KEEP. No server, no pairing: everything is
saved by downloading into `~/Downloads/KEEP/` — the app watches that folder
and ingests within ~2–4 s (files also queue there while the app is closed and
are picked up on next launch).

## Install (Chrome / Dia)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this `extension/` folder
4. Pin the KEEP Clipper icon

First save triggers macOS's one-time "KEEP wants to access your Downloads
folder" prompt — allow it.

## Usage

| Action | How |
|---|---|
| Save image / video | Right-click it → **Save image/video to KEEP** |
| Save link | Right-click a link → **Save link to KEEP** |
| Save current page | Click toolbar icon, or **⌘⇧S**, or right-click page → **Save page to KEEP** |
| Screenshot: visible area | Right-click toolbar icon → **Screenshot: visible area** |
| Screenshot: region | Right-click toolbar icon → **Screenshot: select region**, drag, Esc cancels |

Badge flashes **✓** on save, **!** on failure (check the service worker
console via `chrome://extensions` → Inspect views).

If ⌘⇧S collides with a browser/Dia binding, remap it at
`chrome://extensions/shortcuts`.

## How it works

- Media saves download the file plus a `<name>.keep.json` sidecar carrying
  `{type, source_url, title}`.
- Link/page saves are a standalone `<uuid>.keep.json` with `{type:"link", url}`;
  the app scrapes og: metadata itself.
- Downloads go through the browser's own network stack (cookies/referer
  included), so images behind auth or referer-locked CDNs work.

Known v1 limits: Chrome's download bubble flashes per save; full-page
scrolling screenshots not implemented; `blob:` video URLs (X/Instagram
players) can't be downloaded.
