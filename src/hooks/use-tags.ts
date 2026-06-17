import { createContext, createElement, use, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Database from "@tauri-apps/plugin-sql";
import { toastManager } from "@/lib/toast";

export interface Tag {
  id: string;
  name: string;
}

export interface TagWithCount extends Tag {
  count: number;
}

export type ImageTagMap = Map<string, Tag[]>;

async function getDb() {
  return Database.load("sqlite:keep.db");
}

// ── internal state logic ───────────────────────────────────────────────────

function useTagsState() {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [imageTagsMap, setImageTagsMap] = useState<ImageTagMap>(new Map());

  const load = useCallback(async () => {
    const db = await getDb();

    const tags = await db.select<Tag[]>(
      "SELECT id, name FROM tags ORDER BY name"
    );
    setAllTags(tags);

    const rows = await db.select<{ image_id: string; id: string; name: string }[]>(
      `SELECT it.image_id, t.id, t.name
       FROM image_tags it
       JOIN tags t ON t.id = it.tag_id
       ORDER BY t.name`
    );

    const map: ImageTagMap = new Map();
    for (const row of rows) {
      const list = map.get(row.image_id) ?? [];
      list.push({ id: row.id, name: row.name });
      map.set(row.image_id, list);
    }
    setImageTagsMap(map);
  }, []);

  const addTag = useCallback(
    async (imageId: string, tagName: string) => {
      const db = await getDb();
      const trimmed = tagName.trim();
      if (!trimmed) return;

      let tag = allTags.find(
        (t) => t.name.toLowerCase() === trimmed.toLowerCase()
      );

      if (!tag) {
        const newId = crypto.randomUUID();
        await db.execute("INSERT INTO tags (id, name) VALUES ($1, $2)", [
          newId,
          trimmed,
        ]);
        tag = { id: newId, name: trimmed };
        setAllTags((prev) =>
          [...prev, tag!].sort((a, b) => a.name.localeCompare(b.name))
        );
      }

      await db.execute(
        "INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES ($1, $2)",
        [imageId, tag.id]
      );

      setImageTagsMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(imageId) ?? [];
        if (!existing.find((t) => t.id === tag!.id)) {
          next.set(
            imageId,
            [...existing, tag!].sort((a, b) => a.name.localeCompare(b.name))
          );
        }
        return next;
      });
    },
    [allTags]
  );

  const removeTag = useCallback(async (imageId: string, tagId: string) => {
    const db = await getDb();
    await db.execute(
      "DELETE FROM image_tags WHERE image_id = $1 AND tag_id = $2",
      [imageId, tagId]
    );
    setImageTagsMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(imageId) ?? [];
      next.set(imageId, existing.filter((t) => t.id !== tagId));
      return next;
    });
  }, []);

  const deleteTag = useCallback(async (tagId: string) => {
    const db = await getDb();
    await db.execute("DELETE FROM tags WHERE id = $1", [tagId]);
    setAllTags((prev) => prev.filter((t) => t.id !== tagId));
    setImageTagsMap((prev) => {
      const next = new Map(prev);
      for (const [imgId, tags] of next.entries()) {
        next.set(imgId, tags.filter((t) => t.id !== tagId));
      }
      return next;
    });
    toastManager.add({ title: "Tag deleted", type: "default", timeout: 2500 });
  }, []);

  const renameTag = useCallback(async (tagId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const db = await getDb();
    await db.execute("UPDATE tags SET name = $1 WHERE id = $2", [trimmed, tagId]);
    setAllTags((prev) =>
      prev
        .map((t) => (t.id === tagId ? { ...t, name: trimmed } : t))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setImageTagsMap((prev) => {
      const next = new Map(prev);
      for (const [imgId, tags] of next.entries()) {
        next.set(imgId, tags.map((t) => (t.id === tagId ? { ...t, name: trimmed } : t)));
      }
      return next;
    });
    toastManager.add({ title: `Tag renamed to "${trimmed}"`, type: "success", timeout: 2500 });
  }, []);

  const getTagCounts = useCallback((): TagWithCount[] => {
    const counts = new Map<string, number>();
    for (const tags of imageTagsMap.values()) {
      for (const t of tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
    }
    return allTags.map((tag) => ({ ...tag, count: counts.get(tag.id) ?? 0 }));
  }, [allTags, imageTagsMap]);

  const refreshImageTags = useCallback(async (imageId: string) => {
    const db = await getDb();
    const rows = await db.select<{ id: string; name: string }[]>(
      `SELECT t.id, t.name
       FROM image_tags it
       JOIN tags t ON t.id = it.tag_id
       WHERE it.image_id = $1
       ORDER BY t.name`,
      [imageId]
    );
    setImageTagsMap((prev) => {
      const next = new Map(prev);
      next.set(imageId, rows);
      return next;
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { allTags, imageTagsMap, addTag, removeTag, deleteTag, renameTag, getTagCounts, refreshImageTags };
}

// ── context ────────────────────────────────────────────────────────────────

type TagsState = ReturnType<typeof useTagsState>;

const TagsContext = createContext<TagsState | null>(null);

export function TagsProvider({ children }: { children: ReactNode }) {
  const value = useTagsState();
  return createElement(TagsContext.Provider, { value }, children);
}

export function useTags(): TagsState {
  const ctx = use(TagsContext);
  if (!ctx) throw new Error("useTags must be used inside <TagsProvider>");
  return ctx;
}
