// Clipboard capture mode — while enabled, anything copied (image or URL) is
// saved into the library automatically. Polls NSPasteboard.changeCount (cheap)
// so clipboard contents are only read when something actually changed.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::AppHandle;

static ENABLED: AtomicBool = AtomicBool::new(false);
// Set BEFORE any of KEEP's own clipboard writes; the watcher consumes it on the
// next changeCount bump so we never re-ingest our own copy. Marking before the
// write closes the race where a poll tick lands mid-write.
static OWN_PENDING: AtomicBool = AtomicBool::new(false);

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn mark_own_copy() {
    OWN_PENDING.store(true, Ordering::Relaxed);
}

fn change_count() -> isize {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    unsafe {
        let pb: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
        msg_send![pb, changeCount]
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last = change_count();
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let count = change_count();
            if count == last {
                continue;
            }
            last = count;
            // Consume the own-copy marker on any change so it can't leak into a
            // later foreign copy.
            let own = OWN_PENDING.swap(false, Ordering::Relaxed);
            if own || !ENABLED.load(Ordering::Relaxed) || !crate::inbox::frontend_ready() {
                continue;
            }
            // Detached: a slow link scrape must not block polling (copies made
            // meanwhile would coalesce into one changeCount observation).
            let app = app.clone();
            tauri::async_runtime::spawn(async move { capture(&app).await });
        }
    });
}

enum Grabbed {
    Image(Vec<u8>), // re-encoded as PNG
    Text(String),
}

// Sync read, so the (non-Send) Clipboard is dropped before any await.
fn grab() -> Option<Grabbed> {
    let mut cb = arboard::Clipboard::new().ok()?;
    if let Ok(img) = cb.get_image() {
        let rgba =
            image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned())?;
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(rgba)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .ok()?;
        return Some(Grabbed::Image(png));
    }
    if let Ok(text) = cb.get_text() {
        return Some(Grabbed::Text(text.trim().to_string()));
    }
    None
}

fn is_image_url(url: &str) -> bool {
    // strip query AND fragment before the extension check
    let path = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
    path.rsplit('.').next().is_some_and(|ext| {
        crate::MEDIA_EXTS.contains(&ext) && !crate::VIDEO_EXTS.contains(&ext)
    })
}

async fn capture(app: &AppHandle) {
    match grab() {
        Some(Grabbed::Image(png)) => {
            let result = crate::process_and_save(app, &png, "png", None).await;
            report(app, "image", None, result, "Saved image from clipboard");
        }
        Some(Grabbed::Text(text)) if text.starts_with("http://") || text.starts_with("https://") => {
            if is_image_url(&text) {
                let result = crate::save_image_from_url(app.clone(), text.clone()).await;
                report(app, "image", Some(text), result, "Saved image from clipboard");
            } else {
                let result = crate::save_link(app.clone(), text.clone()).await;
                report(app, "link", Some(text), result, "Saved link from clipboard");
            }
        }
        _ => {} // plain text or empty — ignore
    }
}

fn report<T: serde::Serialize>(
    app: &AppHandle,
    capture: &str,
    source_url: Option<String>,
    result: Result<T, String>,
    ok_msg: &str,
) {
    match result {
        Ok(saved) => {
            crate::inbox::emit_external(app, capture, &saved, source_url, None, Vec::new());
            crate::inbox::notify(app, ok_msg);
        }
        Err(e) => {
            eprintln!("[clipboard] {capture} save failed: {e}");
            crate::inbox::notify(app, &format!("Couldn't save from clipboard: {e}"));
        }
    }
}
