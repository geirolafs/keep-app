# Project Context

Local-first desktop app for saving, browsing, and organizing visual inspiration.
Built as a learning project to extend existing React skills into native desktop.

Full plan, schema, IPC commands, and decisions log: **PLAN.md**

---

## Current Phase

**Phase 7 — Polish & Features (in progress)**

Phase 7 shipped so far:
- [x] **Retina thumbnails** — 1600px max, Lanczos3 filter, JPEG quality 85; `save_thumb()` helper in Rust
- [x] **Refresh Thumbnails** — `refresh_thumbnails` Rust command; JS loops per-image with `x of y` progress; in Dev section of Settings
- [x] **Image dimensions + format** — lightbox sidebar shows `{width} × {height} · {EXT}`
- [x] **Sort tags by count** — Tags tab sorted count-desc, alpha tiebreak
- [x] **Masonry grid refactor** — replaced CSS `columns` with explicit flex columns; `ResizeObserver` drives column count (2/3/4/5); eliminates CSS balancing alignment bugs
- [x] **Reveal in Finder** — `revealItemInDir` button in lightbox date/source row
- [x] **Dev tools → Settings modal** — Save E1, Load E1, Reset (2-step confirm), Randomize Order, Refresh Thumbs all in Settings Developer section; toolbar cleaned up
- [x] **Grid polish** — removed rounded corners; removed focus outline on cards; `block` on img/video eliminates inline baseline gap
- [x] **Hover scale** — `scale(1.02)` on card hover (`transition: transform 150ms ease`); gradient overlay removed
- [x] **Video slow-mo in grid** — `playbackRate = 0.25` on hover, reset to `1` on leave
- [x] **Column count slider** — range input 2–12 in Grid toolbar; persisted to `settings` (`col_count`); `ResizeObserver` auto-fires when no manual pref
- [x] **Analyze All → Settings** — button + inline progress in Settings modal AI section; `RiSparkling2Line` icon; `useImages` converted to React Context (`ImagesProvider`) so TopNav shares image state
- [x] **Help modal** — `?` button in TopNav + `?` keypress (guards inputs); AlertDialog with shortcuts table + tips; `openHelp()` on `TopNavHandle`
- [x] **⌘K search dialog** — `CommandDialog` (cmdk); grouped Images/Collections/Tags; Enter opens image or jumps to collection/tag; no query → 8 recent images
- [x] **Export original** — "Export" (Tauri `dialog::save`, `export_original` Rust cmd) + "Copy" (`copy_image_to_clipboard` via `arboard`; hidden for SVG/video)
- [x] **Generate prompt** — `generate_prompt` Rust cmd → Midjourney/DALL-E style prompt via `google/gemini-2.5-flash`; lightbox sidebar section with copy button

Phase 7 remaining — see PLAN.md:
- [x] Bin / soft delete — schema migration v5 (`deleted_at`), Bin tab, auto-purge 90d, macOS Trash
- [x] Local AI — macOS Vision Framework (silent auto-tagging + OCR) + Qwen2.5-VL-3B local LLM (~3.3 GB one-time download)
- [x] Social URL cards — paste tweet/URL → og: scrape → `<PostCard>` in lightbox
- [ ] AI semantic search — `sqlite-vec` embeddings, hybrid keyword + cosine

Phase 8 — Browser Extension + Social Posts (see PLAN.md)
Phase 9 — Canvas/Spaces — custom SVG infinite canvas, `boards` + `board_items` tables, drag from library onto canvas. GatherOS reference: SVG-rendered, no Fabric.js/Konva, simple x/y/rotation/z_index schema.

---

## Stack

| Layer | Choice |
|---|---|
| Package manager | Bun |
| Frontend | React + Vite + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui + Base UI (`@base-ui/react ^1.5.0`) |
| Desktop shell | Tauri v2 |
| Database | SQLite via `tauri-plugin-sql` |
| Image ops | `image` crate (Rust) |
| Color extraction | `color-thief` crate (Rust) |
| Browser ext | WebExtensions (Chrome/Firefox) — Phase 8 |
| HEIC/HEIF | `libheif-rs` + system `libheif` (`brew install libheif`) — needs bundling for distribution |

---

## Key Decisions

- **shadcn/ui + Base UI over Radix** — Radix no longer actively maintained; Base UI (MUI team) replaces it as the headless primitives layer
- **Tauri over Electron** — lighter, Rust backend is the learning goal
- **Tauri over Capacitor** — desktop-first; if mobile needed later, migrate native layer to Capacitor (React components port 1:1)
- **UUIDv7 primary keys** — time-sortable, cloud-sync safe if we add sync later
- **`synced_at` column on all tables** — `NULL` = dirty; future sync queue is just `WHERE synced_at IS NULL`
- **App name: KEEP** — bundle ID `is.geir.keep`, macOS only (was MOOD / `is.geir.mood`)
- **Images + Tags + Collections as React Context** — `ImagesProvider` + `TagsProvider` + `CollectionsProvider` mounted in App.tsx; mutations propagate instantly across Grid, TopNav, and Lightbox
- **Lightbox uses `openId` not `openIndex`** — stable identity survives filter/sort changes; index derived via `findIndex` on render
- **GIF thumb = file_path** — original GIF used as thumb_path so animation is preserved in grid + lightbox; frame 0 must be decoded separately for AI analysis
- **SVG thumb = file_path** — SVG served as own thumbnail; WKWebView renders natively; checkerboard bg (white in grid, pattern in lightbox)
- **Post/link records share `images` table** — `kind` discriminator (`image`|`post`|`link`) + `post_meta TEXT` JSON; `file_path`/`thumb_path` = downloaded first image so grid works unchanged
- **IntersectionObserver lazy loading** — chosen over TanStack Virtual to avoid masonry geometry issues; sufficient for realistic library sizes
- **`window.prompt()` fails in WKWebView** — use inline input state instead (see TopNav `startNaming` pattern)
- **`data:,` causes onError in WKWebView** — use transparent 1×1 GIF base64 as placeholder src

---

## Codebase Map

```
src/
  App.tsx                   — root: providers (Images, Tags, Collections), TopNav, Grid, Lightbox
  components/
    TopNav.tsx              — tab bar (All/Collections/Tags/Bin), search, sort, ? help, settings modal (inline), Analyze All progress
    Grid.tsx                — masonry grid, drag-drop listener, file picker, multi-select, collection/tag/bin views, Lightbox mount
    Lightbox.tsx            — fullscreen overlay, two-panel (image + 300px sidebar), analyze, generate prompt, tags/collections/notes/palette
    BinView.tsx             — deleted items grid; per-item restore + permanent delete; bulk restore; Empty Bin
    PostCard.tsx            — renders kind='link' cards in lightbox sidebar (platform badge, og: title/description/image)
    CmdKDialog.tsx          — ⌘K search overlay (cmdk CommandDialog); grouped Images/Collections/Tags results
    LazyImage.tsx           — IntersectionObserver-based lazy img with dominant-color placeholder
  hooks/
    use-images.ts           — ImagesContext: load, saveBlob/savePath/saveUrl/saveLink, delete, update*, reset, imgSrc (convertFileSrc wrapper), paste listener, pendingItems
    use-tags.ts             — TagsContext: tags list, addTag, removeTag, rename, deleteTag
    useCollections.ts       — CollectionsContext: collections list, create, rename, delete, add/remove image, reorder, getCollectionThumbs
    use-settings.ts         — getSetting/setSetting via SQLite settings table
  mocks/                    — Tauri API stubs for `bun run browser` preview mode

src-tauri/src/lib.rs        — ALL Rust commands:
  save_thumb()              — resize to 600px Lanczos3 JPEG; shared by all save paths
  compute_thumb_hash()      — ThumbHash LQIP from 100px Triangle downsample
  process_and_save()        — core pipeline: save file, SVG/GIF/JXL/HEIC/video branches, thumbnail, color-thief palette, Vision tags
  run_vision()              — shells out to keep-vision binary → {tags, ocr_text}
  decode_jxl()              — jxl-oxide → DynamicImage
  decode_heic()             — libheif-rs → DynamicImage
  save_image_bytes/from_path/from_url/save_link — IPC entry points → process_and_save / og: scrape
  analyze_image()           — base64 thumb → OpenRouter or local llama-mtmd-cli → {title, tags, description}
  analyze_local()           — llama-mtmd-cli sidecar → {title, tags, description} (no network)
  analyze_vision_item()     — Vision Framework classify+OCR for backfill
  generate_prompt()         — base64 thumb → gemini-2.5-flash or local llama-mtmd-cli → prompt string
  trash_files()             — move file + thumb to macOS Trash (soft delete)
  copy_files_to_clipboard() — copy multiple image files to macOS clipboard
  backfill_thumb_hashes()   — retroactively compute thumb_hash for existing library
  delete_image_files()      — remove file_path + thumb_path from disk
  reset_all_images()        — nuke images/ + thumbs/ dirs
  save/load_example_snapshot — dev E1 snapshot system
  run()                     — Tauri builder, SQLite migrations v1–v9, command registration

src-tauri/Cargo.toml        — image crate (png/jpeg/gif/webp/bmp/tiff/avif-native), jxl-oxide, libheif-rs, color-thief, thumbhash, reqwest, base64, scraper
```

**State flow:** Images/Tags/Collections are all React Context (`ImagesProvider`, `TagsProvider`, `CollectionsProvider` in App.tsx). Mutations call SQLite directly via `tauri-plugin-sql`, then update shared context state — no server round-trip after the initial load.

**Key patterns:**
- `imgSrc(path)` — always wrap file paths with this; calls `convertFileSrc` for Tauri asset protocol
- Async Tauri listeners in `useEffect` need a `mounted` guard (see drag-drop in Grid.tsx) to prevent duplicate registration in React StrictMode
- `thumb_name === file_name` in snapshot restore → file is in `images/` not `thumbs/` (GIF/SVG)
- All SQLite migrations are additive `ALTER TABLE` — never drop columns

## Font

Custom font: **Same Univers** (variable, `src/assets/fonts/SameUnivers.woff2`).  
Currently using **Geist Variable** (`@fontsource-variable/geist`) for testing while font metric issues are investigated.

Same Univers has `sTypoLineGap: 324` (32.4% of em) which bloats the line box and causes text to sit visually high in fixed-height containers. Workaround is `ascent-override: 85%; descent-override: 15%; line-gap-override: 0%` in `@font-face`.

---

## Browser Preview

`bun run browser` starts Vite on port 1421 with all Tauri APIs mocked (`src/mocks/`), serving seed data. Used for Figma capture and layout review. The Tauri app runs on port 1420.

---

## Unresolved

1. ~~App name / brand?~~ **KEEP** — bundle ID: `is.geir.keep`
2. ~~macOS-only or also Windows?~~ **macOS only**
3. ~~Cloud sync later, or local-forever?~~ **Local-first, sync optional later** — `synced_at` already in schema
4. ~~Clipboard paste — Phase 2 or Phase 1?~~ **Phase 1**
5. ~~Image notes — needs schema migration~~ **Done** — migration v2 adds `notes TEXT`
6. Lazy loading strategy — virtual scroll still unresolved for very large libraries
7. Same Univers font metrics — needs `ascent-override` hack or font fix from type designer
