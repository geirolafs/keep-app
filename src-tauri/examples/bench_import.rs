// Import-pipeline throughput bench — replicates the per-image steps of
// process_and_save() in lib.rs (decode → 600px Lanczos3 thumb + JPEG q85 →
// color-thief palette → ThumbHash) on real library images, read-only.
//
//   cargo run --release --example bench_import -- <images_dir> [vision_binary]
//
// Writes nothing outside the system temp dir.

use base64::Engine as _;
use color_thief::{get_palette, ColorFormat};
use image::imageops::FilterType;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = args.get(1).expect("usage: bench_import <images_dir> [vision_binary]");
    let vision_bin = args.get(2);

    let stills: Vec<_> = std::fs::read_dir(dir)
        .expect("read_dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            matches!(
                p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref(),
                Some("jpg") | Some("jpeg") | Some("png") | Some("webp")
            )
        })
        .take(60)
        .collect();

    println!("benching {} stills from {}", stills.len(), dir);
    let (mut t_read, mut t_decode, mut t_thumb, mut t_palette, mut t_hash) =
        (0f64, 0f64, 0f64, 0f64, 0f64);
    let (mut n, mut mp_total, mut bytes_total) = (0u32, 0f64, 0u64);
    let tmp = std::env::temp_dir().join("keep_bench_thumb.jpg");

    for path in &stills {
        let t = Instant::now();
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        t_read += t.elapsed().as_secs_f64();

        let t = Instant::now();
        let img = match image::load_from_memory(&bytes) {
            Ok(i) => i,
            Err(_) => continue,
        };
        t_decode += t.elapsed().as_secs_f64();
        mp_total += (img.width() as f64 * img.height() as f64) / 1e6;
        bytes_total += bytes.len() as u64;

        // thumbnail: resize + JPEG q85 to disk (same as save_thumb)
        let t = Instant::now();
        let thumb = img.resize(600, 600, FilterType::Lanczos3);
        let file = std::fs::File::create(&tmp).unwrap();
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, 85);
        thumb.write_with_encoder(encoder).unwrap();
        t_thumb += t.elapsed().as_secs_f64();

        // palette (full-res pass, same as process_and_save)
        let t = Instant::now();
        let rgb = img.to_rgb8();
        let _ = get_palette(rgb.as_raw(), ColorFormat::Rgb, 10, 5).ok();
        t_palette += t.elapsed().as_secs_f64();

        // thumbhash
        let t = Instant::now();
        let small = img.resize(100, 100, FilterType::Triangle);
        let rgba = small.to_rgba8();
        let hash = thumbhash::rgba_to_thumb_hash(
            small.width() as usize,
            small.height() as usize,
            rgba.as_raw(),
        );
        let _ = base64::engine::general_purpose::STANDARD.encode(&hash);
        t_hash += t.elapsed().as_secs_f64();
        n += 1;
    }

    let per = |t: f64| t / n as f64 * 1000.0;
    println!("n={} avg {:.1}MP {:.0}KB/file", n, mp_total / n as f64, bytes_total / n as u64 / 1024);
    println!("read    {:>8.1} ms/img", per(t_read));
    println!("decode  {:>8.1} ms/img", per(t_decode));
    println!("thumb   {:>8.1} ms/img  (Lanczos3 600px + JPEG q85)", per(t_thumb));
    println!("palette {:>8.1} ms/img  (to_rgb8 + color-thief 10,5)", per(t_palette));
    println!("thumbhash {:>6.1} ms/img", per(t_hash));
    let total = per(t_read + t_decode + t_thumb + t_palette + t_hash);
    println!("TOTAL   {:>8.1} ms/img  = {:.1} img/s (excl. vision)", total, 1000.0 / total);

    if let Some(bin) = vision_bin {
        let mut t_vis = 0f64;
        let runs = 10;
        for _ in 0..runs {
            let t = Instant::now();
            let _ = std::process::Command::new(bin).arg(&tmp).output();
            t_vis += t.elapsed().as_secs_f64();
        }
        let v = t_vis / runs as f64 * 1000.0;
        println!("vision  {:>8.1} ms/img  (sidecar, {} runs)", v, runs);
        println!("TOTAL+vision {:.1} ms/img = {:.1} img/s", total + v, 1000.0 / (total + v));
    }
    let _ = std::fs::remove_file(&tmp);
}
