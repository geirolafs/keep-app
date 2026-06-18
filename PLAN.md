# KEEP — Visual Inspiration Board

Local-first desktop app for saving, browsing, and organizing visual inspiration.
Built with React + Tauri to extend existing React skills into native desktop
without leaving the web stack.

## Goal

Build a visual bookmarking tool as a learning exercise:
- Learn Tauri (Rust backend, IPC, packaging)
- Learn Rust basics through real image/file operations
- Learn browser extension authorship (WebExtensions API)
- Ship a distributable desktop app

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Package manager | Bun | faster installs, single toolchain |
| Frontend | React + Vite + TypeScript | already know it |
| Styling | Tailwind CSS v4 + shadcn/ui + Base UI | design system + headless primitives |
| Desktop shell | Tauri v2 | lightweight, Rust backend |
| Database | SQLite via `tauri-plugin-sql` | local-first, embeddable |
| Image ops | `image` crate (Rust) | thumbnails, metadata |
| Color extraction | `color-thief` crate (Rust) | dominant palette |
| Browser ext | WebExtensions (Chrome/Firefox) | save from browser |

---

## Phases

### Phase 1 — Scaffold ✅
- [x] Init Tauri v2 + React + Vite + TypeScript project
- [x] Configure Tailwind + shadcn/ui + Base UI
- [x] Set up SQLite plugin, define schema (images, tags, collections)
- [x] Basic window chrome (sidebar + main grid area)
- [x] Clipboard paste (image or URL)

### Phase 2 — Core: Save & Display ✅
- [x] Drag-and-drop image files onto app window (Tauri onDragDropEvent)
- [x] File picker import (tauri-plugin-dialog, + Add button)
- [x] Copy image from URL (paste URL → save_image_from_url Rust command)
- [x] Rust: generate 400px JPEG thumbnail on save (image crate, FilterType::Triangle) — upgraded to 1600px Lanczos3 in Phase 7
- [x] Rust: extract dominant color + 5-color palette (color-thief crate)
- [x] Masonry/grid display with dominant-color card backgrounds + hover overlay
- [x] Click image → ImageDetail slide-in panel
- [x] Delete image (files + SQLite row)
- [x] Dev-only Reset button (nuke all images and start fresh)

### Phase 3 — Redesign & Organize ✅
- [x] **Layout**: sidebar replaced with horizontal top nav — flat tabs (All | Collections | Tags), search input, sort toggle, "+ Collection" button
- [x] **Lightbox**: fullscreen overlay, prev/next arrows, keyboard ← → Esc, stable `openId` → derived index so navigation survives filter/sort changes
- [x] **Lightbox bottom strip**: editable title, date, source URL, tag chips + add input, collection chips + add dropdown, color palette swatches, notes textarea, delete button
- [x] **Tags**: add/remove in lightbox with autocomplete, filter grid by tag (Tags tab), hover chips on masonry cards (up to 3, bottom overlay on hover)
- [x] **Collections**: create inline in TopNav, add/remove in lightbox (incl. create new from lightbox), collection cards view with cover image + count, filter to collection images
- [x] **Image title**: editable inline in lightbox, persisted to `title` column
- [x] **Search**: real-time filter across title + source URL
- [x] **Sort**: newest / oldest toggle button
- [x] **Shared state**: `useTags` + `useCollections` as React Context — mutations propagate instantly across Grid and Lightbox
- [x] **Branding**: renamed MOOD → KEEP; bundle ID `is.geir.keep`; KEEP text wordmark in nav (Same Univers font)

### Phase 4 — Polish & Gaps ✅
- [x] **Tag search**: search now matches tag names in addition to title + source URL
- [x] **Delete/rename collections**: right-click context menu + inline input (no `window.prompt()`)
- [x] **Delete/rename tags**: right-click context menu + inline input (no `window.prompt()`)
- [x] **Toast notifications**: success/error toasts on all save, delete, and error paths
- [x] **Multi-select**: cmd/shift+click; batch delete (ConfirmDialog), batch add to collection, batch tag via toolbar
- [x] **Keyboard shortcuts**: `cmd+f` search, `cmd+n` new collection (collections tab), `del` delete selected
- [x] **Image notes**: schema migration v2 (`notes TEXT`), textarea in lightbox
- [x] **Lazy loading**: IntersectionObserver-based — images load only when scrolled into view
- [x] **Broken thumbnail fallback**: error state in LazyImage + lightbox full-image fallback
- [x] **`window.prompt()` / `window.confirm()`**: both replaced — inline inputs + ConfirmDialog throughout
- [x] **Palette JSON parse**: `JSON.parse(image.palette)` in Lightbox wrapped in try/catch
- [x] **Title edit on close**: keyboard Escape handler flushes title before closing
- [x] **Reset**: clears all tables (images, tags, collections, junction tables) + page reload
- [x] **Dev snapshot**: Save E1 / E1 buttons — full DB + file snapshot/restore via Rust commands
- [x] **Empty states**: first-run onboarding — 3-card layout (drag/paste/browse); filter-empty state
- [x] **Incremental rendering**: sentinel-based — renders 50 nodes at a time, loads next batch on scroll (DOM-level, avoids masonry geometry issues of true virtual scroll)

### Phase 5 — AI & Visual Redesign ✅

- [x] **Gradient mesh backdrop**: Lightbox background is a CSS radial-gradient mesh from the image palette — 5 radial blobs at fixed corner/center positions, `color99` opacity, stacked over `#000`
- [x] **Lightbox redesign**: two-panel layout — image left (flex-1), scrollable metadata sidebar right (300px, `bg-background/80 backdrop-blur-xl`). Sidebar: editable title, description + ✨ Analyze, palette swatches (click-to-copy hex), tags, collections, notes, date/source, delete
- [x] **AI integration via OpenRouter**: Rust `analyze_image(thumb_path, api_key, model)` — base64-encodes thumbnail, POSTs to `https://openrouter.ai/api/v1/chat/completions` (OpenAI format), returns `{title, tags, description}`. 3–5 broad tags; clears old tags before applying new set
- [x] **Settings modal**: gear icon in TopNav — OpenRouter API key (password + show/hide), model input (default `anthropic/claude-sonnet-4-6`), auto-analyze mode (Off / unanalyzed only / all)
- [x] **✨ Analyze All**: toolbar button loops through all images sequentially, shows `n/total — Cancel` progress, cancellable mid-run
- [x] **Schema migration v3**: `ALTER TABLE images ADD COLUMN description TEXT` + `CREATE TABLE settings`
- [x] **AI-powered search**: search now matches `description` alongside title, source_url, tags
- [x] **Analyze progress**: skeleton shimmer on title + description, spinner on button during analysis

### Phase 6 — Format Support
Add support for additional file formats beyond the current `png | jpg | jpeg | gif | webp`.

#### Formats to add
| Format | Handling | Status |
|---|---|---|
| `avif` | `avif-native` feature (dav1d, pure Rust) | [x] |
| `tiff` / `tif` | `tiff` feature | [x] |
| `bmp` | `bmp` feature | [x] |
| `jxl` | `jxl-oxide` crate — decode to `DynamicImage`, JPEG thumbnail as normal | [x] |
| `svg` | Special path: copy as-is, thumb_path = file_path, skip decode/palette | [x] |
| `mp4` / `mov` / `webm` | Video — `qlmanage -t -s 800` for thumb (no ffmpeg dep); `<video>` in lightbox | [x] |
| `heic` / `heif` | `libheif-rs` crate (system `libheif` via `brew install libheif`) | [x] |
| `pdf` | Render first page as image — needs PDF library; low priority | deferred |
| `psd` / `ai` / `fig` / `afdesign` / `afphoto` / `afpub` / `glyphs` | Design files — `qlmanage -t -s 800` for thumbnail (same path as video); requires host app's Quick Look plugin to be installed; graceful fallback to file-type placeholder if QL fails | [ ] |

#### Implementation notes
- **Standard formats**: add feature flags to `Cargo.toml` + extend `IMAGE_EXTENSIONS` in `Grid.tsx` + update file picker filter
- **SVG special path**: detect `ext == "svg"` in `process_and_save`; copy bytes as-is; set `thumb_path = file_path`; skip `image::load_from_memory` + color extraction; return `width=0, height=0, dominant_color=None, palette=None`
- **Video path** (`process_video_from_path`): `std::fs::copy` src → `images/` (avoids reading large file into RAM); `/usr/bin/qlmanage -t -s 800` → PNG bytes; resize+save as JPEG thumb; palette from frame; `kind='video'`; playback via `<video>` + `convertFileSrc` in lightbox. Auto-analyze skipped; manual analyze works (thumb is JPEG).
- **`kind` column** (schema v4, `DEFAULT 'image'`): borrowed from GatherOS — cleaner than extension checks throughout UI; sets up `kind='post'`/`kind='link'` for Phase 8
- **Frame extraction**: uses macOS `qlmanage` (built-in Quick Look CLI, `/usr/bin/qlmanage`) — no external deps, handles all macOS-native video formats. Output: `<filename>.png` in a temp dir.
- **Video streaming**: Tauri `asset://` protocol + WKWebView handles Range requests natively for `<video>` seeking
- **Design file path** (`.psd`, `.ai`, `.fig`, `.afdesign`, `.afphoto`, `.afpub`, `.glyphs`): same `qlmanage` thumbnail path as video; `kind = 'image'`; no decode/palette (fall back to `dominant_color = None`); lightbox shows original file via asset protocol (browser can't render these — show a styled "open in app" placeholder with file type badge). Accept in drag-drop + file picker filter.
- **Skip**: pdf — complex deps, low demand

### Phase 7 — Polish & Features

#### Thumbnails
- [x] **Retina-crisp thumbnails**: 1600px max dimension, `FilterType::Lanczos3`, JPEG quality 85. `save_thumb()` Rust helper used by all three code paths (process_and_save, process_video_from_path, refresh_thumbnails).
- [x] **Refresh Thumbnails**: `refresh_thumbnails(items)` Rust command; JS loops per-image calling with single-item slice for `x of y` progress; skips SVG/GIF/video (thumb = file). Button in Settings → Developer section.

#### Grid
- [x] **Collection fan cards**: replaced single-cover-image+overlay card with a white card (border, no overlay); up to 4 latest thumbs shown as a fanned spread of rotated images (slots at -30°/-15°/+15°/+30°, overlapping with negative margin, drop shadow); fewer images fill from the rightmost slot; name top-left, count bottom-right. `getCollectionThumbs()` helper added to `useCollections`.
- [x] **File size in lightbox**: `get_file_size` Rust command (fs::metadata); fetched on image open; displayed as `· 1.4 MB` / `· 842 KB` appended to the `W × H · EXT` line.
- [x] **Masonry alignment fix**: replaced CSS `columns` (which has browser balancing alignment bugs) with explicit flex columns. `ResizeObserver` on container drives `numCols` state (2/3/4/5 at same breakpoints). Items distributed round-robin across columns (item 0 → col 0, item 1 → col 1, …) so the top row reads left→right newest-first. Each column is `flex flex-col gap-3 items-start`.
- [x] **Grid polish**: removed `rounded-lg` from cards; removed `outline` focus ring; `display: block` on img/video eliminates inline baseline descender gap.
- [x] **Column count slider**: 2–12 columns; persisted to `settings` table (`col_count`). Range input in Grid toolbar; `ResizeObserver` auto-breakpoints still fire when no manual preference is set (`manualColsRef` guard).
- [x] **Hover scale**: replaced gradient overlay + opacity fade with `scale(1.02)` inline style transform (`transition: transform 150ms ease`). Overlay div removed.
- [x] **Video slow-mo in grid**: `onLoadedData` → `playbackRate = 0.25` (always slow); `onMouseEnter` → `1`; `onMouseLeave` → `0.25`. Hover plays at normal speed, idle plays in slow-mo.
- [x] **Ghost cards for in-progress saves**: `PendingItem` type + `pendingItems` state in `ImagesContext`; `addPending(label)` called before each `invoke`, `removePending(id)` in `finally`; pending items prepended to masonry column distribution so ghost card appears inline at position 0 (same layout as real cards); shimmer + spinner + truncated URL label. Covers saveBlob, savePath, saveUrl, saveLink.
- [x] **Cursor fix**: removed `cursor-pointer` from masonry cards, collection squares, BinView cards, context menu items — default arrow cursor matches native macOS app behavior. `<a>` tags retain browser-default pointer.
- [x] **Sort by name**: `Sort` type extended to `"newest" | "oldest" | "name-az" | "name-za"`; toggle cycles through all 4 states; button shows icon + "Date"/"Name" label; Grid sorts by `title ?? file_path` via `localeCompare`.

#### Help & Shortcuts
- [x] **`?` help modal**: `?` keypress (App.tsx, guards inputs/textareas) + `?` button in TopNav opens AlertDialog with keyboard shortcuts table + tips. `openHelp()` on `TopNavHandle`.

#### Search
- [x] **⌘K search dialog**: `CommandDialog` (shadcn/ui `cmdk`) — centered overlay, results grouped by Images / Collections / Tags; keyboard nav handled by cmdk; Enter opens image in lightbox (`GridHandle.openImage`) or jumps to collection/tag via `setTabAndSelect`. No query → 8 recent images. Search input shows `⌘K` kbd badge (fades when typing).

#### Tags
- [x] **Sort tags by count**: Tags tab sorted count-desc, alpha tiebreak. Computed client-side from `imageTagsMap`.

#### Bin / Soft Delete
- [x] **Schema migration v5**: `ALTER TABLE images ADD COLUMN deleted_at INTEGER` (NULL = active)
- [x] Filter all queries with `WHERE deleted_at IS NULL`
- [x] **Bin tab** in TopNav — shows deleted items, sorted newest-first
- [x] **Per-item restore** (set `deleted_at = NULL`) and **permanent delete** (move file to macOS Trash via `tauri-plugin-trash`)
- [x] **Empty Bin** button — moves all bin files to Trash
- [x] **Auto-purge on launch**: permanently delete items with `deleted_at < now - 90 days`
- [x] Multi-select + bulk restore in Bin

#### Lightbox
- [x] **Image dimensions + format**: `{width} × {height} · {EXT}` in sidebar date/source section; hidden for SVGs (width=0).
- [x] **Reveal in Finder**: `revealItemInDir(file_path)` via `@tauri-apps/plugin-opener`; shown as "Reveal" link next to Source in lightbox sidebar.
- [x] **Export original**: "Export" (Tauri `dialog::save` picker, defaults to `~/Downloads/<filename>`, `export_original` Rust command) + "Copy" (decodes to RGBA → macOS clipboard via `arboard` crate, `copy_image_to_clipboard` Rust command; hidden for SVG/video). Both next to Reveal in lightbox date/source row.
- [x] **Analyze button**: replaced `✨ Analyze` emoji text with `RiSparkling2Line` icon + "Analyze" label, matching Settings modal style.

#### Dev Tools
- [x] **Settings modal consolidation**: Save E1, Load E1, Reset (2-step inline confirm), Randomize Order button, Refresh Thumbs button all moved to Settings → Developer section (DEV-only). Toolbar now only has Analyze All + Add.
- [x] **Randomize Order**: button increments `shuffleSeed`; Grid assigns random weights per-image on seed change, sorts by weight. Counter shows `(×N)`.

#### Notifications & Toasts
- [x] **macOS OS notifications**: `tauri-plugin-notification` added (Cargo.toml, lib.rs, capabilities); `@tauri-apps/plugin-notification` JS package; `sendNotification` (fire-and-forget, silent on permission denial) fires after: Analyze All complete, Vision scan done, Refresh Thumbnails done — operations where user may have walked away.
- [x] **Toast cleanup**: removed success/info toasts for all CRUD ops (save, delete, restore, bin empty, tag rename/delete, collection create/rename/delete) — UI change is the confirmation. Kept: all `type:"error"` toasts + brief copy confirmations ("Copied to clipboard", "Copied hex", "Prompt copied").

#### AI Analysis
- [x] **SVG analysis**: rasterize via `qlmanage` (reuses video frame extractor, no new dep) → PNG → `image/png` to vision API
- [x] **GIF analysis**: `image::load_from_memory` decodes frame 0 → encode to JPEG in memory → `image/jpeg` to vision API
- [x] **Move Analyze All to Settings**: "✨ Analyze All" removed from toolbar; button + inline progress (`n/total — Cancel`) in Settings modal AI section. `RiSparkling2Line` icon. `useImages` converted to React Context (`ImagesProvider`) so TopNav can access shared image state. Toolbar reverts to just column slider + `+ Add`.
- [x] **Generate prompt**: `generate_prompt(thumb_path, api_key, model)` Rust command — same base64 image prep as `analyze_image`, returns a Midjourney/DALL-E/Flux style prompt string. Default model `google/gemini-2.5-flash` (fast, cheap, excellent at creative/descriptive tasks). "Generation Prompt" section in lightbox sidebar: Generate button, skeleton shimmer while loading, prompt text with hover copy button (`RiFileCopyLine`). Hidden for videos.

#### Local AI — No API Key Required

Two-tier approach: instant auto-tagging on every save (zero setup) + optional full vision LLM via one-time download. Removes the API key requirement for the core analyze workflow.

##### Tier 1 — macOS Vision Framework (silent, always-on, zero setup)

- [x] Write `keep-vision` Swift helper binary (`src-tauri/keep-vision.swift`, compiled to `binaries/keep-vision-aarch64-apple-darwin`)
  - `VNClassifyImageRequest` → top-N confidence labels (>0.5, skip "no *") → auto-insert as tags on save
  - `VNRecognizeTextRequest` → OCR text extracted from image (capped 2000 chars)
  - Output: `{"tags": [...], "ocr_text": "..."}` — framework warns go to stdout on macOS 26+; parse via `rfind('{')` to skip them
- [x] Add `keep-vision` as Tauri `externalBin` in `tauri.conf.json`; binary resolved via `current_exe().parent()`
- [x] Rust: `run_vision()` helper called from `process_and_save()` → `vision_tags` + `ocr_text` returned in `SavedImage`; JS inserts tags + stores OCR on save
- [x] Schema migration v6: `ALTER TABLE images ADD COLUMN ocr_text TEXT`; included in search filter
- [x] **Scan with Vision** button in Settings AI section — `backfillVision()` loops unindexed images (`ocr_text IS NULL`), calls `analyze_vision_item` Rust command, inserts tags + sets `ocr_text`; progress + cancel; reloads on complete

##### Tier 2 — Moondream2 (full local vision LLM, ~1.3 GB one-time download)

Replaces `analyze_image` (title + tags + description) with a fully local pipeline. No network call, no API key.

- [ ] Settings → AI section: **"Download KEEP AI (1.3 GB)"** button
  - Downloads `moondream2-text-model.gguf` (~1.1 GB, Q4_K_M) + `moondream2-mmproj.gguf` (~200 MB) to `{app_data}/models/`
  - Inline download progress bar; resumable on restart
  - Button shows "KEEP AI Ready ✓" when model files are present
- [ ] Bundle precompiled `llava-cli` binary (llama.cpp multimodal, arm64-apple-darwin) as Tauri `externalBin`
  - Metal backend: Apple Silicon GPU acceleration, ~2–4s per image on M1+
- [ ] Rust: `analyze_local(thumb_path)` — shell out to `llava-cli --model moondream2.gguf --mmproj moondream2-mmproj.gguf --image {thumb} --prompt "..."` → parse JSON output
- [ ] Routing logic in `analyze_image` Rust command:
  1. Model files present → `analyze_local()` (no network)
  2. Model absent + `api_key` present → OpenRouter (current behavior)
  3. Neither → return descriptive error: "Download KEEP AI in Settings, or add an API key"
- [ ] `generate_prompt` does **not** use local model — local vision LLMs are noticeably weaker at creative prompt generation than large cloud models. Keep OpenRouter/Gemini for this feature only.
- [ ] Relabel OpenRouter field in Settings: **"Advanced: use cloud model"** (not primary path)

#### Social URL Cards (paste URL → rich card)
- [x] Detect pasted URL as a tweet (`x.com/*/status/*`) or generic social/web URL
- [x] **Twitter/X**: fetch oEmbed (`https://publish.twitter.com/oembed?url=…`) — author name + caption; `scraper` crate parses `og:` tags from SSR HTML
- [x] **Video tweets**: `yt-dlp --no-warnings -f mp4 --get-url` extracts direct MP4 URL (Twitter SSR HTML hides video behind JS); `qlmanage` generates thumbnail from frame 0
- [x] **Image tweets**: `og:image` used; profile pictures (`/profile_images/`) filtered out
- [x] **All other URLs**: fetch `og:` meta tags (title, description, `og:image`, `og:video`) via `scraper`; relative URLs resolved against page origin
- [x] Store as `kind = 'link'`, `post_meta` JSON (`platform`, `url`, `title`, `description`, `siteName`, `imageUrl`, `authorName`); schema migration v7
- [x] Render `<PostCard>` in lightbox sidebar when `kind === 'link'`; old Twitter bird icon (`RiTwitterLine`) as platform badge
- [x] Grid: platform badge overlay on link cards (bird icon for Twitter, domain text for others); falls back to `source_url` if `post_meta` missing
- [x] Dev snapshot (`devSaveExample` / `devLoadExample`): includes `post_meta`; excludes soft-deleted items

#### AI Semantic Search
- [ ] Add `sqlite-vec` extension for local vector embeddings (no API calls at query time)
- [ ] Generate embedding on image save/analyze — store in `embeddings` table
- [ ] Hybrid search: keyword match (existing) + cosine similarity on embeddings
- [ ] Retroactive backfill command for existing library

---

### Phase 8 — Browser Extension + Social Posts

#### Native Messaging Host
- [ ] Tauri native messaging host — registers with Chrome/Firefox, receives structured messages from extension
- [ ] Toast/badge notification on successful save

#### Chrome Extension (manifest v3)
- [ ] Extension scaffold — popup, background service worker, content scripts
- [ ] Right-click → "Save to KEEP" on any image (sends URL/bytes via native messaging)
- [ ] **X bookmark watcher**: content script on `x.com` — detects bookmarks as they scroll into view, extracts `tweet_meta`, sends to KEEP automatically
- [ ] **Save post action**: right-click or hover button on post — extracts post data from DOM for X, Instagram, Facebook (best-effort), LinkedIn (best-effort)
- [ ] Firefox support (manifest v2 compat layer)

#### Posts Schema (migration v7)
```sql
-- kind already added in v4; post/link are new values
ALTER TABLE images ADD COLUMN post_meta TEXT;
-- JSON: { platform, authorName, authorHandle, authorAvatarUrl,
--         caption, imageUrls[], videoUrl, quoted{} }
```
- `file_path`/`thumb_path` = downloaded first image (grid works unchanged)
- Multi-image posts: `post_meta.imageUrls[]` drives lightbox carousel; stays on same DB record

#### PostCard Component
- [ ] `<PostCard>` in lightbox sidebar — renders when `kind === 'post'` or `kind === 'link'`
- [ ] Platform badge (X, Instagram, Facebook, LinkedIn, generic link) top-right
- [ ] Author avatar + name + handle, caption text, image strip (thumbnail grid)
- [ ] Quoted tweet support (nested card)
- [ ] Same component used for all platforms and for pasted URL cards

#### Bookmarks Tab
- [ ] New **Bookmarks** tab in TopNav — filters `WHERE kind IN ('post', 'link')`
- [ ] Grid renders post cards with platform badge; text-only posts show styled text card (avatar + name + caption)
- [ ] Multi-image counter badge (`1/4`) on grid cards with multiple images

#### Distribution
- [x] Bundle `libheif.dylib` alongside `.app` — `scripts/bundle-dylibs.sh` (dylibbundler); `bun run release` builds + bundles all non-system dylibs into `Contents/Frameworks/`

---

### Phase 9 — Canvas (Spaces)

Infinite canvas for arranging saved images into mood boards. GatherOS calls this "Spaces" and implements it as a **custom SVG canvas in React** — no heavy library needed.

#### Schema (migration v8)
```sql
CREATE TABLE boards (
  id          TEXT PRIMARY KEY,  -- UUIDv7
  name        TEXT NOT NULL,
  thumb_path  TEXT,              -- composite mosaic preview
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  order_index INTEGER DEFAULT 0
);

CREATE TABLE board_items (
  id        TEXT PRIMARY KEY,    -- UUIDv7
  board_id  TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,       -- 'image' | 'shape' | 'text'
  x         REAL NOT NULL,
  y         REAL NOT NULL,
  width     REAL,
  height    REAL,
  rotation  REAL DEFAULT 0,
  z_index   INTEGER DEFAULT 0,
  data      TEXT,                -- JSON: { saveId } for images, { fill, shapeType } for shapes
  created_at INTEGER NOT NULL
);
```

#### Features
- [ ] **Canvas tab** in TopNav — lists boards, "+ New Board" button
- [ ] **Infinite canvas**: SVG-based, React-rendered; pan via drag, zoom via scroll/pinch
- [ ] **Drag from library** onto canvas — creates a `board_item` referencing the image save
- [ ] **Item manipulation**: move, resize, rotate, z-order (bring forward/send back), delete
- [ ] **Board thumbnail**: composite mosaic generated from item thumbnails (Rust, on save)
- [ ] Multi-select on canvas (box select + cmd+click)
- [ ] Export canvas as PNG (Rust composite render)
- [ ] Shapes: rectangle, ellipse with fill color (Phase 9b)

---

## Schema (SQLite)

```sql
CREATE TABLE images (
  id          TEXT PRIMARY KEY,  -- UUIDv7 (time-sortable, cloud-sync safe)
  file_path   TEXT NOT NULL,     -- absolute path in app data dir
  thumb_path  TEXT NOT NULL,
  source_url  TEXT,
  title       TEXT,
  dominant_color TEXT,           -- hex
  palette     TEXT,              -- JSON array of hex
  width       INTEGER,
  height      INTEGER,
  created_at  INTEGER NOT NULL,  -- unix ms
  updated_at  INTEGER NOT NULL,  -- unix ms — for conflict resolution on sync
  synced_at   INTEGER,           -- NULL = not yet synced
  -- v2
  notes       TEXT,
  -- v3
  description TEXT,
  -- v4 (Phase 6)
  kind        TEXT DEFAULT 'image', -- 'image' | 'video' | 'post' | 'link'
  -- v5 (Phase 7)
  deleted_at  INTEGER,           -- NULL = active; set to move to Bin
  -- v6 (Phase 7)
  ocr_text    TEXT,              -- NULL = never Vision-scanned; "" = scanned, no text found
  -- v7 (Phase 8)
  post_meta   TEXT               -- JSON: platform, author, caption, imageUrls[], quoted{}
);

CREATE TABLE tags (
  id   TEXT PRIMARY KEY,         -- UUIDv7
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE image_tags (
  image_id TEXT REFERENCES images(id) ON DELETE CASCADE,
  tag_id   TEXT REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (image_id, tag_id)
);

CREATE TABLE collections (
  id   TEXT PRIMARY KEY,         -- UUIDv7
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE collection_images (
  collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
  image_id      TEXT REFERENCES images(id)      ON DELETE CASCADE,
  PRIMARY KEY (collection_id, image_id)
);
```

---

## Rust Commands (Tauri IPC)

```
-- Implemented
save_image_bytes(bytes, filename, source_url?)  -> ImageRecord
save_image_from_path(path, source_url?)         -> ImageRecord
save_image_from_url(url)                        -> ImageRecord
delete_image_files(file_path, thumb_path)
reset_all_images()
analyze_image(thumb_path, api_key, model)       -> {title, tags, description}
refresh_thumbnails(items)                       -> Vec<RefreshResult>
save_example_snapshot(slot)
load_example_snapshot(slot)                     -> Vec<ImageRecord>
reveal_item_in_dir(path)                        -- via tauri-plugin-opener
export_original(file_path, dest_path)           -- copy bytes to user-chosen path
copy_image_to_clipboard(file_path)              -- decode → RGBA → macOS clipboard via arboard
generate_prompt(thumb_path, api_key, model)     -> String  -- Midjourney/DALL-E/Flux style prompt via google/gemini-2.5-flash
save_link(url)                                  -> SavedLink  -- og: scrape + yt-dlp for tweets; kind='link'
get_file_size(file_path)                        -> u64        -- fs::metadata().len(); used in lightbox
```

---

## Decisions

**shadcn/ui + Base UI over Radix** — Radix is no longer actively maintained. Base UI
(from the MUI team) is the headless primitives layer; shadcn/ui sits on top for the
pre-built component CLI workflow.

**Bun over npm/pnpm** — faster installs, single toolchain (runtime + package manager). Use `bunx` in place of `npx` throughout.

**Desktop-first, Tauri over Capacitor** — Tauri v2 has mobile support but it's immature for
this use case (file access, share sheet, Photos library are awkward via WKWebView). If mobile
becomes a real target, migrate the native layer to Capacitor — React components port 1:1,
only the native bridge changes. Don't optimize for mobile now.

---

## Reference Apps

- **GatherOS** — local-first, Electron/SQLite, Chrome WebExtensions, color extraction
- **mymind** — cloud-synced, native Swift, Safari App Extension, Lottie animations,
  SDWebImage for async loading with dominant-color placeholders (worth stealing)

---

## Unresolved Questions

1. ~~App name / brand?~~ **KEEP** — bundle ID: `is.geir.keep`
2. ~~macOS-only or also Windows?~~ **macOS only**
3. ~~Cloud sync later, or stay local-forever?~~ **Local-first, sync optional later** — `synced_at` already in schema
4. ~~Paste image from clipboard — Phase 2 or Phase 1?~~ **Phase 1**
