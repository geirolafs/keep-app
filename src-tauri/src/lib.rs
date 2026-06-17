use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

#[derive(serde::Serialize)]
struct SavedImage {
    id: String,
    file_path: String,
    thumb_path: String,
    width: u32,
    height: u32,
    created_at: u64,
}

#[tauri::command]
async fn save_image_bytes(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    extension: String,
) -> Result<SavedImage, String> {
    let id = uuid::Uuid::now_v7().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let images_dir = data_dir.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let ext = if extension.is_empty() {
        "png".to_string()
    } else {
        extension
    };
    let file_path = images_dir.join(format!("{}.{}", id, ext));
    std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let (width, height) = (img.width(), img.height());
    let path_str = file_path.to_string_lossy().to_string();

    Ok(SavedImage {
        id,
        file_path: path_str.clone(),
        thumb_path: path_str, // thumbnail generated in Phase 2
        width,
        height,
        created_at: now,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
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
    }];

    tauri::Builder::default()
        .plugin(
            SqlBuilder::new()
                .add_migrations("sqlite:mood.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_image_bytes])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
