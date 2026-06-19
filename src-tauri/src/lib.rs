use base64::Engine as _;
use color_thief::{get_palette, ColorFormat};
use image::imageops::FilterType;
use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

fn save_thumb(img: &image::DynamicImage, path: &std::path::Path) -> Result<(), String> {
    let thumb = img.resize(600, 600, FilterType::Lanczos3);
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, 85);
    thumb.write_with_encoder(encoder).map_err(|e| e.to_string())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AnalysisResult {
    title: String,
    tags: Vec<String>,
    description: String,
}

fn compute_thumb_hash(img: &image::DynamicImage) -> Option<String> {
    let small = img.resize(100, 100, image::imageops::FilterType::Triangle);
    let rgba = small.to_rgba8();
    let (w, h) = (small.width() as usize, small.height() as usize);
    let hash_bytes = thumbhash::rgba_to_thumb_hash(w, h, rgba.as_raw());
    Some(base64::engine::general_purpose::STANDARD.encode(&hash_bytes))
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
    kind: String,
    vision_tags: Vec<String>,
    ocr_text: String,
    thumb_hash: Option<String>,
}

// ── macOS Vision Framework helper (silent, zero setup) ────────────────────────

fn run_vision(thumb_path: &str) -> (Vec<String>, String) {
    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(_) => return (vec![], String::new()),
    };
    let dir = match exe.parent() {
        Some(d) => d,
        None => return (vec![], String::new()),
    };
    let binary_name = format!("keep-vision-{}-apple-darwin", std::env::consts::ARCH);
    let binary = dir.join(&binary_name);
    if !binary.exists() {
        return (vec![], String::new());
    }

    let output = match std::process::Command::new(&binary).arg(thumb_path).output() {
        Ok(o) => o,
        Err(_) => return (vec![], String::new()),
    };

    let stdout = match std::str::from_utf8(&output.stdout) {
        Ok(s) => s,
        Err(e) => { eprintln!("[vision] utf8 error: {}", e); return (vec![], String::new()); }
    };

    // Framework warnings are prepended on stdout with no newline on macOS 26+; slice from last '{'
    let json_str = stdout.rfind('{').map(|i| &stdout[i..]).unwrap_or("");

    #[derive(serde::Deserialize)]
    struct VisionResult { tags: Vec<String>, ocr_text: String }

    match serde_json::from_str::<VisionResult>(json_str) {
        Ok(r) => (r.tags, r.ocr_text),
        Err(_) => (vec![], String::new()),
    }
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

// ── yt-dlp: extract direct video URL from a tweet ─────────────────────────────

fn yt_dlp_get_url(tweet_url: &str) -> Option<String> {
    let candidates = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "yt-dlp"];
    let bin = candidates.iter().find(|p| {
        if p.starts_with('/') { std::path::Path::new(p).exists() } else { true }
    })?;
    let out = std::process::Command::new(bin)
        .args(["--no-warnings", "-f", "mp4", "--get-url", tweet_url])
        .output().ok()?;
    std::str::from_utf8(&out.stdout).ok()?.trim().lines()
        .find(|l| l.starts_with("http"))
        .map(str::to_string)
}

// ── video frame extractor (macOS qlmanage — no external deps) ─────────────────

fn extract_video_frame(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let tmp_dir = std::env::temp_dir().join(format!("keep_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

    std::process::Command::new("/usr/bin/qlmanage")
        .args([
            "-t", "-s", "600",
            "-o", tmp_dir.to_str().unwrap_or("/tmp"),
            path.to_str().unwrap_or(""),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| { let _ = std::fs::remove_dir_all(&tmp_dir); format!("qlmanage failed: {}", e) })?;

    // qlmanage outputs <filename>.<ext>.png in the output dir
    let file_name = path.file_name()
        .and_then(|s| s.to_str())
        .ok_or("Invalid video path")?;
    let thumb_file = tmp_dir.join(format!("{}.png", file_name));

    let bytes = std::fs::read(&thumb_file)
        .map_err(|_| "qlmanage did not produce a thumbnail — unsupported video format?".to_string())?;
    std::fs::remove_dir_all(&tmp_dir).ok();
    Ok(bytes)
}

async fn process_video_from_path(
    app: &tauri::AppHandle,
    src_path: &std::path::Path,
    ext: &str,
) -> Result<SavedImage, String> {
    let id = uuid::Uuid::now_v7().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(std::time::Duration::ZERO)
        .as_millis() as u64;

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let images_dir = data_dir.join("images");
    let thumbs_dir = data_dir.join("thumbs");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;

    let file_path = images_dir.join(format!("{}.{}", id, ext.to_lowercase()));
    std::fs::copy(src_path, &file_path).map_err(|e| e.to_string())?;

    let frame_bytes = extract_video_frame(&file_path)?;
    let img = image::load_from_memory(&frame_bytes).map_err(|e| e.to_string())?;
    let (width, height) = (img.width(), img.height());

    let thumb_path = thumbs_dir.join(format!("{}.jpg", id));
    save_thumb(&img, &thumb_path)?;

    let rgb_img = img.to_rgb8();
    let raw_pixels = rgb_img.as_raw();
    let colors = get_palette(raw_pixels, ColorFormat::Rgb, 10, 5).ok();
    let (dominant_color, palette) = if let Some(ref cols) = colors {
        let hexes: Vec<String> = cols
            .iter()
            .map(|c| format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b))
            .collect();
        (hexes.first().cloned(), serde_json::to_string(&hexes).ok())
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
        kind: "video".to_string(),
        vision_tags: vec![],
        ocr_text: String::new(),
        thumb_hash: compute_thumb_hash(&img),
    })
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
            kind: "image".to_string(),
            vision_tags: vec![],
            ocr_text: String::new(),
            thumb_hash: None,
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
        let p = thumbs_dir.join(format!("{}.jpg", id));
        save_thumb(&img, &p)?;
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

    // ── local vision (silent, zero setup) ─────────────────────────────────────
    let thumb_str = thumb_path.to_string_lossy();
    let (vision_tags, ocr_text) = run_vision(&thumb_str);

    let thumb_hash = compute_thumb_hash(&img);

    Ok(SavedImage {
        id,
        file_path: file_path.to_string_lossy().to_string(),
        thumb_path: thumb_str.to_string(),
        width,
        height,
        dominant_color,
        palette,
        created_at: now,
        kind: "image".to_string(),
        vision_tags,
        ocr_text,
        thumb_hash,
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
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_string();

    if ["mp4", "mov", "webm"].iter().any(|v| v.eq_ignore_ascii_case(&ext)) {
        return process_video_from_path(&app, std::path::Path::new(&path), &ext).await;
    }

    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
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

#[derive(serde::Deserialize)]
struct RefreshItem {
    file_path: String,
    thumb_path: String,
    kind: String,
}

#[tauri::command]
async fn refresh_thumbnails(items: Vec<RefreshItem>) -> Result<u32, String> {
    let mut count = 0u32;
    for item in &items {
        if item.kind == "video" || item.thumb_path == item.file_path {
            continue;
        }
        let ext = std::path::Path::new(&item.file_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let bytes = match std::fs::read(&item.file_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let img = if ext == "jxl" {
            match decode_jxl(&bytes) { Ok(i) => i, Err(_) => continue }
        } else if ext == "heic" || ext == "heif" {
            match decode_heic(&bytes) { Ok(i) => i, Err(_) => continue }
        } else {
            match image::load_from_memory(&bytes) { Ok(i) => i, Err(_) => continue }
        };
        if save_thumb(&img, std::path::Path::new(&item.thumb_path)).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

#[derive(serde::Deserialize)]
struct HashItem {
    id: String,
    thumb_path: String,
}

#[derive(serde::Serialize)]
struct HashResult {
    id: String,
    thumb_hash: String,
}

#[tauri::command]
async fn backfill_thumb_hashes(items: Vec<HashItem>) -> Result<Vec<HashResult>, String> {
    let mut results = Vec::new();
    for item in &items {
        let bytes = match std::fs::read(&item.thumb_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let img = match image::load_from_memory(&bytes) {
            Ok(i) => i,
            Err(_) => continue,
        };
        if let Some(hash) = compute_thumb_hash(&img) {
            results.push(HashResult { id: item.id.clone(), thumb_hash: hash });
        }
    }
    Ok(results)
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

    // Prepare image bytes + media type for the vision API
    let (b64, media_type) = if ext == "svg" {
        // Rasterize SVG via qlmanage → PNG
        let png = extract_video_frame(std::path::Path::new(&thumb_path))
            .map_err(|e| format!("SVG rasterization failed: {}", e))?;
        (base64::engine::general_purpose::STANDARD.encode(&png), "image/png")
    } else if ext == "gif" {
        // Decode frame 0 → JPEG (GIF thumb is the animated original)
        let gif_bytes = std::fs::read(&thumb_path).map_err(|e| e.to_string())?;
        let img = image::load_from_memory(&gif_bytes).map_err(|e| e.to_string())?;
        let mut cur = std::io::Cursor::new(Vec::new());
        img.write_to(&mut cur, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;
        (base64::engine::general_purpose::STANDARD.encode(cur.into_inner()), "image/jpeg")
    } else {
        let bytes = std::fs::read(&thumb_path).map_err(|e| e.to_string())?;
        let mt = if ext == "png" { "image/png" } else { "image/jpeg" };
        (base64::engine::general_purpose::STANDARD.encode(&bytes), mt)
    };

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

#[tauri::command]
async fn generate_prompt(thumb_path: String, api_key: String, model: String) -> Result<String, String> {
    let ext = std::path::Path::new(&thumb_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    let (b64, media_type) = if ext == "svg" {
        let png = extract_video_frame(std::path::Path::new(&thumb_path))
            .map_err(|e| format!("SVG rasterization failed: {}", e))?;
        (base64::engine::general_purpose::STANDARD.encode(&png), "image/png")
    } else if ext == "gif" {
        let gif_bytes = std::fs::read(&thumb_path).map_err(|e| e.to_string())?;
        let img = image::load_from_memory(&gif_bytes).map_err(|e| e.to_string())?;
        let mut cur = std::io::Cursor::new(Vec::new());
        img.write_to(&mut cur, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;
        (base64::engine::general_purpose::STANDARD.encode(cur.into_inner()), "image/jpeg")
    } else {
        let bytes = std::fs::read(&thumb_path).map_err(|e| e.to_string())?;
        let mt = if ext == "png" { "image/png" } else { "image/jpeg" };
        (base64::engine::general_purpose::STANDARD.encode(&bytes), mt)
    };

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 512,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": { "url": format!("data:{};base64,{}", media_type, b64) }
                },
                {
                    "type": "text",
                    "text": "Write a detailed image generation prompt for this image, suitable for Midjourney, DALL-E, or Flux. Describe the subject, composition, style, lighting, color palette, mood, and any relevant technical or artistic details. Return ONLY the prompt text — no preamble, labels, or explanation."
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

    resp_json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("Unexpected response shape: {}", resp_json))
}

#[derive(serde::Serialize)]
struct VisionAnalysis {
    tags: Vec<String>,
    ocr_text: String,
}

#[tauri::command]
fn analyze_vision_item(thumb_path: String) -> VisionAnalysis {
    let (tags, ocr_text) = run_vision(&thumb_path);
    VisionAnalysis { tags, ocr_text }
}

#[tauri::command]
fn export_original(file_path: String, dest_path: String) -> Result<(), String> {
    std::fs::copy(&file_path, &dest_path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_image_to_clipboard(file_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    let img = match ext.as_str() {
        "jxl" => {
            let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
            decode_jxl(&bytes)?
        }
        "heic" | "heif" => {
            let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
            decode_heic(&bytes)?
        }
        _ => image::open(&file_path).map_err(|e| e.to_string())?,
    };

    let rgba = img.into_rgba8();
    let (width, height) = rgba.dimensions();
    let pixels = rgba.into_raw();

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::from(pixels),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_files_to_clipboard(file_paths: Vec<String>) -> Result<(), String> {
    let items: Vec<String> = file_paths
        .iter()
        .map(|p| format!("POSIX file \"{}\"", p.replace('"', "\\\"")))
        .collect();
    let script = format!("set the clipboard to {{{}}}", items.join(", "));
    let out = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

fn resolve_url(img_url: &str, base_url: &str) -> String {
    if img_url.starts_with("http://") || img_url.starts_with("https://") {
        img_url.to_string()
    } else if img_url.starts_with("//") {
        format!("https:{}", img_url)
    } else if img_url.starts_with('/') {
        let origin = base_url.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
        format!("{}{}", origin, img_url)
    } else {
        img_url.to_string() // best-effort for relative paths
    }
}

struct OgMeta {
    title: Option<String>,
    description: Option<String>,
    image: Option<String>,
    video: Option<String>,
    site_name: Option<String>,
}

fn parse_og_tags(html: &str) -> OgMeta {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);
    let get_og = |prop: &str| -> Option<String> {
        let sel = Selector::parse(&format!(r#"meta[property="{}"]"#, prop)).ok()?;
        doc.select(&sel).next()?.value().attr("content").map(str::to_string)
    };
    let title = get_og("og:title").or_else(|| {
        Selector::parse("title").ok().and_then(|sel| {
            doc.select(&sel).next().map(|el| el.text().collect::<String>().trim().to_string())
        })
    });
    let description = get_og("og:description").or_else(|| {
        Selector::parse(r#"meta[name="description"]"#).ok().and_then(|sel| {
            doc.select(&sel).next()?.value().attr("content").map(str::to_string)
        })
    });
    // Prefer secure_url > url for video
    let video = get_og("og:video:secure_url")
        .or_else(|| get_og("og:video:url"))
        .or_else(|| get_og("og:video"))
        .filter(|v| v.ends_with(".mp4") || v.contains("video.twimg.com"));
    OgMeta { title, description, image: get_og("og:image"), video, site_name: get_og("og:site_name") }
}

fn strip_html_tags(html: &str) -> String {
    use scraper::Html;
    Html::parse_fragment(html).root_element().text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(serde::Serialize)]
struct SavedLink {
    id: String,
    file_path: String,
    thumb_path: String,
    width: u32,
    height: u32,
    dominant_color: Option<String>,
    palette: Option<String>,
    created_at: u64,
    post_meta: String,
}

#[tauri::command]
async fn save_link(app: tauri::AppHandle, url: String) -> Result<SavedLink, String> {
    let is_tweet = (url.contains("x.com/") || url.contains("twitter.com/")) && url.contains("/status/");

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let id = uuid::Uuid::now_v7().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(std::time::Duration::ZERO)
        .as_millis() as u64;

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let images_dir = data_dir.join("images");
    let thumbs_dir = data_dir.join("thumbs");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;

    // Derive domain for display
    let domain = url.split("://").nth(1)
        .and_then(|s| s.split('/').next())
        .unwrap_or("").to_string();

    // Fetch metadata
    let (title, description, site_name, image_url, video_url, author_name) = if is_tweet {
        // Fetch oEmbed for author + caption
        let oembed_url = format!("https://publish.twitter.com/oembed?url={}&maxwidth=550&dnt=true", url);
        let (author, caption, oembed_thumb) = match client.get(&oembed_url).send().await {
            Ok(resp) => {
                let oembed: serde_json::Value = resp.json().await.unwrap_or_default();
                let author = oembed["author_name"].as_str().map(str::to_string);
                let html_text = oembed["html"].as_str().unwrap_or("");
                let caption = strip_html_tags(html_text);
                let thumb = oembed["thumbnail_url"].as_str().map(str::to_string);
                (author, caption, thumb)
            }
            Err(_) => (None, String::new(), None),
        };
        // Try yt-dlp first for a direct MP4 URL (handles video tweets Twitter hides from og:video)
        let yt_video_url = yt_dlp_get_url(&url);

        // Fetch tweet page og:image (actual image for image tweets; profile pic for video/text tweets)
        let tweet_og_image = async {
            let resp = client.get(&url).header("Accept-Language", "en-US,en;q=0.9").send().await.ok()?;
            let body = resp.text().await.ok()?;
            let og = parse_og_tags(&body);
            og.image.map(|u| resolve_url(&u, &url))
        }.await;
        // Only use og:image if it's not a profile pic (profile pics contain /profile_images/)
        let usable_og_image = tweet_og_image.filter(|u| !u.contains("/profile_images/"));
        let image_url = usable_og_image.or(oembed_thumb);
        (
            author.as_deref().map(|a| format!("{} on X", a)),
            Some(caption),
            Some("X".to_string()),
            image_url,
            yt_video_url,
            author,
        )
    } else {
        match client.get(&url).send().await {
            Ok(resp) => {
                let body = resp.text().await.unwrap_or_default();
                let og = parse_og_tags(&body);
                let resolved_img = og.image.map(|u| resolve_url(&u, &url));
                let resolved_vid = og.video.map(|u| resolve_url(&u, &url));
                (og.title, og.description, og.site_name, resolved_img, resolved_vid, None)
            }
            Err(_) => (None, None, None, None, None, None),
        }
    };

    // Helper: download bytes with browser-like headers
    let fetch_bytes = |dl_url: &str| {
        let c = client.clone();
        let u = url.clone();
        let du = dl_url.to_string();
        async move {
            let resp = c.get(&du)
                .header("Referer", &u)
                .header("Accept", "image/webp,image/apng,image/*,video/mp4,*/*;q=0.8")
                .send().await.ok()?;
            let resp = resp.error_for_status().ok()?;
            Some(resp.bytes().await.ok()?.to_vec())
        }
    };

    // Try video first (og:video), then image (og:image)
    let (file_path_str, thumb_path_str, width, height, dominant_color, palette) = 'outer: {
        // ── Video branch ────────────────────────────────────────────────────────
        if let Some(ref vid_url) = video_url {
            if let Some(bytes) = fetch_bytes(vid_url).await {
                let ext = std::path::Path::new(vid_url.split('?').next().unwrap_or(vid_url))
                    .extension().and_then(|s| s.to_str()).filter(|s| !s.is_empty())
                    .unwrap_or("mp4").to_lowercase();
                let file_path = images_dir.join(format!("{}.{}", id, ext));
                if std::fs::write(&file_path, &bytes).is_ok() {
                    // Generate thumbnail via qlmanage (same path as regular video)
                    if let Ok(frame_bytes) = extract_video_frame(&file_path) {
                        if let Ok(img) = image::load_from_memory(&frame_bytes) {
                            let (w, h) = (img.width(), img.height());
                            let thumb_path = thumbs_dir.join(format!("{}.jpg", id));
                            if save_thumb(&img, &thumb_path).is_ok() {
                                let rgb = img.to_rgb8();
                                let colors = get_palette(rgb.as_raw(), ColorFormat::Rgb, 10, 5).ok();
                                let (dom, pal) = if let Some(ref cols) = colors {
                                    let hexes: Vec<String> = cols.iter().map(|c| format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)).collect();
                                    (hexes.first().cloned(), serde_json::to_string(&hexes).ok())
                                } else { (None, None) };
                                break 'outer (file_path.to_string_lossy().to_string(), thumb_path.to_string_lossy().to_string(), w, h, dom, pal);
                            }
                        }
                    }
                }
            }
        }

        // ── Image branch ────────────────────────────────────────────────────────
        if let Some(ref img_url) = image_url {
            if let Some(bytes) = fetch_bytes(img_url).await {
                if let Ok(img) = image::load_from_memory(&bytes) {
                    let (w, h) = (img.width(), img.height());
                    let ext = std::path::Path::new(img_url.split('?').next().unwrap_or(img_url))
                        .extension().and_then(|s| s.to_str()).filter(|s| !s.is_empty())
                        .unwrap_or("jpg").to_lowercase();
                    let file_path = images_dir.join(format!("{}.{}", id, ext));
                    if std::fs::write(&file_path, &bytes).is_ok() {
                        let thumb_path = thumbs_dir.join(format!("{}.jpg", id));
                        if save_thumb(&img, &thumb_path).is_ok() {
                            let rgb = img.to_rgb8();
                            let colors = get_palette(rgb.as_raw(), ColorFormat::Rgb, 10, 5).ok();
                            let (dom, pal) = if let Some(ref cols) = colors {
                                let hexes: Vec<String> = cols.iter().map(|c| format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)).collect();
                                (hexes.first().cloned(), serde_json::to_string(&hexes).ok())
                            } else { (None, None) };
                            break 'outer (file_path.to_string_lossy().to_string(), thumb_path.to_string_lossy().to_string(), w, h, dom, pal);
                        }
                    }
                }
            }
        }

        // ── No usable media — 1×1 placeholder ──────────────────────────────────
        let ph = images_dir.join(format!("{}.png", id));
        image::DynamicImage::new_rgb8(1, 1).save(&ph).ok();
        let s = ph.to_string_lossy().to_string();
        (s.clone(), s, 0, 0, None, None)
    };

    let post_meta = serde_json::json!({
        "platform": if is_tweet { "twitter" } else { "web" },
        "url": url,
        "title": title,
        "description": description,
        "siteName": site_name.or_else(|| Some(domain)),
        "imageUrl": image_url,
        "authorName": author_name,
    });

    Ok(SavedLink {
        id,
        file_path: file_path_str,
        thumb_path: thumb_path_str,
        width,
        height,
        dominant_color,
        palette,
        created_at: now,
        post_meta: serde_json::to_string(&post_meta).unwrap_or_default(),
    })
}

#[tauri::command]
fn trash_files(file_path: String, thumb_path: String) -> Result<(), String> {
    // trash the main file
    trash::delete(&file_path).map_err(|e| e.to_string())?;
    // only trash thumb if it's a different file (GIF/SVG use file_path == thumb_path)
    if thumb_path != file_path {
        let _ = trash::delete(&thumb_path);
    }
    Ok(())
}

#[tauri::command]
fn get_file_size(file_path: String) -> Result<u64, String> {
    std::fs::metadata(&file_path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
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
    Migration {
        version: 4,
        description: "add kind column",
        kind: MigrationKind::Up,
        sql: "ALTER TABLE images ADD COLUMN kind TEXT DEFAULT 'image';",
    },
    Migration {
        version: 5,
        description: "add deleted_at column",
        kind: MigrationKind::Up,
        sql: "ALTER TABLE images ADD COLUMN deleted_at INTEGER;",
    },
    Migration {
        version: 6,
        description: "add ocr_text column",
        kind: MigrationKind::Up,
        sql: "ALTER TABLE images ADD COLUMN ocr_text TEXT;",
    },
    Migration {
        version: 7,
        description: "add post_meta column",
        kind: MigrationKind::Up,
        sql: "ALTER TABLE images ADD COLUMN post_meta TEXT;",
    },
    Migration {
        version: 8,
        description: "add thumb_hash column",
        kind: MigrationKind::Up,
        sql: "ALTER TABLE images ADD COLUMN thumb_hash TEXT;",
    },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            SqlBuilder::new()
                .add_migrations("sqlite:keep.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            save_image_bytes,
            save_image_from_path,
            save_image_from_url,
            delete_image_files,
            reset_all_images,
            refresh_thumbnails,
            save_example_snapshot,
            load_example_snapshot,
            analyze_image,
            analyze_vision_item,
            generate_prompt,
            export_original,
            copy_image_to_clipboard,
            copy_files_to_clipboard,
            trash_files,
            save_link,
            get_file_size,
            backfill_thumb_hashes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
