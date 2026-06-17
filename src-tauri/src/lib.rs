use base64::Engine as _;
use color_thief::{get_palette, ColorFormat};
use image::imageops::FilterType;
use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

#[derive(serde::Serialize, serde::Deserialize)]
struct AnalysisResult {
    title: String,
    tags: Vec<String>,
    description: String,
}

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

// ── JXL decoder ───────────────────────────────────────────────────────────────

fn decode_jxl(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    use jxl_oxide::{EnumColourEncoding, JxlImage, RenderingIntent};

    let mut jxl = JxlImage::builder()
        .read(std::io::Cursor::new(bytes))
        .map_err(|e| e.to_string())?;

    jxl.request_color_encoding(EnumColourEncoding::srgb(RenderingIntent::Relative));

    let width = jxl.width();
    let height = jxl.height();
    let render = jxl.render_frame(0).map_err(|e| e.to_string())?;
    let mut stream = render.stream();
    let channels = stream.channels() as usize;

    let mut f32_pixels = vec![0.0f32; width as usize * height as usize * channels];
    stream.write_to_buffer(&mut f32_pixels);

    let u8_pixels: Vec<u8> = f32_pixels
        .iter()
        .map(|&p| (p * 255.0).clamp(0.0, 255.0) as u8)
        .collect();

    if channels >= 4 {
        let rgba = image::RgbaImage::from_raw(width, height, u8_pixels)
            .ok_or_else(|| "JXL: failed to build RGBA buffer".to_string())?;
        Ok(image::DynamicImage::ImageRgba8(rgba))
    } else {
        let rgb = image::RgbImage::from_raw(width, height, u8_pixels)
            .ok_or_else(|| "JXL: failed to build RGB buffer".to_string())?;
        Ok(image::DynamicImage::ImageRgb8(rgb))
    }
}

// ── HEIC/HEIF decoder ─────────────────────────────────────────────────────────

fn decode_heic(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};

    let ctx = HeifContext::read_from_bytes(bytes).map_err(|e| e.to_string())?;
    let handle = ctx.primary_image_handle().map_err(|e| e.to_string())?;
    let has_alpha = handle.has_alpha_channel();
    let width = handle.width();
    let height = handle.height();

    let chroma = if has_alpha { RgbChroma::Rgba } else { RgbChroma::Rgb };
    let channels: usize = if has_alpha { 4 } else { 3 };

    let lib_heif = LibHeif::new();
    let heif_img = lib_heif
        .decode(&handle, ColorSpace::Rgb(chroma), None)
        .map_err(|e| e.to_string())?;

    let plane = heif_img
        .planes()
        .interleaved
        .ok_or_else(|| "HEIC: no interleaved plane".to_string())?;

    // stride may include row padding — copy only the pixel bytes per row
    let mut pixels = Vec::with_capacity(width as usize * height as usize * channels);
    for row in 0..height as usize {
        let start = row * plane.stride;
        pixels.extend_from_slice(&plane.data[start..start + width as usize * channels]);
    }

    if has_alpha {
        let rgba = image::RgbaImage::from_raw(width, height, pixels)
            .ok_or_else(|| "HEIC: buffer too small".to_string())?;
        Ok(image::DynamicImage::ImageRgba8(rgba))
    } else {
        let rgb = image::RgbImage::from_raw(width, height, pixels)
            .ok_or_else(|| "HEIC: buffer too small".to_string())?;
        Ok(image::DynamicImage::ImageRgb8(rgb))
    }
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

    // SVG: serve as its own thumb; skip decode / thumbnail / palette
    if safe_ext.eq_ignore_ascii_case("svg") {
        let fp = file_path.to_string_lossy().to_string();
        return Ok(SavedImage {
            id,
            file_path: fp.clone(),
            thumb_path: fp,
            width: 0,
            height: 0,
            dominant_color: None,
            palette: None,
            created_at: now,
        });
    }

    // ── decode ─────────────────────────────────────────────────────────────────
    let img = if safe_ext.eq_ignore_ascii_case("jxl") {
        decode_jxl(bytes)?
    } else if safe_ext.eq_ignore_ascii_case("heic") || safe_ext.eq_ignore_ascii_case("heif") {
        decode_heic(bytes)?
    } else {
        image::load_from_memory(bytes).map_err(|e| e.to_string())?
    };
    let (width, height) = (img.width(), img.height());

    // ── thumbnail ──────────────────────────────────────────────────────────────
    // GIF: keep original as thumb so animation is preserved in the UI
    let thumb_path = if safe_ext.eq_ignore_ascii_case("gif") {
        file_path.clone()
    } else {
        let thumb = img.resize(400, 400, FilterType::Triangle);
        let p = thumbs_dir.join(format!("{}.jpg", id));
        thumb
            .save_with_format(&p, image::ImageFormat::Jpeg)
            .map_err(|e| e.to_string())?;
        p
    };

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

fn copy_dir_contents(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    if !src.exists() { return Ok(()); }
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        std::fs::copy(entry.path(), dst.join(entry.file_name())).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn save_example_snapshot(
    app: tauri::AppHandle,
    n: u32,
    snapshot_json: String,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let example_dir = data_dir.join("examples").join(n.to_string());
    copy_dir_contents(&data_dir.join("images"), &example_dir.join("images"))?;
    copy_dir_contents(&data_dir.join("thumbs"), &example_dir.join("thumbs"))?;
    std::fs::write(example_dir.join("snapshot.json"), &snapshot_json).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct ExampleLoaded {
    data_dir: String,
    snapshot_json: String,
}

#[tauri::command]
async fn load_example_snapshot(
    app: tauri::AppHandle,
    n: u32,
) -> Result<ExampleLoaded, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let example_dir = data_dir.join("examples").join(n.to_string());
    let snapshot_json = std::fs::read_to_string(example_dir.join("snapshot.json"))
        .map_err(|_| format!("Example {} not found — save it first", n))?;
    let _ = std::fs::remove_dir_all(data_dir.join("images"));
    let _ = std::fs::remove_dir_all(data_dir.join("thumbs"));
    copy_dir_contents(&example_dir.join("images"), &data_dir.join("images"))?;
    copy_dir_contents(&example_dir.join("thumbs"), &data_dir.join("thumbs"))?;
    Ok(ExampleLoaded {
        data_dir: data_dir.to_string_lossy().to_string(),
        snapshot_json,
    })
}

#[tauri::command]
async fn analyze_image(thumb_path: String, api_key: String, model: String) -> Result<AnalysisResult, String> {
    let ext = std::path::Path::new(&thumb_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    if ext == "svg" {
        return Err("SVG files cannot be analyzed".to_string());
    }

    let bytes = std::fs::read(&thumb_path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let media_type = if ext == "png" { "image/png" } else { "image/jpeg" };

    // OpenRouter / OpenAI chat completions format with vision
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 256,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:{};base64,{}", media_type, b64)
                    }
                },
                {
                    "type": "text",
                    "text": "Analyze this image. Reply ONLY with valid JSON, no markdown fences: {\"title\": \"Short descriptive title\", \"tags\": [\"tag1\", \"tag2\", \"tag3\"], \"description\": \"One sentence description.\"}. For tags: 3 to 5 broad, distinct, lowercase tags — no duplicates or near-duplicates (e.g. pick 'apple' not both 'apple' and 'apple inc'). Prefer category-level tags over specific details."
                }
            ]
        }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let resp_json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let text = resp_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("Unexpected response shape: {}", resp_json))?;

    // Strip markdown fences if present
    let cleaned = text.trim();
    let cleaned = cleaned.strip_prefix("```json").unwrap_or(cleaned);
    let cleaned = cleaned.strip_prefix("```").unwrap_or(cleaned);
    let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned);
    let cleaned = cleaned.trim();

    serde_json::from_str::<AnalysisResult>(cleaned)
        .map_err(|e| format!("Failed to parse AI response: {} — raw: {}", e, cleaned))
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
    Migration {
        version: 3,
        description: "add description column and settings table",
        kind: MigrationKind::Up,
        sql: "
            ALTER TABLE images ADD COLUMN description TEXT;
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        ",
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
            save_example_snapshot,
            load_example_snapshot,
            analyze_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
