# Project Context

Local-first desktop app for saving, browsing, and organizing visual inspiration.
Built as a learning project to extend existing React skills into native desktop.

Full plan, schema, IPC commands, and decisions log: **PLAN.md**

---

## Current Phase

**Phase 6 — complete. Phase 7 (Polish & Features) — next.**

Phase 6 shipped:
- [x] avif, bmp, tiff/tif, jxl, heic/heif support
  - `avif-native`/`bmp`/`tiff` feature flags; `jxl-oxide` crate; `libheif-rs` crate (system `libheif`)
- [x] SVG — copy as-is, thumb_path = file_path; checkerboard bg in grid (white) and lightbox; analyze hidden
- [x] GIF — original file used as thumb (animated in grid + lightbox); frame 0 needed for analyze
- [x] Drag-drop duplicate fix — `mounted` guard on async Tauri listener
- [x] Example snapshot restore fixed for GIF/SVG (thumb_name === file_name → `images/` dir)

Phase 7 targets — see PLAN.md for full spec:
- [ ] **Retina thumbnails** — 400px → 800px in `process_and_save`
- [ ] **Grid column slider** — 2–12 columns, persisted to settings
- [ ] **⌘K search dialog** — centered overlay, live results, keyboard nav
- [ ] Sort tags by occurrence count
- [ ] Bin / soft delete — schema migration v4 (`deleted_at`), Bin tab, auto-purge 90d, macOS Trash
- [ ] Image dimensions + format in lightbox sidebar
- [ ] SVG + GIF analysis; Generate prompt button (`google/gemini-2.0-flash-exp`)
- [ ] Social URL cards — paste tweet/URL → og: scrape → `<PostCard>` in lightbox
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
- **Tags + Collections as React Context** — `TagsProvider` + `CollectionsProvider` mounted in App.tsx; mutations propagate instantly across Grid and Lightbox
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
  App.tsx                   — root: providers (Tags, Collections), TopNav, Grid, Lightbox
  components/
    TopNav.tsx              — tab bar (All/Collections/Tags), search input, sort, settings gear, Analyze All, dev snapshot buttons
    Grid.tsx                — masonry grid, drag-drop listener, file picker, multi-select, collection/tag views, Lightbox mount
    Lightbox.tsx            — fullscreen overlay, two-panel (image + 300px sidebar), analyze, generate prompt, tags/collections/notes/palette
    LazyImage.tsx           — IntersectionObserver-based lazy img with dominant-color placeholder
    ConfirmDialog.tsx       — reusable confirm modal (replaces window.confirm)
    SettingsModal.tsx       — API key, model, auto-analyze mode
    ToastManager.tsx        — toast queue + renderer
  hooks/
    use-images.ts           — central image state: load, saveBlob/savePath/saveUrl, delete, update*, reset, imgSrc (convertFileSrc wrapper), paste listener
    use-tags.ts             — TagsContext: tags list, addTag, removeTag, rename
    use-collections.ts      — CollectionsContext: collections list, create, rename, delete, add/remove image
    use-settings.ts         — getSetting/setSetting via SQLite settings table
  mocks/                    — Tauri API stubs for `bun run browser` preview mode

src-tauri/src/lib.rs        — ALL Rust commands:
  process_and_save()        — core pipeline: save file, SVG/GIF/JXL/HEIC branches, thumbnail (800px JPEG target), color-thief palette
  decode_jxl()              — jxl-oxide → DynamicImage
  decode_heic()             — libheif-rs → DynamicImage
  save_image_bytes/from_path/from_url — IPC entry points → process_and_save
  analyze_image()           — base64 thumb → OpenRouter vision → {title, tags, description}
  generate_prompt()         — (planned) base64 thumb → gemini-2.0-flash → prompt string
  delete_image_files()      — remove file_path + thumb_path from disk
  reset_all_images()        — nuke images/ + thumbs/ dirs
  save/load_example_snapshot — dev E1/E2 snapshot system
  run()                     — Tauri builder, SQLite migrations v1–v3, command registration

src-tauri/Cargo.toml        — image crate (png/jpeg/gif/webp/bmp/tiff/avif-native), jxl-oxide, libheif-rs, color-thief, reqwest, base64
```

**State flow:** `useImages` owns the images array (local useState). Tags/Collections are React Context (TagsProvider, CollectionsProvider in App.tsx). Mutations call SQLite directly via `tauri-plugin-sql`, then update local state — no server round-trip after the initial load.

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
