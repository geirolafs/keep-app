// Inbox watcher — ingests files the browser extension drops into ~/Downloads/KEEP.
// Poll loop rather than FSEvents: single dir, 2s cadence, and sequential ingest
// means a file can't be picked up again while its own processing is in flight.
//
// Ingest is gated on FRONTEND_READY: the DB insert happens in the webview's
// "external-save" listener, so nothing may be processed (and deleted from the
// inbox) until the frontend has registered it — files saved while the app was
// closed simply wait in the folder.
//
// Source files are only deleted once the frontend acks the insert (inbox_ack):
// an emit can land on no listener (webview reload, StrictMode re-register), so
// un-acked emits are retried each tick and quarantined after MAX_EMIT_ATTEMPTS
// rather than silently lost.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const ORPHAN_SIDECAR_MAX_AGE: Duration = Duration::from_secs(300);
const MAX_EMIT_ATTEMPTS: u32 = 8;

static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

pub fn set_frontend_ready() {
    FRONTEND_READY.store(true, Ordering::Relaxed);
}

pub fn frontend_ready() -> bool {
    FRONTEND_READY.load(Ordering::Relaxed)
}

// `<media file>.keep.json` carries metadata for a media download;
// a standalone `<uuid>.keep.json` with type "link" is a save-link request.
#[derive(serde::Deserialize, Default)]
struct Sidecar {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct ExternalSave {
    capture: String,
    saved: serde_json::Value,
    source_url: Option<String>,
    title: Option<String>,
}

// Emitted but not yet acked by the frontend. `files` are deleted on ack,
// quarantined if the ack never comes.
struct Pending {
    id: String,
    payload: ExternalSave,
    files: Vec<PathBuf>,
    attempts: u32,
}

static PENDING: Mutex<Vec<Pending>> = Mutex::new(Vec::new());

pub fn ack(id: &str) {
    let mut pending = PENDING.lock().unwrap();
    if let Some(i) = pending.iter().position(|p| p.id == id) {
        let entry = pending.remove(i);
        for f in &entry.files {
            let _ = std::fs::remove_file(f);
        }
    }
}

fn retry_pending(app: &AppHandle) {
    let mut pending = PENDING.lock().unwrap();
    pending.retain_mut(|entry| {
        if entry.attempts >= MAX_EMIT_ATTEMPTS {
            eprintln!("[inbox] save {} never acked — quarantining", entry.id);
            for f in &entry.files {
                quarantine(f);
            }
            return false;
        }
        entry.attempts += 1;
        let _ = app.emit("external-save", entry.payload.clone());
        true
    });
}

// Paths still on disk that belong to already-emitted saves — the scan loop
// must not pick them up again while they await ack.
fn pending_paths() -> HashSet<PathBuf> {
    PENDING
        .lock()
        .unwrap()
        .iter()
        .flat_map(|p| p.files.iter().cloned())
        .collect()
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let dir = match app.path().download_dir() {
            Ok(d) => d.join("KEEP"),
            Err(e) => {
                eprintln!("[inbox] no Downloads dir: {e}");
                return;
            }
        };
        if let Err(e) = std::fs::create_dir_all(&dir) {
            eprintln!("[inbox] cannot create {}: {e}", dir.display());
            return;
        }
        // last observed (size, mtime) per file — ingest only once stable across ticks
        let mut seen: HashMap<PathBuf, (u64, SystemTime)> = HashMap::new();
        loop {
            if frontend_ready() {
                retry_pending(&app);
                tick(&app, &dir, &mut seen).await;
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

async fn tick(app: &AppHandle, dir: &Path, seen: &mut HashMap<PathBuf, (u64, SystemTime)>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return, // folder gone or no Downloads permission; retry next tick
    };
    let mut next: HashMap<PathBuf, (u64, SystemTime)> = HashMap::new();
    let awaiting_ack = pending_paths();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if name.starts_with('.')
            || name.ends_with(".crdownload")
            || name.ends_with(".part")
            || name.ends_with(".download")
            || !path.is_file()
            || awaiting_ack.contains(&path)
        {
            continue;
        }

        if name.ends_with(".keep.json") {
            handle_sidecar(app, &path).await;
            continue;
        }

        let Some(ext) = path.extension().and_then(|s| s.to_str()).map(str::to_lowercase) else {
            continue;
        };
        if !crate::MEDIA_EXTS.contains(&ext.as_str()) {
            continue; // not ours — leave unknown files alone
        }

        let Ok(meta) = entry.metadata() else { continue };
        let stat = (meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));
        match seen.get(&path) {
            Some(prev) if *prev == stat && stat.0 > 0 => {
                ingest_media(app, &path).await;
                // ingested (or quarantined) — not carried into `next`
            }
            _ => {
                next.insert(path, stat);
            }
        }
    }
    *seen = next;
}

async fn ingest_media(app: &AppHandle, path: &Path) {
    let sidecar_path = PathBuf::from(format!("{}.keep.json", path.to_string_lossy()));
    let sc: Sidecar = std::fs::read_to_string(&sidecar_path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();

    match crate::save_from_path(app, path, sc.source_url.clone()).await {
        Ok(saved) => {
            let capture = match sc.kind.as_deref() {
                Some("screenshot") => "screenshot",
                _ => "image",
            };
            emit_external(
                app,
                capture,
                &saved,
                sc.source_url,
                sc.title,
                vec![path.to_path_buf(), sidecar_path],
            );
        }
        Err(e) => {
            eprintln!("[inbox] ingest failed for {}: {e}", path.display());
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
            notify(app, &format!("Couldn't save {file_name}"));
            quarantine(path);
            quarantine(&sidecar_path); // keep metadata alongside the bytes for manual retry
        }
    }
}

async fn handle_sidecar(app: &AppHandle, path: &Path) {
    // Media sidecar? Its companion consumes it — don't even read it while the
    // media file (or its in-flight .crdownload) exists.
    let name = path.to_string_lossy();
    if let Some(media) = name.strip_suffix(".keep.json") {
        let media = PathBuf::from(media);
        if media.exists() || PathBuf::from(format!("{}.crdownload", media.display())).exists() {
            return;
        }
    }

    let Ok(text) = std::fs::read_to_string(path) else { return };
    match serde_json::from_str::<Sidecar>(&text) {
        Ok(sc) if sc.kind.as_deref() == Some("link") => {
            let Some(url) = sc.url else {
                let _ = std::fs::remove_file(path);
                return;
            };
            match crate::save_link(app.clone(), url.clone()).await {
                Ok(saved) => {
                    emit_external(app, "link", &saved, Some(url), None, vec![path.to_path_buf()]);
                }
                Err(e) => {
                    eprintln!("[inbox] link save failed: {e}");
                    notify(app, &format!("Couldn't save link: {e}"));
                    quarantine(path); // keep the request around instead of losing it
                }
            }
        }
        // Media sidecar whose companion never arrived, or malformed JSON
        // (possibly still mid-write) — purge once it's old enough.
        _ => {
            let orphaned = std::fs::metadata(path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > ORPHAN_SIDECAR_MAX_AGE);
            if orphaned {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

// Rename out of the watched namespace so it isn't retried every tick, but keep
// the bytes on disk for manual recovery.
fn quarantine(path: &Path) {
    let mut failed = path.as_os_str().to_owned();
    failed.push(".failed");
    let _ = std::fs::rename(path, PathBuf::from(failed));
}

// `files` are the on-disk sources for this save — deleted once the frontend
// acks the insert, quarantined if it never does. Pass an empty Vec when there
// is nothing to clean up (clipboard captures).
pub fn emit_external<T: serde::Serialize>(
    app: &AppHandle,
    capture: &str,
    saved: &T,
    source_url: Option<String>,
    title: Option<String>,
    files: Vec<PathBuf>,
) {
    let saved = match serde_json::to_value(saved) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[inbox] emit serialize failed: {e}");
            return;
        }
    };
    let Some(id) = saved["id"].as_str().map(str::to_string) else {
        eprintln!("[inbox] emit payload has no id — skipping");
        return;
    };
    let payload = ExternalSave { capture: capture.to_string(), saved, source_url, title };
    PENDING.lock().unwrap().push(Pending { id, payload: payload.clone(), files, attempts: 1 });
    let _ = app.emit("external-save", payload);
}

pub fn notify(app: &AppHandle, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title("KEEP").body(body).show();
}
