import { createContext, createElement, use, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { Image } from "./use-images";
import { toastManager } from "@/lib/toast";

export interface Collection {
  id: string;
  name: string;
}

async function getDb() {
  return Database.load("sqlite:keep.db");
}

// ── internal state logic ───────────────────────────────────────────────────

function useCollectionsState() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [imageCollectionsMap, setImageCollectionsMap] = useState<Map<string, Collection[]>>(new Map());

  const loadCollections = useCallback(async () => {
    const db = await getDb();
    const rows = await db.select<Collection[]>(
      "SELECT * FROM collections ORDER BY name"
    );
    setCollections(rows);
  }, []);

  const loadImageCollections = useCallback(async () => {
    const db = await getDb();
    const rows = await db.select<{ image_id: string; id: string; name: string }[]>(
      "SELECT ci.image_id, c.id, c.name FROM collection_images ci JOIN collections c ON ci.collection_id = c.id"
    );
    const map = new Map<string, Collection[]>();
    for (const row of rows) {
      const existing = map.get(row.image_id) ?? [];
      existing.push({ id: row.id, name: row.name });
      map.set(row.image_id, existing);
    }
    setImageCollectionsMap(map);
  }, []);

  const createCollection = useCallback(async (name: string) => {
    const id = crypto.randomUUID();
    const db = await getDb();
    await db.execute(
      "INSERT INTO collections (id, name) VALUES ($1, $2)",
      [id, name.trim()]
    );
    const created: Collection = { id, name: name.trim() };
    setCollections((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
    );
    toastManager.add({ title: `Collection "${created.name}" created`, type: "success", timeout: 2500 });
    return created;
  }, []);

  const deleteCollection = useCallback(async (id: string) => {
    const db = await getDb();
    await db.execute("DELETE FROM collections WHERE id = $1", [id]);
    setCollections((prev) => prev.filter((c) => c.id !== id));
    setImageCollectionsMap((prev) => {
      const next = new Map(prev);
      for (const [imageId, cols] of next.entries()) {
        const filtered = cols.filter((c) => c.id !== id);
        if (filtered.length === 0) next.delete(imageId);
        else next.set(imageId, filtered);
      }
      return next;
    });
    toastManager.add({ title: "Collection deleted", type: "default", timeout: 2500 });
  }, []);

  const renameCollection = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const db = await getDb();
    await db.execute("UPDATE collections SET name = $1 WHERE id = $2", [trimmed, id]);
    setCollections((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, name: trimmed } : c))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setImageCollectionsMap((prev) => {
      const next = new Map(prev);
      for (const [imgId, cols] of next.entries()) {
        next.set(imgId, cols.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
      }
      return next;
    });
    toastManager.add({ title: `Renamed to "${trimmed}"`, type: "success", timeout: 2500 });
  }, []);

  const addToCollection = useCallback(async (collectionId: string, imageId: string) => {
    const db = await getDb();
    await db.execute(
      "INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES ($1, $2)",
      [collectionId, imageId]
    );
    await loadImageCollections();
  }, [loadImageCollections]);

  const removeFromCollection = useCallback(async (collectionId: string, imageId: string) => {
    const db = await getDb();
    await db.execute(
      "DELETE FROM collection_images WHERE collection_id = $1 AND image_id = $2",
      [collectionId, imageId]
    );
    await loadImageCollections();
  }, [loadImageCollections]);

  const getCollectionImageIds = useCallback((collectionId: string): Set<string> => {
    const ids = new Set<string>();
    for (const [imageId, cols] of imageCollectionsMap.entries()) {
      if (cols.some((c) => c.id === collectionId)) ids.add(imageId);
    }
    return ids;
  }, [imageCollectionsMap]);

  const getCollectionCover = useCallback((collectionId: string, images: Image[]): Image | null => {
    const ids = getCollectionImageIds(collectionId);
    return images.find((img) => ids.has(img.id)) ?? null;
  }, [getCollectionImageIds]);

  const refreshImageCollections = useCallback(async () => {
    await loadImageCollections();
  }, [loadImageCollections]);

  useEffect(() => {
    loadCollections();
    loadImageCollections();
  }, [loadCollections, loadImageCollections]);

  return {
    collections,
    imageCollectionsMap,
    createCollection,
    deleteCollection,
    renameCollection,
    addToCollection,
    removeFromCollection,
    getCollectionImageIds,
    getCollectionCover,
    refreshImageCollections,
  };
}

// ── context ────────────────────────────────────────────────────────────────

type CollectionsState = ReturnType<typeof useCollectionsState>;

const CollectionsContext = createContext<CollectionsState | null>(null);

export function CollectionsProvider({ children }: { children: ReactNode }) {
  const value = useCollectionsState();
  return createElement(CollectionsContext.Provider, { value }, children);
}

export function useCollections(): CollectionsState {
  const ctx = use(CollectionsContext);
  if (!ctx) throw new Error("useCollections must be used inside <CollectionsProvider>");
  return ctx;
}
