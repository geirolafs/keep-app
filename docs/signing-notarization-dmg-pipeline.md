# Signing, Notarization & DMG Pipeline — KEEP

How KEEP (Tauri v2, macOS-only, `is.geir.keep`) gets from `tauri build` to a signed, notarized, stapled DMG on GitHub Releases — including the two hard parts specific to this repo: bundled Homebrew **libheif** dylibs and the two **externalBin sidecars** (`keep-vision` Swift binary, `llama-mtmd-cli` from llama.cpp). Companion to [tauri-security-audit.md](./tauri-security-audit.md) (its P0 CSP + P1 asset-scope fixes are release blockers that should land before any signed build ships).

---

## TL;DR — recommended pipeline

**Target state (Path 1, "full static"):** make both native problems disappear so Tauri's *built-in* sign → notarize → staple → DMG flow does everything, no custom script.

1. **Fix the sidecar-name bug first** (real production breakage): the bundler copies `externalBin` into `Contents/MacOS` with the target-triple suffix **stripped**, but `lib.rs` looks for `keep-vision-aarch64-apple-darwin` / `llama-mtmd-cli-aarch64-apple-darwin` next to the exe — so in a bundled .app, Vision tagging silently no-ops and local AI falls back to `/opt/homebrew/bin`, which end users don't have. Look for the unsuffixed name first. ([bundler source](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/app.rs#L99-L105))
2. **Rebuild `llama-mtmd-cli` statically** (`-DBUILD_SHARED_LIBS=OFF`): kills the 9 `@rpath` libllama/libggml dylibs the current sidecar needs; Metal shader lib is embedded by default (`GGML_METAL_EMBED_LIBRARY=ON`). Self-contained sidecar → Tauri signs it automatically.
3. **Build a static, decode-only libheif** (libde265 only, no x265/aom) and link it via `PKG_CONFIG_PATH` + `SYSTEM_DEPS_LIBHEIF_LINK=static`: the main binary then has zero Homebrew dylib deps and `scripts/bundle-dylibs.sh` is retired.
4. **Apple side:** Developer ID **Application** cert (no Installer cert needed for DMG), App Store Connect **API key** for notarytool. Export cert as .p12.
5. **One command release:** with `APPLE_SIGNING_IDENTITY` (+ optionally `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` on CI) and `APPLE_API_ISSUER`/`APPLE_API_KEY`/`APPLE_API_KEY_PATH` set, `bun tauri build --bundles app,dmg --target aarch64-apple-darwin` signs everything inside-out (dylibs → sidecars → app), notarizes + staples the .app, and signs the DMG. No entitlements file needed (non-sandboxed, hardened-runtime default, own-Team-ID dylibs, no CPU JIT).
6. **aarch64-only** — sidecars are arm64-only today and Homebrew libs are arch-specific; universal isn't worth it.
7. **Ship via GitHub Actions `tauri-action`** on an arm64 macOS runner once Path 1 lands (local `scripts/release.sh` works identically in the interim); updater (`tauri-plugin-updater` + `createUpdaterArtifacts` + `latest.json`) slots in cleanly only on Path 1, because post-build binary patching invalidates Tauri's updater artifacts.

**Fallback (Path 2, "patch-and-sign script"):** keep `dylibbundler` (already in `scripts/bundle-dylibs.sh`) and hand-roll codesign/notarize/staple/DMG in a release script. Works today, but every release re-patches binaries after Tauri's bundling, so Tauri's auto-sign, auto-notarize, and updater artifacts can't be used — all replicated by hand. See [§8](#8-ci-vs-local-script).

---

## 1. Apple prerequisites

- **Apple Developer Program** membership ($99/yr) — required for Developer ID certs and notarization.
- **Certificate: Developer ID Application.** This is the cert for distributing *outside* the App Store (DMG/zip); "Apple Distribution" is App-Store-only, and **Developer ID Installer is not needed** — it signs `.pkg` installers, not DMGs ([Tauri: creating a signing certificate](https://v2.tauri.app/distribute/sign/macos/#creating-a-signing-certificate)). Notarization is *required* when using a Developer ID Application cert ([Tauri: notarization](https://v2.tauri.app/distribute/sign/macos/#notarization)).
- **notarytool auth — pick one** ([Apple: customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)):
  - **App Store Connect API key** (recommended: no 2FA prompts, revocable, CI-friendly): issuer ID (UUID), key ID, `.p8` file.
  - **Apple ID + app-specific password** + Team ID (2FA accounts must use an app-specific password).
- **Env vars Tauri's bundler reads** ([Tauri signing docs](https://v2.tauri.app/distribute/sign/macos/#signing-in-cicd-platforms), semantics confirmed in [sign.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/sign.rs#L96-L160)):

  | Var | Meaning |
  |---|---|
  | `APPLE_SIGNING_IDENTITY` | cert name, e.g. `Developer ID Application: Name (TEAMID)` (or `bundle.macOS.signingIdentity`) |
  | `APPLE_CERTIFICATE` | base64 of the exported `.p12` (CI only — local keychain works without it) |
  | `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password |
  | `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH` | API-key notarization (issuer UUID, key ID, path to `.p8`; path optional — bundler searches `./private_keys`, `~/private_keys`, `~/.private_keys`, `~/.appstoreconnect/private_keys` for `AuthKey_<ID>.p8`) |
  | `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | Apple-ID notarization; missing `APPLE_TEAM_ID` is a hard error |

- When `APPLE_CERTIFICATE` is set, the **bundler itself** imports the .p12 into a random-named temporary keychain and deletes it afterward — no `apple-actions/import-codesign-certs` step needed on CI ([keychain.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-macos-sign/src/keychain.rs#L55-L191)).

## 2. tauri.conf.json bundle config

Current config has `targets: "all"`, no `bundle.macOS` section. Proposed:

```jsonc
"bundle": {
  "active": true,
  "targets": ["app", "dmg"],                    // macOS-only app; explicit beats "all"
  "externalBin": ["binaries/keep-vision", "binaries/llama-mtmd-cli"],
  "macOS": {
    "minimumSystemVersion": "13.0",             // default is "10.13" — far below reality; decide (§9)
    "hardenedRuntime": true,                    // default true; required for notarization
    "dmg": {                                    // replicates current bundle-dylibs.sh layout
      "windowSize": { "width": 600, "height": 400 },
      "appPosition": { "x": 150, "y": 185 },
      "applicationFolderPosition": { "x": 450, "y": 185 }
    }
  }
}
```

- `bundle.targets` accepts `"app"` (macOS .app) and `"dmg"` ([config reference](https://v2.tauri.app/reference/config/)).
- `bundle.macOS`: `minimumSystemVersion` (default `"10.13"` → `LSMinimumSystemVersion`), `signingIdentity`, `providerShortName`, `entitlements` (path), `hardenedRuntime` (default **true**), `frameworks`, `dmg` ([config reference](https://v2.tauri.app/reference/config/)).
- `frameworks` entries may be a framework name, a `.framework` path, or a **`.dylib` path**; all are copied to `Contents/Frameworks/` — but Tauri does **no** install-name rewriting; the doc-comment says you must run `install_name_tool -add_rpath "@executable_path/../Frameworks" …` yourself ([settings.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/settings.rs#L316-L329), [copy impl](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/app.rs#L384-L443)). This is why `frameworks` alone doesn't solve libheif (§4).
- `externalBin`: source files need the target-triple suffix (`binaries/keep-vision-aarch64-apple-darwin` — already correct in `src-tauri/binaries/`); in the .app they land in **`Contents/MacOS` with the suffix stripped** ([app.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/app.rs#L99-L105), [sidecar guide](https://v2.tauri.app/develop/sidecar/)).

> **Bug to fix in `src-tauri/src/lib.rs`:** `run_vision()` (l.67), `analyze_local()` (l.636) and `generate_prompt_local()` (l.760) join `current_exe().parent()` with the *suffixed* name. In the bundled app the file is `Contents/MacOS/keep-vision` / `llama-mtmd-cli` — the lookup misses, Vision returns empty, llama falls back to `/opt/homebrew/bin/llama-mtmd-cli` (absent on user machines). Try unsuffixed first, suffixed as dev fallback. (The shell-plugin `shell:allow-execute` capability from the sidecar docs is **not** needed — sidecars are spawned from Rust with `std::process::Command`, never from JS.)

## 3. Entitlements

Bottom line: **KEEP needs no entitlements file.** Hardened runtime (on by default) + no sandbox is the correct Developer ID posture.

- **App Sandbox is not required for Developer ID** distribution — only for the Mac App Store ([Apple: App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)). KEEP stays non-sandboxed; file access (drag-drop, `~/Downloads/KEEP` inbox polling, export dialogs) needs nothing.
- **Network:** hardened runtime does not restrict outbound networking; `com.apple.security.network.client` is an *App Sandbox* key and is irrelevant to a non-sandboxed app ([entitlement doc](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client)). reqwest/OpenRouter calls just work.
- **Own dylibs:** library validation only blocks libraries *not* signed by Apple or your own Team ID ([disable-library-validation doc](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation)). Since we sign every bundled dylib with the same Developer ID, `com.apple.security.cs.disable-library-validation` is **not** needed.
- **llama.cpp Metal:** `com.apple.security.cs.allow-jit` and `allow-unsigned-executable-memory` are defined strictly in terms of writable+executable *CPU process memory* (`mmap(MAP_JIT)`) ([allow-jit](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit), [allow-unsigned-executable-memory](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-unsigned-executable-memory)). Metal shader compilation ([`MTLDevice.makeLibrary(source:)`](https://developer.apple.com/documentation/metal/mtldevice/makelibrary(source:options:))) targets the GPU, not executable process memory — no JIT entitlement needed. *Caveat: this is inference from the entitlement definitions; Apple has no explicit "Metal needs no JIT entitlement" statement. Verify empirically on the first signed build (§6).* No llama.cpp notarization issue reporting otherwise was found; the known friction case ([lmstudio-dsv4-patch](https://github.com/noreff/lmstudio-dsv4-patch)) is about loading *third-party-signed* llama dylibs, which same-Team-ID signing avoids.
- Notarization hard requirements to keep in mind: every executable signed with Developer ID, hardened runtime on **app and command-line targets** (i.e. both sidecars), secure timestamp (`--timestamp`), no `get-task-allow` ([Apple: notarizing before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [resolving common issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)). Tauri's signer applies `--options runtime` to executables automatically when `hardenedRuntime: true` ([sign.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/sign.rs#L46-L74)).

## 4. Bundling Homebrew libheif

**The problem.** `libheif-rs` → `libheif-sys` locates libheif via pkg-config ([build.rs](https://github.com/Cykooz/libheif-sys/blob/master/build.rs)), so release builds link `/opt/homebrew/opt/libheif/lib/libheif.1.dylib` — a machine-local absolute path. Measured runtime closure on this machine (`otool -L`, recursed): `libheif.1` → `libx265.216`, `libde265.0`, `libaom.3` (→ `libvmaf.3`), `libsharpyuv.0` — six dylibs. Homebrew bottles are prefix-locked and built per-OS (`arm64_tahoe`/`arm64_sequoia`/… tags — [formula API](https://formulae.brew.sh/api/formula/libheif.json), [brew FAQ](https://docs.brew.sh/FAQ)), and any `install_name_tool` edit invalidates the existing signature (Homebrew itself re-signs after relocating — [keg_relocate.rb](https://github.com/Homebrew/brew/blob/master/Library/Homebrew/extend/os/mac/keg_relocate.rb)) — so shipped dylibs must be copied, path-rewritten, and re-signed with our Developer ID.

**Option A — static decode-only libheif (recommended).** KEEP only *decodes* HEIC (AVIF is handled by the `image` crate's `avif-native`), so x265 (encode, GPL) and aom can be dropped entirely; libheif supports codec subsetting and static builds ([libheif README](https://github.com/strukturag/libheif)):

```bash
# one-time (or scripted) — static libde265 + static decode-only libheif
cmake -B b -DBUILD_SHARED_LIBS=OFF -DCMAKE_INSTALL_PREFIX=$PREFIX libde265/ && cmake --build b --target install
cmake -B b --preset=release-noplugins -DBUILD_SHARED_LIBS=OFF \
  -DWITH_LIBDE265=ON -DWITH_X265=OFF -DWITH_AOM_DECODER=OFF -DWITH_AOM_ENCODER=OFF \
  -DCMAKE_INSTALL_PREFIX=$PREFIX libheif/ && cmake --build b --target install
# release build
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
export SYSTEM_DEPS_LIBHEIF_LINK=static   # libheif-sys uses the system-deps crate → pkg-config --static
```

`SYSTEM_DEPS_LIBHEIF_LINK=static` is the [system-deps](https://docs.rs/system-deps/latest/system_deps/) crate's env override — no crate feature needed. (libheif-sys also has an `embedded-libheif` vendored-static feature, but it force-enables *all* codecs including x265/rav1e/svt — avoid.) Result: zero non-system dylibs in the main binary; `bundle.macOS.frameworks`, dylibbundler, and the mtime-workaround in `bundle-dylibs.sh` all become unnecessary, and Tauri's built-in signing pipeline works unmodified. Licensing: libde265 is LGPL-3.0 — static linking requires LGPL §4 compliance (fine if the repo goes public, as the security audit anticipates; otherwise keep libde265 as the single bundled dylib).

**Option B — keep dylibbundler (current, works today).** [`scripts/bundle-dylibs.sh`](../scripts/bundle-dylibs.sh) already does the right mechanics: [dylibbundler](https://github.com/auriamg/macdylibbundler) walks transitive deps via `otool -L`, copies them into `Contents/Frameworks`, and rewrites install names to `@executable_path/../Frameworks/` (this is exactly the manual `install_name_tool -change/-id/-add_rpath` dance; `@executable_path`/`@loader_path`/`@rpath` semantics per `man dyld`). Two costs: dylibbundler leaves *ad-hoc* signatures (pass `-ns` and re-sign properly), and because it patches binaries *after* `tauri build`, Tauri's auto-sign/notarize/updater-artifacts can't be used — the release script must do all of §6 by hand and regenerate updater tarballs.

## 5. Sidecar signing

- **Tauri signs sidecars automatically.** The bundler builds an inside-out signing order — `Contents/Frameworks` contents first, then `externalBin` + main binary in `Contents/MacOS`, then the .app — "per apple, signing must be done inside out" ([app.rs ordering](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/app.rs#L93-L132)); each executable gets `--options runtime` ([sign.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/sign.rs#L46-L74)). So on Path 1, both sidecars are signed + hardened with no extra config.
- **`keep-vision` (Swift): nothing special.** `otool -L` shows only system frameworks (Vision, Foundation, CoreImage) and `/usr/lib/swift/*` — Swift has been ABI-stable since macOS 10.14.4, the runtime ships with the OS, no Swift-runtime bundling ([swift.org ABI stability](https://www.swift.org/blog/abi-stability-and-apple/)). Sign like any executable.
- **`llama-mtmd-cli`: currently broken for distribution.** The checked-in 84 KB binary links nine `@rpath` dylibs (`libllama*`, `libmtmd`, `libggml*`) with `LC_RPATH @loader_path` — the dylibs must sit next to it in `Contents/MacOS`, and *nothing in the current pipeline puts them there*. Fix by rebuilding self-contained:

  ```bash
  cmake -B build -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON llama.cpp/
  cmake --build build --target llama-mtmd-cli -j
  cp build/bin/llama-mtmd-cli src-tauri/binaries/llama-mtmd-cli-aarch64-apple-darwin
  ```

  `-DBUILD_SHARED_LIBS=OFF` is the documented static-build switch ([docs/build.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)); `GGML_METAL_EMBED_LIBRARY` defaults **ON** with Metal, embedding the shader source in the binary's `__DATA,__ggml_metallib` section ([ggml CMakeLists](https://github.com/ggml-org/llama.cpp/blob/master/ggml/CMakeLists.txt), [ggml-metal CMakeLists](https://github.com/ggml-org/llama.cpp/blob/master/ggml/src/ggml-metal/CMakeLists.txt)) — so no loose `ggml-metal.metal`/`default.metallib` files and none of the resource-path failures of the dylib build ([llama.cpp #5376](https://github.com/ggml-org/llama.cpp/issues/5376)). If sticking with the dylib build instead, ship the dylibs into `Contents/MacOS` via `bundle.macOS.files` (Contents-relative dest map — [app.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/app.rs#L182-L209)); Tauri's nested-signing walker signs Frameworks + MacOS contents, but static is strictly simpler.

## 6. Notarization + stapling

- **Tauri auto-notarizes and staples** the .app during `tauri build` when signing succeeded and notarization env vars (§1) are present: it zips with `ditto`, runs `xcrun notarytool submit --wait`, then `xcrun stapler staple` on "Accepted"; missing creds → warning, build continues ([app.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/app.rs#L134-L150), [tauri-macos-sign lib.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-macos-sign/src/lib.rs#L137-L250)). `--skip-stapling` opts out ([docs](https://v2.tauri.app/distribute/sign/macos/#notarization)).
- **DMG:** Tauri builds the DMG from the already-stapled .app and *signs* the DMG, but does not notarize/staple the DMG itself ([dmg/mod.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/dmg/mod.rs#L28-L37)). That's Gatekeeper-clean (the stapled app inside carries the ticket). For fully-offline first-launch, optionally notarize + staple the DMG too — notarizing a DMG generates tickets for it *and* nested items, and `stapler staple` works on disk images ([Apple](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)):

  ```bash
  xcrun notarytool submit keep_0.1.0_aarch64.dmg --keychain-profile keep-notary --wait
  xcrun stapler staple keep_0.1.0_aarch64.dmg
  ```

- **Verify** (per Apple DTS ["Testing a Notarised Product"](https://developer.apple.com/forums/thread/130560)):

  ```bash
  spctl -a -t open -vvv --context context:primary-signature keep_0.1.0_aarch64.dmg   # DMG
  spctl -a -t exec -vvv keep.app                                                     # app (or: syspolicy_check distribution keep.app)
  codesign -vvv --deep --strict keep.app                                             # signature integrity
  ```

  First signed build: also smoke-test local AI (llama Metal path) to confirm the no-entitlements conclusion in §3.

## 7. Updater (tauri-plugin-updater)

All from the [updater guide](https://v2.tauri.app/plugin/updater/):

1. `bun tauri signer generate -- -w ~/.tauri/keep.key` — minisign keypair. **Losing the private key means installed apps can never update.**
2. Build env: `TAURI_SIGNING_PRIVATE_KEY` (path or content) + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (`.env` files don't work).
3. Config:

   ```jsonc
   "bundle": { "createUpdaterArtifacts": true },
   "plugins": {
     "updater": {
       "pubkey": "<contents of keep.key.pub>",
       "endpoints": ["https://github.com/geirolafs/keep-app/releases/latest/download/latest.json"]
     }
   }
   ```

4. macOS artifacts: `keep.app.tar.gz` + `keep.app.tar.gz.sig`. `latest.json` needs `version`, `platforms."darwin-aarch64".url` + `.signature` — [tauri-action](https://github.com/tauri-apps/tauri-action) generates and uploads it automatically (`uploadUpdaterJson` defaults to `true` when the updater is configured).
5. Interaction with Path 2: the `.tar.gz` is created from the .app *as Tauri built it* — post-build dylibbundler patching means re-tarring and re-signing (`tauri signer sign`) manually. Another reason to prefer Path 1.
6. Defer-able: updater is not needed for a first GitHub-Releases DMG; adding it later only requires shipping the pubkey+endpoint config in the *previous* release users install from.

## 8. CI vs local script

**Recommendation:** local `scripts/release.sh` for the first signed release (fast iteration on the one-time gotchas), then move to `tauri-action` CI once Path 1 makes the build hermetic. Both are aarch64-only (`--target aarch64-apple-darwin`): the sidecars are arm64-only, Homebrew/static libheif is arch-specific, and nothing suggests Intel demand; universal would require dual native-lib builds + `lipo` for marginal benefit.

**Local script (Path 1) — `scripts/release.sh`:**

```bash
#!/usr/bin/env bash
set -euo pipefail
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
export APPLE_API_ISSUER=… APPLE_API_KEY=…   # AuthKey_<ID>.p8 in ~/.appstoreconnect/private_keys
export PKG_CONFIG_PATH="$HOME/.local/keep-deps/lib/pkgconfig" SYSTEM_DEPS_LIBHEIF_LINK=static
# export TAURI_SIGNING_PRIVATE_KEY=… TAURI_SIGNING_PRIVATE_KEY_PASSWORD=…   # when updater lands

bun tauri build --bundles app,dmg --target aarch64-apple-darwin   # signs, notarizes, staples, DMGs

DMG=src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/keep_*_aarch64.dmg
xcrun notarytool submit $DMG --key ~/.appstoreconnect/private_keys/AuthKey_$APPLE_API_KEY.p8 \
  --key-id $APPLE_API_KEY --issuer $APPLE_API_ISSUER --wait      # optional DMG staple pass
xcrun stapler staple $DMG
spctl -a -t open -vvv --context context:primary-signature $DMG
gh release create "v$(jq -r .version src-tauri/tauri.conf.json)" $DMG --draft
```

(Path 2 variant: `tauri build --bundles app` **without** APPLE_* env → `bundle-dylibs.sh` → manual inside-out `codesign --force --timestamp --options runtime -s "$ID"` on `Contents/Frameworks/*.dylib`, both sidecars, then the .app → `ditto`-zip → `notarytool submit --wait` → `stapler staple` → `bundle_dmg.sh` → sign DMG → verify. All steps as in §6.)

**CI — `.github/workflows/release.yml` sketch** (per [tauri-action README](https://github.com/tauri-apps/tauri-action) and [Tauri GitHub pipeline guide](https://v2.tauri.app/distribute/pipelines/github/); `macos-14`+/`macos-latest` runners are arm64 — GitHub runner-images, not verified against Tauri docs):

```yaml
on: { push: { tags: ['v*'] } }
jobs:
  release:
    runs-on: macos-latest            # arm64 (M-series)
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: aarch64-apple-darwin }
      # + steps to fetch/build static libheif + sidecar binaries (cache or commit prebuilt)
      - run: bun install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}                # base64 .p12 — bundler makes the temp keychain itself
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_PATH: ${{ secrets.APPLE_API_KEY_PATH }}              # or write the .p8 in a prior step
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: 'KEEP v__VERSION__'
          releaseDraft: true
          args: --target aarch64-apple-darwin
```

Secrets: 8 above (updater two only when enabled). No separate keychain-import action — the Tauri bundler handles `APPLE_CERTIFICATE` (§1). The CI blocker is reproducing the native deps (static libheif prefix, sidecar binaries) on the runner — commit prebuilt sidecars (already done) and either commit or cache the libheif static libs.

## 9. Open questions

1. **Path 1 (static libheif + static llama) vs Path 2 (dylibbundler + manual sign script)?** Rec: Path 1 — unlocks stock `tauri build`, CI, updater.
2. **notarytool auth: API key vs Apple ID app-specific password?** Rec: API key.
3. **First release local script or straight to tauri-action CI?** Rec: local first, CI after Path 1.
4. **`minimumSystemVersion`?** arm64-only implies ≥11; Vision/llama tested on what? Pick 12.0/13.0/14.0. (Path 2 note: Homebrew bottles are built per-OS — bundled dylibs may not honor a low minimum.)
5. **Updater in v1.0 or first update-capable release later?** Keypair must exist before the first release that should be able to *receive* updates.
6. **libde265 LGPL:** repo going public (per audit) satisfies it trivially — confirm the open-source plan before static-linking.
7. **DMG cosmetics:** keep default DMG or add `background` image + positions in `bundle.macOS.dmg`?
8. **Sidecar name fix (§2) + first-signed-build Metal smoke test (§3/§6)** — not decisions, but must-dos before shipping.
