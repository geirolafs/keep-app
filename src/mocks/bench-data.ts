// Deterministic synthetic library generator for perf benchmarks.
// Activated in browser preview mode via VITE_MOCK_COUNT=<n> (see tauri-sql.ts).
// Pure function of n — same rows every run, no Date.now()/Math.random().

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const WORDS =
  "sculpture study campaign packaging typography poster brutalist grid layout editorial spread magazine cover chair lamp ceramic glass steel walnut oak concrete render moodboard palette gradient neon pastel monochrome duotone portrait landscape interior facade stairwell atrium signage wayfinding logotype monogram letterpress risograph screenprint halftone texture grain film polaroid archive vintage modernist bauhaus swiss japanese scandinavian minimal maximal collage montage illustration lineart woodcut etching botanical specimen diagram blueprint isometric axonometric perspective wireframe prototype dashboard app icon glyph serif sans mono condensed extended italic ligature kerning baseline margin gutter bleed crop".split(
    " ",
  );

const TAG_COUNT = 200;
const URL_POOL_SIZE = 64;
const T0 = 1750000000000;

const pick = (rand: () => number, arr: string[]) => arr[Math.floor(rand() * arr.length)];
const sentence = (rand: () => number, n: number) =>
  Array.from({ length: n }, () => pick(rand, WORDS)).join(" ");

export function genBenchData(n: number) {
  const rand = mulberry32(42);

  // 64 distinct picsum URLs reused across all rows → browser caches, network stays small
  const pool = Array.from({ length: URL_POOL_SIZE }, (_, i) => {
    const w = 300 + Math.floor(rand() * 60) * 10; // 300–890
    const h = 250 + Math.floor(rand() * 80) * 10; // 250–1040
    return { url: `https://picsum.photos/seed/bench${i}/${w}/${h}`, w, h };
  });

  const tags = Array.from({ length: TAG_COUNT }, (_, i) => ({
    id: `bt${i}`,
    name: `${pick(rand, WORDS)}-${i}`,
  }));

  const images = [];
  const imageTags = [];
  for (let i = 0; i < n; i++) {
    const p = pool[i % URL_POOL_SIZE];
    const hex = () =>
      `#${Math.floor(rand() * 0xffffff)
        .toString(16)
        .padStart(6, "0")}`;
    const palette = JSON.stringify(Array.from({ length: 5 }, hex));
    images.push({
      id: `b${String(i).padStart(6, "0")}`,
      file_path: p.url,
      thumb_path: p.url,
      source_url: rand() < 0.3 ? `https://example.com/${pick(rand, WORDS)}/${i}` : null,
      title: rand() < 0.8 ? sentence(rand, 2 + Math.floor(rand() * 3)) : null,
      notes: null,
      description: rand() < 0.6 ? sentence(rand, 20 + Math.floor(rand() * 25)) : null,
      ocr_text: rand() < 0.4 ? sentence(rand, 10 + Math.floor(rand() * 60)) : null,
      width: p.w * 2,
      height: p.h * 2,
      dominant_color: hex(),
      palette,
      created_at: T0 - i * 1000,
    });
    const nTags = Math.floor(rand() * 6); // 0–5
    const used = new Set<number>();
    for (let t = 0; t < nTags; t++) {
      const ti = Math.floor(rand() * TAG_COUNT);
      if (used.has(ti)) continue;
      used.add(ti);
      imageTags.push({ image_id: images[i].id, id: tags[ti].id, name: tags[ti].name });
    }
  }
  return { images, tags, imageTags };
}
