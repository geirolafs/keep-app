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
  width: number;
  height: number;
  dominant_color: string | null;
  palette: string | null;
  created_at: number;
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
        `INSERT INTO images (id, file_path, thumb_path, width, height, dominant_color, palette, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          saved.id,
          saved.file_path,
          saved.thumb_path,
          saved.width,
          saved.height,
          saved.dominant_color,
          saved.palette,
          saved.created_at,
        ]
      );

      setImages((prev) => [
        { ...saved, source_url: null, title: null, notes: null },
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
        `INSERT INTO images (id, file_path, thumb_path, width, height, dominant_color, palette, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          saved.id,
          saved.file_path,
          saved.thumb_path,
          saved.width,
          saved.height,
          saved.dominant_color,
          saved.palette,
          saved.created_at,
        ]
      );

      setImages((prev) => [
        { ...saved, source_url: null, title: null, notes: null },
        ...prev,
      ]);
      toastManager.add({ title: "Image saved", type: "success", timeout: 2500 });
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
        `INSERT INTO images (id, file_path, thumb_path, source_url, width, height, dominant_color, palette, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
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
        ]
      );

      setImages((prev) => [
        { ...saved, source_url: url, title: null, notes: null },
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

  const resetAll = useCallback(async () => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM images", []);
      await invoke("reset_all_images");
      setImages([]);
    } catch (err) {
      console.error("[mood] resetAll failed:", err);
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
    resetAll,
    imgSrc: (path: string) => {
      if (path.startsWith("http://") || path.startsWith("https://")) {
        console.error("[mood] imgSrc received a raw http URL — file_path must be a local path:", path);
        return path;
      }
      return convertFileSrc(path);
    },
  };
}
