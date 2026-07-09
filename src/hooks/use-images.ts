import { createContext, createElement, use, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Database from "@tauri-apps/plugin-sql";
import { toast } from "@/lib/toast";
import { sendNotification } from "@tauri-apps/plugin-notification";

export type PendingItem = { id: string; label: string }

export interface Image {
  id: string;
  file_path: string;
  thumb_path: string;
  source_url: string | null;
  title: string | null;
  notes: string | null;
  description: string | null;
  ocr_text: string | null;
  width: number;
  height: number;
  dominant_color: string | null;
  palette: string | null;
  created_at: number;
  kind: string;
  deleted_at: number | null;
  post_meta: string | null;
  thumb_hash: string | null;
}

interface SavedImageResult {
  id: string;
  file_path: string;
  thumb_path: string;
  width: number;
  height: number;
  dominant_color: string | null;
  palette: string | null;
  created_at: number;
  kind: string;
  vision_tags: string[];
  ocr_text: string;
  thumb_hash: string | null;
}

interface SavedLinkResult {
  id: string;
  file_path: string;
  thumb_path: string;
  width: number;
  height: number;
  dominant_color: string | null;
  palette: string | null;
  created_at: number;
  post_meta: string;
}

async function insertVisionData(db: Awaited<ReturnType<typeof getDb>>, imageId: string, visionTags: string[], ocrText: string) {
  for (const tagName of visionTags) {
    const normalized = tagName.trim().toLowerCase();
    if (!normalized) continue;
    await db.execute("INSERT OR IGNORE INTO tags (id, name) VALUES ($1, $2)", [crypto.randomUUID(), normalized]);
    const rows = await db.select<{ id: string }[]>("SELECT id FROM tags WHERE name = $1", [normalized]);
    if (rows[0]) {
      await db.execute("INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES ($1, $2)", [imageId, rows[0].id]);
    }
  }
  // Always set (even "") so ocr_text IS NULL means "never processed"
  await db.execute("UPDATE images SET ocr_text = $1 WHERE id = $2", [ocrText, imageId]);
}

export async function backfillVision(
  images: Pick<Image, "id" | "thumb_path" | "kind" | "ocr_text">[],
  onProgress?: (done: number, total: number) => void,
  cancelRef?: { current: boolean },
) {
  const eligible = images.filter((img) => img.ocr_text === null && img.kind !== "video");
  if (eligible.length === 0) return 0;
  const db = await getDb();
  for (let i = 0; i < eligible.length; i++) {
    if (cancelRef?.current) break;
    onProgress?.(i, eligible.length);
    const img = eligible[i];
    try {
      const result = await invoke<{ tags: string[]; ocr_text: string }>("analyze_vision_item", { thumbPath: img.thumb_path });
      await insertVisionData(db, img.id, result.tags, result.ocr_text);
    } catch {
      // mark as processed even on error so we don't retry forever
      await db.execute("UPDATE images SET ocr_text = $1 WHERE id = $2", ["", img.id]);
    }
  }
  onProgress?.(eligible.length, eligible.length);
  return eligible.length;
}

async function getDb() {
  return Database.load("sqlite:keep.db");
}

type Db = Awaited<ReturnType<typeof getDb>>;

// Shared by in-app save paths and the external-save listener (inbox watcher,
// clipboard capture). INSERT OR IGNORE + `inserted` keeps replayed events
// idempotent while letting fresh saves detect a silently-failed insert.
async function insertSavedImage(db: Db, saved: SavedImageResult, sourceUrl: string | null, title: string | null): Promise<{ row: Image; inserted: boolean }> {
  const res = await db.execute(
    `INSERT OR IGNORE INTO images (id, file_path, thumb_path, source_url, title, width, height, dominant_color, palette, created_at, updated_at, kind, thumb_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12)`,
    [saved.id, saved.file_path, saved.thumb_path, sourceUrl, title, saved.width, saved.height, saved.dominant_color, saved.palette, saved.created_at, saved.kind, saved.thumb_hash ?? null]
  );
  const inserted = res.rowsAffected > 0;
  if (inserted) await insertVisionData(db, saved.id, saved.vision_tags, saved.ocr_text);
  const row: Image = { ...saved, source_url: sourceUrl, title, notes: null, description: null, ocr_text: saved.ocr_text || null, deleted_at: null, post_meta: null, thumb_hash: saved.thumb_hash ?? null };
  return { row, inserted };
}

async function insertSavedLink(db: Db, saved: SavedLinkResult, url: string): Promise<{ row: Image; inserted: boolean }> {
  const res = await db.execute(
    `INSERT OR IGNORE INTO images (id, file_path, thumb_path, source_url, width, height, dominant_color, palette, created_at, updated_at, kind, post_meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 'link', $10)`,
    [saved.id, saved.file_path, saved.thumb_path, url, saved.width, saved.height, saved.dominant_color, saved.palette, saved.created_at, saved.post_meta]
  );
  let title: string | null = null;
  try { title = JSON.parse(saved.post_meta)?.title ?? null; } catch {}
  const row: Image = { ...saved, source_url: url, title, notes: null, description: null, ocr_text: null, deleted_at: null, kind: "link", post_meta: saved.post_meta, thumb_hash: null };
  return { row, inserted: res.rowsAffected > 0 };
}

interface ExternalSavePayload {
  capture: "image" | "screenshot" | "link";
  saved: SavedImageResult | SavedLinkResult;
  source_url: string | null;
  title: string | null;
}

export async function devResetAll() {
  try {
    const db = await getDb();
    await db.execute("DELETE FROM collection_images");
    await db.execute("DELETE FROM image_tags");
    await db.execute("DELETE FROM images");
    await db.execute("DELETE FROM collections");
    await db.execute("DELETE FROM tags");
    await invoke("reset_all_images");
    window.location.reload();
  } catch (err) {
    console.error("[keep] resetAll failed:", err);
  }
}

export async function devSaveExample(n: number) {
  try {
    const db = await getDb();
    const imgs = await db.select<(Image & { updated_at: number })[]>("SELECT * FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC");
    const tags = await db.select<{ id: string; name: string }[]>("SELECT * FROM tags");
    const imageTags = await db.select<{ image_id: string; tag_id: string }[]>("SELECT * FROM image_tags");
    const collections = await db.select<{ id: string; name: string }[]>("SELECT * FROM collections");
    const collectionImages = await db.select<{ collection_id: string; image_id: string }[]>("SELECT * FROM collection_images");
    const snapshot = {
      images: imgs.map((img) => ({
        id: img.id, file_name: img.file_path.split("/").pop()!, thumb_name: img.thumb_path.split("/").pop()!,
        source_url: img.source_url, title: img.title, notes: img.notes, description: img.description,
        dominant_color: img.dominant_color, palette: img.palette, width: img.width, height: img.height,
        created_at: img.created_at, updated_at: (img as Image & { updated_at: number }).updated_at ?? img.created_at,
        kind: img.kind ?? "image", post_meta: img.post_meta ?? null,
      })),
      tags, image_tags: imageTags, collections, collection_images: collectionImages,
    };
    await invoke("save_example_snapshot", { n, snapshotJson: JSON.stringify(snapshot) });
  } catch (err) {
    console.error("[keep] saveExample failed:", err);
    toast.error("Failed to save example");
  }
}

export async function devLoadExample(n: number) {
  try {
    const result = await invoke<{ data_dir: string; snapshot_json: string }>("load_example_snapshot", { n });
    const snapshot = JSON.parse(result.snapshot_json) as {
      images: Array<{ id: string; file_name: string; thumb_name: string; source_url: string | null; title: string | null; notes: string | null; description: string | null; dominant_color: string | null; palette: string | null; width: number; height: number; created_at: number; updated_at: number; kind?: string; post_meta?: string | null }>;
      tags: Array<{ id: string; name: string }>; image_tags: Array<{ image_id: string; tag_id: string }>;
      collections: Array<{ id: string; name: string }>; collection_images: Array<{ collection_id: string; image_id: string }>;
    };
    const db = await getDb();
    await db.execute("DELETE FROM collection_images");
    await db.execute("DELETE FROM image_tags");
    await db.execute("DELETE FROM images");
    await db.execute("DELETE FROM tags");
    await db.execute("DELETE FROM collections");
    for (const img of snapshot.images) {
      await db.execute(
        `INSERT INTO images (id, file_path, thumb_path, source_url, title, notes, description, dominant_color, palette, width, height, created_at, updated_at, kind, post_meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [img.id, `${result.data_dir}/images/${img.file_name}`, `${result.data_dir}/${img.thumb_name === img.file_name ? "images" : "thumbs"}/${img.thumb_name}`,
         img.source_url, img.title, img.notes, img.description ?? null, img.dominant_color, img.palette,
         img.width, img.height, img.created_at, img.updated_at, img.kind ?? "image", img.post_meta ?? null]
      );
    }
    for (const tag of snapshot.tags) await db.execute("INSERT INTO tags (id, name) VALUES ($1, $2)", [tag.id, tag.name]);
    for (const it of snapshot.image_tags) await db.execute("INSERT INTO image_tags (image_id, tag_id) VALUES ($1, $2)", [it.image_id, it.tag_id]);
    for (const col of snapshot.collections) await db.execute("INSERT INTO collections (id, name) VALUES ($1, $2)", [col.id, col.name]);
    for (const ci of snapshot.collection_images) await db.execute("INSERT INTO collection_images (collection_id, image_id) VALUES ($1, $2)", [ci.collection_id, ci.image_id]);
    window.location.reload();
  } catch (err) {
    console.error("[keep] loadExample failed:", err);
    toast.error(String(err));
  }
}

export async function refreshThumbnails(
  onProgress?: (done: number, total: number) => void
) {
  try {
    const db = await getDb();
    const all = await db.select<{ file_path: string; thumb_path: string; kind: string }[]>(
      "SELECT file_path, thumb_path, kind FROM images"
    );
    const eligible = all.filter((i) => i.kind !== "video" && i.thumb_path !== i.file_path);
    let count = 0;
    for (let i = 0; i < eligible.length; i++) {
      onProgress?.(i, eligible.length);
      const n = await invoke<number>("refresh_thumbnails", { items: [eligible[i]] });
      count += n;
    }
    onProgress?.(eligible.length, eligible.length);
    try { sendNotification({ title: "KEEP", body: `Refreshed ${count} thumbnails` }); } catch {}
    window.location.reload();
  } catch (err) {
    console.error("[keep] refreshThumbnails failed:", err);
    toast.error(String(err));
  }
}

function useImagesState() {
  const [images, setImages] = useState<Image[]>([]);
  const [binImages, setBinImages] = useState<Image[]>([]);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);

  const addPending = (label: string): string => {
    const id = crypto.randomUUID();
    setPendingItems((prev) => [{ id, label }, ...prev]);
    return id;
  };
  const removePending = (id: string) => {
    setPendingItems((prev) => prev.filter((p) => p.id !== id));
  };

  const load = useCallback(async () => {
    const db = await getDb();
    const now = Date.now();
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    // Auto-purge items deleted >90 days ago
    const stale = await db.select<Image[]>(
      "SELECT * FROM images WHERE deleted_at IS NOT NULL AND deleted_at < $1",
      [ninetyDaysAgo]
    );
    for (const img of stale) {
      await invoke("delete_image_files", { filePath: img.file_path, thumbPath: img.thumb_path }).catch(() => {});
      await db.execute("DELETE FROM image_tags WHERE image_id = $1", [img.id]);
      await db.execute("DELETE FROM collection_images WHERE image_id = $1", [img.id]);
      await db.execute("DELETE FROM images WHERE id = $1", [img.id]);
    }

    const rows = await db.select<Image[]>(
      "SELECT * FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC"
    );
    setImages(rows);

    const binRows = await db.select<Image[]>(
      "SELECT * FROM images WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
    );
    setBinImages(binRows);

    // Backfill ThumbHash for images saved before this feature was added.
    // Runs silently in background; updates DB + state as results arrive.
    const missing = rows.filter((r) => r.thumb_hash === null && r.kind !== "video" && r.file_path !== r.thumb_path);
    if (missing.length > 0) {
      (async () => {
        const BATCH = 20;
        for (let i = 0; i < missing.length; i += BATCH) {
          const batch = missing.slice(i, i + BATCH).map((r) => ({ id: r.id, thumbPath: r.thumb_path }));
          try {
            const results = await invoke<{ id: string; thumb_hash: string }[]>("backfill_thumb_hashes", { items: batch.map(b => ({ id: b.id, thumb_path: b.thumbPath })) });
            if (results.length > 0) {
              await Promise.all(results.map((r) =>
                db.execute("UPDATE images SET thumb_hash = $1 WHERE id = $2", [r.thumb_hash, r.id])
              ));
              setImages((prev) => prev.map((img) => {
                const hit = results.find((r) => r.id === img.id);
                return hit ? { ...img, thumb_hash: hit.thumb_hash } : img;
              }));
            }
          } catch {
            break;
          }
        }
      })();
    }
  }, []);

  const saveBlob = useCallback(async (blob: Blob) => {
    const tempId = addPending("Saving image…");
    try {
      console.log("[keep] paste detected", blob.type, blob.size);
      const ext = blob.type.split("/")[1] ?? "png";
      const buffer = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      console.log("[keep] invoking save_image_bytes, bytes:", bytes.length);

      const saved = await invoke<SavedImageResult>("save_image_bytes", {
        bytes,
        extension: ext,
      });
      console.log("[keep] saved:", saved);

      const db = await getDb();
      const { row, inserted } = await insertSavedImage(db, saved, null, null);
      if (!inserted) throw new Error("database insert was ignored");
      setImages((prev) => [row, ...prev]);
    } catch (err) {
      console.error("[keep] saveBlob failed:", err);
      toast.error("Failed to save image");
    } finally {
      removePending(tempId);
    }
  }, []);

  const savePath = useCallback(async (path: string) => {
    const label = path.split("/").pop() ?? "Saving…";
    const tempId = addPending(label);
    try {
      console.log("[keep] savePath:", path);
      const saved = await invoke<SavedImageResult>("save_image_from_path", {
        path,
      });
      console.log("[keep] savePath saved:", saved);

      const db = await getDb();
      const { row, inserted } = await insertSavedImage(db, saved, null, null);
      if (!inserted) throw new Error("database insert was ignored");
      setImages((prev) => [row, ...prev]);
    } catch (err) {
      console.error("[keep] savePath failed:", err);
      toast.error("Failed to save image");
    } finally {
      removePending(tempId);
    }
  }, []);

  const saveUrl = useCallback(async (url: string) => {
    const label = url.length > 60 ? url.slice(0, 60) + "…" : url;
    const tempId = addPending(label);
    try {
      console.log("[keep] saveUrl:", url);
      const saved = await invoke<SavedImageResult>("save_image_from_url", {
        url,
      });
      console.log("[keep] saveUrl saved:", saved);

      const db = await getDb();
      const { row, inserted } = await insertSavedImage(db, saved, url, null);
      if (!inserted) throw new Error("database insert was ignored");
      setImages((prev) => [row, ...prev]);
    } catch (err) {
      console.error("[keep] saveUrl failed:", err);
      toast.error("Failed to save image");
    } finally {
      removePending(tempId);
    }
  }, []);

  const saveLink = useCallback(async (url: string) => {
    const label = url.length > 60 ? url.slice(0, 60) + "…" : url;
    const tempId = addPending(label);
    try {
      const saved = await invoke<SavedLinkResult>("save_link", { url });
      const db = await getDb();
      const { row, inserted } = await insertSavedLink(db, saved, url);
      if (!inserted) throw new Error("database insert was ignored");
      setImages((prev) => [row, ...prev]);
    } catch (err) {
      console.error("[keep] saveLink failed:", err);
      const msg = typeof err === "string" ? err : "Failed to save link";
      toast.error(msg);
    } finally {
      removePending(tempId);
    }
  }, []);

  const softDelete = useCallback(async (id: string) => {
    try {
      const db = await getDb();
      const now = Date.now();
      await db.execute("UPDATE images SET deleted_at = $1 WHERE id = $2", [now, id]);
      let moved: Image | undefined;
      setImages((prev) => {
        moved = prev.find((i) => i.id === id);
        return prev.filter((i) => i.id !== id);
      });
      if (moved) {
        setBinImages((prev) => [{ ...moved!, deleted_at: now }, ...prev]);
      }
    } catch (err) {
      console.error("[keep] softDelete failed:", err);
      toast.error("Failed to delete image");
    }
  }, []);

  const restoreImage = useCallback(async (id: string) => {
    try {
      const db = await getDb();
      await db.execute("UPDATE images SET deleted_at = NULL WHERE id = $1", [id]);
      let restored: Image | undefined;
      setBinImages((prev) => {
        restored = prev.find((i) => i.id === id);
        return prev.filter((i) => i.id !== id);
      });
      if (restored) {
        setImages((prev) => [{ ...restored!, deleted_at: null }, ...prev].sort((a, b) => b.created_at - a.created_at));
      }
    } catch (err) {
      console.error("[keep] restoreImage failed:", err);
      toast.error("Failed to restore");
    }
  }, []);

  const permanentDelete = useCallback(async (id: string, filePath: string, thumbPath: string) => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM image_tags WHERE image_id = $1", [id]);
      await db.execute("DELETE FROM collection_images WHERE image_id = $1", [id]);
      await db.execute("DELETE FROM images WHERE id = $1", [id]);
      await invoke("delete_image_files", { filePath, thumbPath }).catch(() => {});
      setBinImages((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error("[keep] permanentDelete failed:", err);
      toast.error("Failed to delete");
    }
  }, []);

  const emptyBin = useCallback(async () => {
    try {
      const db = await getDb();
      const bin = await db.select<Image[]>("SELECT * FROM images WHERE deleted_at IS NOT NULL");
      for (const img of bin) {
        await invoke("delete_image_files", { filePath: img.file_path, thumbPath: img.thumb_path }).catch(() => {});
        await db.execute("DELETE FROM image_tags WHERE image_id = $1", [img.id]);
        await db.execute("DELETE FROM collection_images WHERE image_id = $1", [img.id]);
        await db.execute("DELETE FROM images WHERE id = $1", [img.id]);
      }
      setBinImages([]);
    } catch (err) {
      console.error("[keep] emptyBin failed:", err);
      toast.error("Failed to empty bin");
    }
  }, []);

  const updateTitle = useCallback(async (id: string, title: string) => {
    try {
      const db = await getDb();
      const now = Date.now();
      await db.execute(
        "UPDATE images SET title = $1, updated_at = $2 WHERE id = $3",
        [title, now, id]
      );
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, title } : img))
      );
    } catch (err) {
      console.error("[keep] updateTitle failed:", err);
    }
  }, []);

  const updateNotes = useCallback(async (id: string, notes: string) => {
    try {
      const db = await getDb();
      const now = Date.now();
      await db.execute(
        "UPDATE images SET notes = $1, updated_at = $2 WHERE id = $3",
        [notes || null, now, id]
      );
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, notes: notes || null } : img))
      );
    } catch (err) {
      console.error("[keep] updateNotes failed:", err);
      toast.error("Failed to save note");
    }
  }, []);

  const updateDescription = useCallback(async (id: string, description: string) => {
    try {
      const db = await getDb();
      const now = Date.now();
      await db.execute(
        "UPDATE images SET description = $1, updated_at = $2 WHERE id = $3",
        [description || null, now, id]
      );
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, description: description || null } : img))
      );
    } catch (err) {
      console.error("[keep] updateDescription failed:", err);
    }
  }, []);

  const resetAll = useCallback(async () => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM collection_images");
      await db.execute("DELETE FROM image_tags");
      await db.execute("DELETE FROM images");
      await db.execute("DELETE FROM collections");
      await db.execute("DELETE FROM tags");
      await invoke("reset_all_images");
      window.location.reload();
    } catch (err) {
      console.error("[keep] resetAll failed:", err);
    }
  }, []);

  const saveExample = useCallback(async (n: number) => {
    try {
      const db = await getDb();
      const imgs = await db.select<(Image & { updated_at: number })[]>("SELECT * FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC");
      const tags = await db.select<{ id: string; name: string }[]>("SELECT * FROM tags");
      const imageTags = await db.select<{ image_id: string; tag_id: string }[]>("SELECT * FROM image_tags");
      const collections = await db.select<{ id: string; name: string }[]>("SELECT * FROM collections");
      const collectionImages = await db.select<{ collection_id: string; image_id: string }[]>("SELECT * FROM collection_images");

      const snapshot = {
        images: imgs.map((img) => ({
          id: img.id,
          file_name: img.file_path.split("/").pop()!,
          thumb_name: img.thumb_path.split("/").pop()!,
          source_url: img.source_url,
          title: img.title,
          notes: img.notes,
          description: img.description,
          dominant_color: img.dominant_color,
          palette: img.palette,
          width: img.width,
          height: img.height,
          created_at: img.created_at,
          updated_at: img.updated_at ?? img.created_at,
          kind: img.kind ?? "image",
          post_meta: img.post_meta ?? null,
        })),
        tags,
        image_tags: imageTags,
        collections,
        collection_images: collectionImages,
      };

      await invoke("save_example_snapshot", { n, snapshotJson: JSON.stringify(snapshot) });
    } catch (err) {
      console.error("[keep] saveExample failed:", err);
      toast.error("Failed to save example");
    }
  }, []);

  const loadExample = useCallback(async (n: number) => {
    try {
      const result = await invoke<{ data_dir: string; snapshot_json: string }>("load_example_snapshot", { n });
      const snapshot = JSON.parse(result.snapshot_json) as {
        images: Array<{ id: string; file_name: string; thumb_name: string; source_url: string | null; title: string | null; notes: string | null; description: string | null; dominant_color: string | null; palette: string | null; width: number; height: number; created_at: number; updated_at: number; kind?: string; post_meta?: string | null }>;
        tags: Array<{ id: string; name: string }>;
        image_tags: Array<{ image_id: string; tag_id: string }>;
        collections: Array<{ id: string; name: string }>;
        collection_images: Array<{ collection_id: string; image_id: string }>;
      };

      const db = await getDb();
      await db.execute("DELETE FROM collection_images");
      await db.execute("DELETE FROM image_tags");
      await db.execute("DELETE FROM images");
      await db.execute("DELETE FROM tags");
      await db.execute("DELETE FROM collections");

      for (const img of snapshot.images) {
        await db.execute(
          `INSERT INTO images (id, file_path, thumb_path, source_url, title, notes, description, dominant_color, palette, width, height, created_at, updated_at, kind, post_meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [img.id, `${result.data_dir}/images/${img.file_name}`, `${result.data_dir}/${img.thumb_name === img.file_name ? "images" : "thumbs"}/${img.thumb_name}`,
           img.source_url, img.title, img.notes, img.description ?? null, img.dominant_color, img.palette,
           img.width, img.height, img.created_at, img.updated_at, img.kind ?? "image", img.post_meta ?? null]
        );
      }
      for (const tag of snapshot.tags) {
        await db.execute("INSERT INTO tags (id, name) VALUES ($1, $2)", [tag.id, tag.name]);
      }
      for (const it of snapshot.image_tags) {
        await db.execute("INSERT INTO image_tags (image_id, tag_id) VALUES ($1, $2)", [it.image_id, it.tag_id]);
      }
      for (const col of snapshot.collections) {
        await db.execute("INSERT INTO collections (id, name) VALUES ($1, $2)", [col.id, col.name]);
      }
      for (const ci of snapshot.collection_images) {
        await db.execute("INSERT INTO collection_images (collection_id, image_id) VALUES ($1, $2)", [ci.collection_id, ci.image_id]);
      }

      window.location.reload();
    } catch (err) {
      console.error("[keep] loadExample failed:", err);
      toast.error(String(err));
    }
  }, []);

  // paste listener
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      console.log("[keep] paste event fired");
      const items = e.clipboardData?.items;
      if (!items) return;

      // check for image blobs first
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) saveBlob(blob);
          return;
        }
      }

      // check for URL text
      for (const item of Array.from(items)) {
        if (item.type === "text/plain") {
          item.getAsString((text) => {
            const trimmed = text.trim();
            if (trimmed.startsWith("http")) {
              const isImageUrl = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|jxl|heic|heif)(\?.*)?$/i.test(trimmed);
              if (isImageUrl) saveUrl(trimmed);
              else saveLink(trimmed);
            }
          });
          return;
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [saveBlob, saveUrl, saveLink]);

  // external saves — Rust inbox watcher / clipboard capture emit "external-save".
  // Order matters: load first (so prepends can't be clobbered by load's setImages),
  // then register the listener, then tell Rust it may start ingesting. Each event
  // is acked (inbox_ack) once the row is in SQLite — only then does the inbox
  // delete its source files; un-acked emits are replayed (INSERT OR IGNORE dedups).
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    (async () => {
      await load();
      try {
        const un = await listen<ExternalSavePayload>("external-save", async (e) => {
          const { capture, saved, source_url, title } = e.payload;
          try {
            const db = await getDb();
            const { row, inserted } = capture === "link"
              ? await insertSavedLink(db, saved as SavedLinkResult, source_url ?? "")
              : await insertSavedImage(db, saved as SavedImageResult, source_url, title);
            invoke("inbox_ack", { id: row.id }).catch(() => {});
            if (!inserted) return; // replayed event — row already there
            setImages((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev]));
          } catch (err) {
            console.error("[keep] external-save failed:", err);
            // keyed by save id — replays of the same failed emit update one toast
            toast.error("Failed to save captured item", { id: `external-save-${saved.id}` });
          }
        });
        if (!mounted) {
          un();
          return;
        }
        unlisten = un;
        await invoke("set_frontend_ready");
      } catch {
        // browser preview mode — no Tauri event system
      }
    })();
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [load]);

  return {
    images,
    binImages,
    pendingItems,
    saveBlob,
    savePath,
    saveUrl,
    saveLink,
    softDelete,
    restoreImage,
    permanentDelete,
    emptyBin,
    updateTitle,
    updateNotes,
    updateDescription,
    resetAll,
    saveExample,
    loadExample,
    imgSrc: (path: string) => {
      if (path.startsWith("http://") || path.startsWith("https://")) {
        console.error("[keep] imgSrc received a raw http URL — file_path must be a local path:", path);
        return path;
      }
      return convertFileSrc(path);
    },
  };
}

type ImagesState = ReturnType<typeof useImagesState>;
const ImagesContext = createContext<ImagesState | null>(null);

export function ImagesProvider({ children }: { children: ReactNode }) {
  const value = useImagesState();
  return createElement(ImagesContext.Provider, { value }, children);
}

export function useImages(): ImagesState {
  const ctx = use(ImagesContext);
  if (!ctx) throw new Error("useImages must be used inside <ImagesProvider>");
  return ctx;
}
