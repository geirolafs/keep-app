use color_thief::{get_palette, ColorFormat};
use image::imageops::FilterType;
use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

#[derive(serde::Serialize)]
struct SavedImage {
    id: String,
    file_path: String,
    thumb_path: String,
    width: u32,
    height: u32,
    dominant_color: Option<String>,
    palette: Option<String>,
    created_at: u64,
}

// ── shared helper ──────────────────────────────────────────────────────────────

async fn process_and_save(
    app: &tauri::AppHandle,
    bytes: &[u8],
    ext: &str,
    source_url: Option<String>,
) -> Result<SavedImage, String> {
    let _ = source_url; // stored in DB by frontend; not used here yet

    let id = uuid::Uuid::now_v7().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(std::time::Duration::ZERO)
        .as_millis() as u64;

    // ── dirs ───────────────────────────────────────────────────────────────────
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let images_dir = data_dir.join("images");
    let thumbs_dir = data_dir.join("thumbs");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;

    // ── save original ──────────────────────────────────────────────────────────
    let safe_ext = if ext.is_empty() { "png" } else { ext };
    let file_path = images_dir.join(format!("{}.{}", id, safe_ext));
    std::fs::write(&file_path, bytes).map_err(|e| e.to_string())?;

    // ── decode ─────────────────────────────────────────────────────────────────
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let (width, height) = (img.width(), img.height());

    // ── thumbnail ──────────────────────────────────────────────────────────────
    let thumb = img.resize(400, 400, FilterType::Triangle);
    let thumb_path = thumbs_dir.join(format!("{}.jpg", id));
    thumb
        .save_with_format(&thumb_path, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    // ── color extraction ───────────────────────────────────────────────────────
    let rgb_img = img.to_rgb8();
    let raw_pixels = rgb_img.as_raw();
    let colors = get_palette(raw_pixels, ColorFormat::Rgb, 10, 5).ok();

    let (dominant_color, palette) = if let Some(ref cols) = colors {
        let hexes: Vec<String> = cols
            .iter()
            .map(|c| format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b))
            .collect();
        let dominant = hexes.first().cloned();
        let palette_json = serde_json::to_string(&hexes).ok();
        (dominant, palette_json)
    } else {
        (None, None)
    };

    Ok(SavedImage {
        id,
        file_path: file_path.to_string_lossy().to_string(),
        thumb_path: thumb_path.to_string_lossy().to_string(),
        width,
        height,
        dominant_color,
        palette,
        created_at: now,
    })
}

// ── commands ───────────────────────────────────────────────────────────────────

#[tauri::command]
async fn save_image_bytes(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    extension: String,
) -> Result<SavedImage, String> {
    process_and_save(&app, &bytes, &extension, None).await
}

#[tauri::command]
async fn save_image_from_path(app: tauri::AppHandle, path: String) -> Result<SavedImage, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_string();
    process_and_save(&app, &bytes, &ext, None).await
}

#[tauri::command]
async fn save_image_from_url(app: tauri::AppHandle, url: String) -> Result<SavedImage, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let ext = std::path::Path::new(url.split('?').next().unwrap_or(&url))
        .extension()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("jpg")
        .to_string();

    process_and_save(&app, &bytes, &ext, Some(url)).await
}

#[tauri::command]
async fn delete_image_files(file_path: String, thumb_path: String) -> Result<(), String> {
    let _ = std::fs::remove_file(&file_path);
    let _ = std::fs::remove_file(&thumb_path);
    Ok(())
}

#[tauri::command]
async fn reset_all_images(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(data_dir.join("images"));
    let _ = std::fs::remove_dir_all(data_dir.join("thumbs"));
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
    Migration {
        version: 1,
        description: "initial schema",
        kind: MigrationKind::Up,
        sql: "
            CREATE TABLE images (
                id              TEXT PRIMARY KEY,
                file_path       TEXT NOT NULL,
                thumb_path      TEXT NOT NULL,
                source_url      TEXT,
                title           TEXT,
                dominant_color  TEXT,
                palette         TEXT,
                width           INTEGER,
                height          INTEGER,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                synced_at       INTEGER
            );

            CREATE TABLE tags (
                id   TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL
            );

            CREATE TABLE image_tags (
                image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
                tag_id   TEXT NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
                PRIMARY KEY (image_id, tag_id)
            );

            CREATE TABLE collections (
                id   TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL
            );

            CREATE TABLE collection_images (
                collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                image_id      TEXT NOT NULL REFERENCES images(id)      ON DELETE CASCADE,
                PRIMARY KEY (collection_id, image_id)
            );

            CREATE INDEX idx_images_created_at ON images(created_at);
            CREATE INDEX idx_images_synced_at  ON images(synced_at);
        ",
    },
    Migration {
        version: 2,
        description: "add notes column",
        kind: MigrationKind::Up,
        sql: "ALTER TABLE images ADD COLUMN notes TEXT;",
    },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            SqlBuilder::new()
                .add_migrations("sqlite:mood.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_image_bytes,
            save_image_from_path,
            save_image_from_url,
            delete_image_files,
            reset_all_images,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
