# Tauri Security Hardening Audit — KEEP

Resolves [ticket #6](https://github.com/geirolafs/keep-app/issues/6) of [map #1](https://github.com/geirolafs/keep-app/issues/1). Audit date: 2026-07-09. Scope: CSP, capability allowlists, IPC surface, extension permissions — measured against Tauri v2 best practice for a **public** release.

## TL;DR

The current config is fine for a solo local build but **not release-ready**. Three things do the damage: **CSP is disabled** (`csp: null`), the **asset protocol is scoped to the whole filesystem** (`["**"]`), and the **IPC surface trusts caller-supplied absolute paths** (arbitrary read / delete / write, plus `sql:allow-execute` and SSRF). None is exploitable today because there's no injection sink in our own code (SQL is parameterized, React auto-escapes, no `dangerouslySetInnerHTML`). But every one is a *force multiplier*: the day a dependency or remote-scraped string introduces an XSS, these turn a script bug into arbitrary file access. Hardening = shrink the blast radius before we ship.

Priorities below are ordered. **P0/P1 should block v1.0**; P2 is strongly recommended; P3 is hygiene.

---

## P0 — Enable a Content Security Policy

**Finding.** `tauri.conf.json → app.security.csp = null`. No CSP is applied to the WKWebView. CSP is Tauri's primary XSS mitigation; with it off, any injected script runs unrestricted and can reach every IPC command.

**Why it matters for release.** We render remote-sourced strings (og: title/description from social URL scraping, Vision OCR text, AI titles). Today React escapes them, but a public app pulls untrusted content by design — CSP is the backstop when escaping fails.

**Fix.** Set an explicit, restrictive policy. Tauri appends its own nonces/hashes at build time, so we only declare what's unique to us. Starting point:

```jsonc
"csp": {
  "default-src": "'self'",
  "img-src": "'self' asset: http://asset.localhost blob: data:",
  "style-src": "'self' 'unsafe-inline'",        // Tailwind v4 + Base UI inject inline styles
  "font-src": "'self'",                          // Same Univers / Geist are bundled, no CDN
  "connect-src": "'self' ipc: http://ipc.localhost",
  "script-src": "'self'"
}
```

Notes:
- **No network hosts needed in `connect-src`.** All outbound HTTP (OpenRouter, image fetch, model download, og: scrape) happens in **Rust**, not the webview — confirm this stays true so the policy can stay tight.
- `'unsafe-inline'` for `style-src` is required by Tailwind/Base UI; that's an accepted, low-risk exception (styles, not scripts).
- Verify against a production build (`bun run build` + `tauri build`), not dev — the dev server relaxes CSP.
- Consider `dangerousDisableAssetCspModification: false` (default) — leave asset CSP modification on.

---

## P1 — Scope the asset protocol

**Finding.** `assetProtocol.scope = ["**"]` grants the webview read access to the **entire filesystem** via `asset:`/`convertFileSrc`. We only ever serve from the app data dir (`images/`, `thumbs/`) plus example snapshots.

**Fix.** Restrict to the directories we actually serve:

```jsonc
"assetProtocol": {
  "enable": true,
  "scope": [
    "$APPDATA/images/**",
    "$APPDATA/thumbs/**",
    "$APPDATA/examples/**"
  ]
}
```

Confirm the `$APPDATA` token resolves to the same `app_data_dir()` the Rust side writes to (`is.geir.keep`). If any served path lives outside app data, add it explicitly rather than widening back to `**`.

---

## P1 — Tighten the IPC command surface (arbitrary path trust)

Several commands accept **caller-supplied absolute paths and act on them with no validation**. From the webview these are one XSS away from arbitrary filesystem access:

| Command | Risk | Path arg |
|---|---|---|
| `delete_image_files` | Arbitrary file **delete** (`remove_file` on any path) | `file_path`, `thumb_path` |
| `trash_files` | Arbitrary file **trash** | `file_path`, `thumb_path` |
| `export_original` | Arbitrary file **read → copy** to any dest | `file_path`, `dest_path` |
| `copy_image_to_clipboard` | Arbitrary file **read** | `file_path` |
| `get_file_size` | Arbitrary path **stat** (info leak) | `file_path` |
| `refresh_thumbnails` | Arbitrary read + **overwrite** thumbs | items[].{file,thumb} |

**Fix (defense in depth).** Add a shared guard that canonicalizes the incoming path and asserts it is inside `app_data_dir()` (or, for `export_original`'s `dest_path`, that the *source* is inside app data — the dest is a user-chosen save location, which is fine). Reject with an error otherwise. This is cheap and closes the whole class at once.

```rust
fn ensure_in_app_data(app: &AppHandle, p: &Path) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let canon = p.canonicalize().map_err(|e| e.to_string())?;
    if canon.starts_with(&base) { Ok(canon) } else { Err("path outside app data".into()) }
}
```

---

## P1 — `download_model_file` path traversal

**Finding.** `download_model_file(url, filename, …)` does `models_dir.join(&filename)` with a **frontend-supplied** `filename`. A value like `../../Library/LaunchAgents/x.plist` escapes the models dir and writes attacker-controlled bytes from an **arbitrary `url`** (also frontend-supplied → SSRF, see P2) to an arbitrary location.

**Fix.** Reject any `filename` containing a path separator or `..`; allow only a fixed allowlist (the two known GGUF names) or `[A-Za-z0-9._-]+`. Optionally hardcode the URLs too, since we only ever fetch two known model files.

---

## P2 — SSRF via `save_image_from_url` and `download_model_file`

**Finding.** Both pass a frontend-supplied URL straight into `reqwest::get`. From the webview, an XSS (or a malicious deep link, if we ever add one) could make the app fetch `http://localhost:…` / `http://169.254.169.254/…` / internal-network hosts and, for `save_image_from_url`, ingest the response. Classic SSRF.

**Fix.** Validate the scheme is `https`/`http` (reject `file:`, though reqwest won't honor it, plus any others), and consider blocking private/loopback/link-local IP ranges for `save_image_from_url`. For `download_model_file`, hardcoding the two model URLs (P1) removes the vector entirely.

---

## P2 — Move the OpenRouter API key out of plaintext SQLite

**Finding.** The key is stored via `setSetting("api_key", …)` in the `settings` table — **plaintext on disk**. Any process running as the user (or anyone with the DB file) can read it.

**Fix.** Store it in the **macOS Keychain** (`keyring` crate, or `tauri-plugin-stronghold`). Keeps the secret out of the SQLite file and off any snapshot/backup of the app data dir. Migrate existing keys on first launch, then delete the settings-table copy.

---

## P2 — `sql:allow-execute` grants the frontend arbitrary SQL

**Finding.** The `default` capability grants `sql:allow-execute`, `sql:allow-select`, **and `sql:allow-load`**. The webview can run any SQL and even **load arbitrary SQLite files** (`sql:allow-load`). Our own JS uses only parameterized queries (good — no injection today), but the *capability* is far broader than our usage: an XSS gets full DB read/write/schema access, and `allow-load` lets it attach any file as a database.

**Fix.**
- **Drop `sql:allow-load`** unless something needs it at runtime (nothing in the current code loads a DB by path after init — the connection string is fixed). This is a clear over-grant.
- Longer term, consider moving mutations behind typed Rust commands and narrowing the plugin scope, so the webview can't issue raw SQL at all. Lower priority than the path/CSP items but worth noting for the "reduce IPC surface" theme.

---

## P3 — `osascript` AppleScript string-building

**Finding.** `copy_files_to_clipboard` builds an AppleScript by string-interpolating file paths, escaping only `"`. A path containing a backslash or other AppleScript metacharacter could break out of the quoted literal. Paths are app-generated today (low real risk), but it's a shell-adjacent injection pattern.

**Fix.** Prefer a non-`osascript` clipboard path for file references if one exists in `arboard`/a plugin; otherwise escape backslashes as well as quotes, or pass paths via a temp file / argv rather than interpolated source. Low priority.

---

## What's already good (keep it this way)

- **Parameterized SQL everywhere** in JS (`$1`/`$2` placeholders) — no SQL injection in our code.
- **No `dangerouslySetInnerHTML`**; React auto-escaping covers the remote-string render paths (og:, OCR, AI titles).
- **All outbound network is in Rust**, not the webview — keeps `connect-src` tight.
- **Extension permissions are minimal**: `contextMenus`, `downloads`, `activeTab`, `scripting` — **no `host_permissions`, no `<all_urls>`, no persistent content scripts, no `externally_connectable`**. `activeTab` (user-gesture scoped) over broad host access is the right call. Nothing to tighten here for v1.
- **Downloads-folder bridge is a reasonable trust boundary** — the inbox only ingests known `MEDIA_EXTS` + paired sidecars, uses `file_name()` (no traversal), and deletes only on JS ack. One note: sidecar `source_url`/`title` are untrusted JSON that flow into the DB and later render — safe today via React escaping, but they ride on the P0 CSP backstop.

---

## Recommended sequencing for v1.0

1. **P0 CSP** + **P1 asset scope** — config-only, highest payoff, do first and validate on a production build.
2. **P1 path guard** (`ensure_in_app_data`) + **P1 `download_model_file` filename check** — one small Rust helper closes both.
3. **P2 SSRF validation**, **P2 Keychain migration**, **P2 drop `sql:allow-load`**.
4. **P3 osascript escaping** — hygiene, ship-anytime.

Items 1–2 are the release blockers. 3 is strongly recommended before an open-source public release (the repo going public makes the plaintext-key and broad-capability facts visible to everyone). 4 is optional.

### Fog this clears for the map
- The **Security fixes** entry under *Not yet specified* can now graduate into concrete implementation tickets (P0–P3 above) — but those are *execution*, outside this planning map. The audit's job (decide *what* to harden) is done; the *doing* is a build-phase concern.
