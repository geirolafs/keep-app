import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { toastManager } from "@/lib/toast";

export interface Image {
  id: string;
  file_path: string;
  thumb_path: string;
  source_url: string | null;
  title: string | null;
  notes: string | null;
  description: string | null;
  width: number;
  height: number;
  dominant_color: string | null;
  palette: string | null;
  created_at: number;
  kind: string;
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
}

async function getDb() {
  return Database.load("sqlite:mood.db");
}

export function useImages() {
  const [images, setImages] = useState<Image[]>([]);

  const load = useCallback(async () => {
    const db = await getDb();
    const rows = await db.select<Image[]>(
      "SELECT * FROM images ORDER BY created_at DESC"
    );
    setImages(rows);
  }, []);

  const saveBlob = useCallback(async (blob: Blob) => {
    try {
      console.log("[mood] paste detected", blob.type, blob.size);
      const ext = blob.type.split("/")[1] ?? "png";
      const buffer = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      console.log("[mood] invoking save_image_bytes, bytes:", bytes.length);

      const saved = await invoke<SavedImageResult>("save_image_bytes", {
        bytes,
        extension: ext,
      });
      console.log("[mood] saved:", saved);

      const db = await getDb();
      await db.execute(
        `INSERT INTO images (id, file_path, thumb_path, width, height, dominant_color, palette, created_at, updated_at, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
        [
          saved.id,
          saved.file_path,
          saved.thumb_path,
          saved.width,
          saved.height,
          saved.dominant_color,
          saved.palette,
          saved.created_at,
          saved.kind,
        ]
      );

      setImages((prev) => [
        { ...saved, source_url: null, title: null, notes: null, description: null },
        ...prev,
      ]);
      toastManager.add({ title: "Image saved", type: "success", timeout: 2500 });
    } catch (err) {
      console.error("[mood] saveBlob failed:", err);
      toastManager.add({ title: "Failed to save image", type: "error" });
    }
  }, []);

  const savePath = useCallback(async (path: string) => {
    try {
      console.log("[mood] savePath:", path);
      const saved = await invoke<SavedImageResult>("save_image_from_path", {
        path,
      });
      console.log("[mood] savePath saved:", saved);

      const db = await getDb();
      await db.execute(
        `INSERT INTO images (id, file_path, thumb_path, width, height, dominant_color, palette, created_at, updated_at, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
        [
          saved.id,
          saved.file_path,
          saved.thumb_path,
          saved.width,
          saved.height,
          saved.dominant_color,
          saved.palette,
          saved.created_at,
          saved.kind,
        ]
      );

      setImages((prev) => [
        { ...saved, source_url: null, title: null, notes: null, description: null },
        ...prev,
      ]);
      toastManager.add({ title: saved.kind === "video" ? "Video saved" : "Image saved", type: "success", timeout: 2500 });
    } catch (err) {
      console.error("[mood] savePath failed:", err);
      toastManager.add({ title: "Failed to save image", type: "error" });
    }
  }, []);

  const saveUrl = useCallback(async (url: string) => {
    try {
      console.log("[mood] saveUrl:", url);
      const saved = await invoke<SavedImageResult>("save_image_from_url", {
        url,
      });
      console.log("[mood] saveUrl saved:", saved);

      const db = await getDb();
      await db.execute(
        `INSERT INTO images (id, file_path, thumb_path, source_url, width, height, dominant_color, palette, created_at, updated_at, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)`,
        [
          saved.id,
          saved.file_path,
          saved.thumb_path,
          url,
          saved.width,
          saved.height,
          saved.dominant_color,
          saved.palette,
          saved.created_at,
          saved.kind,
        ]
      );

      setImages((prev) => [
        { ...saved, source_url: url, title: null, notes: null, description: null },
        ...prev,
      ]);
      toastManager.add({ title: "Image saved", type: "success", timeout: 2500 });
    } catch (err) {
      console.error("[mood] saveUrl failed:", err);
      toastManager.add({ title: "Failed to save image", type: "error" });
    }
  }, []);

  const deleteImage = useCallback(async (id: string, filePath: string, thumbPath: string) => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM images WHERE id = $1", [id]);
      await invoke("delete_image_files", { filePath, thumbPath });
      setImages((prev) => prev.filter((img) => img.id !== id));
      toastManager.add({ title: "Image deleted", type: "default", timeout: 2500 });
    } catch (err) {
      console.error("[mood] deleteImage failed:", err);
      toastManager.add({ title: "Failed to delete image", type: "error" });
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
      console.error("[mood] updateTitle failed:", err);
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
      console.error("[mood] updateNotes failed:", err);
      toastManager.add({ title: "Failed to save note", type: "error" });
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
      console.error("[mood] updateDescription failed:", err);
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
      console.error("[mood] resetAll failed:", err);
    }
  }, []);

  const saveExample = useCallback(async (n: number) => {
    try {
      const db = await getDb();
      const imgs = await db.select<(Image & { updated_at: number })[]>("SELECT * FROM images");
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
        })),
        tags,
        image_tags: imageTags,
        collections,
        collection_images: collectionImages,
      };

      await invoke("save_example_snapshot", { n, snapshotJson: JSON.stringify(snapshot) });
      toastManager.add({ title: `Example ${n} saved (${imgs.length} images)`, type: "success", timeout: 3000 });
    } catch (err) {
      console.error("[mood] saveExample failed:", err);
      toastManager.add({ title: "Failed to save example", type: "error" });
    }
  }, []);

  const loadExample = useCallback(async (n: number) => {
    try {
      const result = await invoke<{ data_dir: string; snapshot_json: string }>("load_example_snapshot", { n });
      const snapshot = JSON.parse(result.snapshot_json) as {
        images: Array<{ id: string; file_name: string; thumb_name: string; source_url: string | null; title: string | null; notes: string | null; description: string | null; dominant_color: string | null; palette: string | null; width: number; height: number; created_at: number; updated_at: number; kind?: string }>;
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
          `INSERT INTO images (id, file_path, thumb_path, source_url, title, notes, description, dominant_color, palette, width, height, created_at, updated_at, kind)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [img.id, `${result.data_dir}/images/${img.file_name}`, `${result.data_dir}/${img.thumb_name === img.file_name ? "images" : "thumbs"}/${img.thumb_name}`,
           img.source_url, img.title, img.notes, img.description ?? null, img.dominant_color, img.palette,
           img.width, img.height, img.created_at, img.updated_at, img.kind ?? "image"]
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
      console.error("[mood] loadExample failed:", err);
      toastManager.add({ title: String(err), type: "error" });
    }
  }, []);

  // paste listener
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      console.log("[mood] paste event fired");
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
              saveUrl(trimmed);
            }
          });
          return;
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [saveBlob, saveUrl]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    images,
    saveBlob,
    savePath,
    saveUrl,
    deleteImage,
    updateTitle,
    updateNotes,
    updateDescription,
    resetAll,
    saveExample,
    loadExample,
    imgSrc: (path: string) => {
      if (path.startsWith("http://") || path.startsWith("https://")) {
        console.error("[mood] imgSrc received a raw http URL — file_path must be a local path:", path);
        return path;
      }
      return convertFileSrc(path);
    },
  };
}
