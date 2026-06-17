import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

export interface Image {
  id: string;
  file_path: string;
  thumb_path: string;
  source_url: string | null;
  width: number;
  height: number;
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

      const saved = await invoke<{
        id: string;
        file_path: string;
        thumb_path: string;
        width: number;
        height: number;
        created_at: number;
      }>("save_image_bytes", { bytes, extension: ext });
      console.log("[mood] saved:", saved);

      const db = await getDb();
      await db.execute(
        `INSERT INTO images (id, file_path, thumb_path, width, height, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [
          saved.id,
          saved.file_path,
          saved.thumb_path,
          saved.width,
          saved.height,
          saved.created_at,
        ]
      );

      setImages((prev) => [{ ...saved, source_url: null }, ...prev]);
    } catch (err) {
      console.error("[mood] saveBlob failed:", err);
    }
  }, []);

  // paste listener
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      console.log("[mood] paste event fired");
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) saveBlob(blob);
          return;
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [saveBlob]);

  useEffect(() => {
    load();
  }, [load]);

  return { images, saveBlob, imgSrc: (path: string) => convertFileSrc(path) };
}
