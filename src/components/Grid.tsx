import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  RiImageAddLine,
  RiAlbumLine,
  RiPriceTag2Line,
  RiUploadLine,
  RiClipboardLine,
  RiFolderOpenLine,
} from "@remixicon/react";
import { useImages } from "@/hooks/use-images";
import { useTags } from "@/hooks/use-tags";
import { useCollections } from "@/hooks/useCollections";
import { Lightbox } from "@/components/Lightbox";
import { LazyImage } from "@/components/LazyImage";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useSettings } from "@/hooks/use-settings";
import { toastManager } from "@/lib/toast";
import type { Tab, Sort } from "@/components/TopNav";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "tiff", "tif", "svg", "jxl", "heic", "heif", "mp4", "mov", "webm"]);

function getExt(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

interface GridProps {
  activeTab?: Tab;
  sort?: Sort;
  searchQuery?: string;
  selectedId?: string | null;
  onSelectId?: (id: string | null) => void;
  onCreateCollection?: () => void;
}

export default function Grid({
  activeTab = "all",
  sort = "newest",
  searchQuery = "",
  selectedId = null,
  onSelectId,
  onCreateCollection,
}: GridProps) {
  const { images: allImages, imgSrc, savePath, deleteImage, updateTitle, updateNotes, updateDescription, resetAll, saveExample, loadExample } = useImages();
  const { imageTagsMap, addTag, removeTag, deleteTag, renameTag } = useTags();
  const { getSetting } = useSettings();
  const { collections, getCollectionImageIds, getCollectionCover, deleteCollection, renameCollection, addToCollection } = useCollections();

  const [isDragging, setIsDragging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<
    | { type: "collection"; id: string; name: string }
    | { type: "tag"; id: string; name: string }
    | { type: "batch"; count: number }
    | { type: "reset" }
    | null
  >(null);
  const [batchTagInput, setBatchTagInput] = useState("");
  const [renaming, setRenaming] = useState<{ type: "collection" | "tag"; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const analyzeCancelRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Compute filtered + sorted images
  const filteredImages = (() => {
    let imgs = [...allImages];

    if (activeTab === "collections" && selectedId) {
      const ids = getCollectionImageIds(selectedId);
      imgs = imgs.filter((img) => ids.has(img.id));
    } else if (activeTab === "tags" && selectedId) {
      imgs = imgs.filter((img) => {
        const tags = imageTagsMap.get(img.id) ?? [];
        return tags.some((t) => t.id === selectedId);
      });
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      imgs = imgs.filter(
        (img) =>
          img.title?.toLowerCase().includes(q) ||
          img.source_url?.toLowerCase().includes(q) ||
          img.description?.toLowerCase().includes(q) ||
          (imageTagsMap.get(img.id) ?? []).some((t) =>
            t.name.toLowerCase().includes(q)
          )
      );
    }

    imgs.sort((a, b) =>
      sort === "newest"
        ? (b.created_at ?? 0) - (a.created_at ?? 0)
        : (a.created_at ?? 0) - (b.created_at ?? 0)
    );

    return imgs;
  })();

  const currentIndex = openId ? filteredImages.findIndex((i) => i.id === openId) : -1;

  // Clear selection when tab changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [activeTab, searchQuery, sort, selectedId]);

  // Sentinel: load more DOM nodes as user scrolls
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= filteredImages.length) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((n) => n + 50); },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, filteredImages.length]);

  // Tauri drag-drop listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        const type = event.payload.type;
        if (type === "over") {
          setIsDragging(true);
        } else if (type === "leave") {
          setIsDragging(false);
        } else if (type === "drop") {
          setIsDragging(false);
          const paths: string[] =
            "paths" in event.payload ? (event.payload.paths as string[]) : [];
          const imagePaths = paths.filter((p) =>
            IMAGE_EXTENSIONS.has(getExt(p))
          );
          for (const p of imagePaths) {
            savePath(p);
          }
        }
      })
      .then((fn) => {
        if (mounted) {
          unlisten = fn;
        } else {
          fn(); // cleanup already ran — tear down immediately
        }
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [savePath]);

  const handleFilePicker = async () => {
    const result = await openDialog({
      multiple: true,
      filters: [
        { name: "Images & Video", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "tiff", "tif", "svg", "jxl", "heic", "heif", "mp4", "mov", "webm"] },
      ],
    });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    for (const p of paths) {
      await savePath(p);
    }
  };

  const handleDelete = (img: { id: string; file_path: string; thumb_path: string }) => {
    deleteImage(img.id, img.file_path, img.thumb_path);
    const idx = filteredImages.findIndex((i) => i.id === img.id);
    const newLen = filteredImages.length - 1;
    if (newLen <= 0) {
      setOpenId(null);
    } else {
      const nextIdx = idx >= newLen ? newLen - 1 : idx;
      setOpenId(filteredImages[nextIdx]?.id ?? null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setConfirmDelete({ type: "batch", count: selectedIds.size });
  }, [selectedIds]);

  const doBatchDelete = useCallback(async () => {
    for (const id of selectedIds) {
      const img = allImages.find((i) => i.id === id);
      if (img) await deleteImage(id, img.file_path, img.thumb_path);
    }
    setSelectedIds(new Set());
  }, [selectedIds, allImages, deleteImage]);

  const handleBatchAddToCollection = async (collectionId: string) => {
    for (const id of selectedIds) {
      await addToCollection(collectionId, id);
    }
  };

  const handleBatchTag = async (tagName: string) => {
    if (!tagName.trim()) return;
    for (const id of selectedIds) {
      await addTag(id, tagName.trim());
    }
    setBatchTagInput("");
  };

  const handleAnalyzeAll = async () => {
    if (analyzeProgress) {
      analyzeCancelRef.current = true;
      return;
    }
    const apiKey = await getSetting("api_key");
    if (!apiKey) {
      toastManager.add({ title: "Add your OpenRouter API key in Settings", type: "error" });
      return;
    }
    const model = (await getSetting("model")) ?? "anthropic/claude-sonnet-4-6";
    analyzeCancelRef.current = false;
    setAnalyzeProgress({ done: 0, total: allImages.length });

    for (let i = 0; i < allImages.length; i++) {
      if (analyzeCancelRef.current) break;
      const img = allImages[i];
      if (img.kind === "video") {
        setAnalyzeProgress({ done: i + 1, total: allImages.length });
        continue;
      }
      try {
        const result = await invoke<{ title: string; tags: string[]; description: string } | null>(
          "analyze_image",
          { thumbPath: img.thumb_path, apiKey, model }
        );
        if (result && !analyzeCancelRef.current) {
          await updateTitle(img.id, result.title);
          for (const tag of imageTagsMap.get(img.id) ?? []) {
            await removeTag(img.id, tag.id);
          }
          for (const tag of result.tags) {
            await addTag(img.id, tag);
          }
          await updateDescription(img.id, result.description);
        }
      } catch (err) {
        console.error(`[mood] batch analyze failed for ${img.id}:`, err);
      }
      setAnalyzeProgress({ done: i + 1, total: allImages.length });
    }

    setAnalyzeProgress(null);
    if (!analyzeCancelRef.current) {
      toastManager.add({ title: "Analysis complete", type: "success", timeout: 3000 });
    }
  };

  const handleRenameCollection = (id: string, currentName: string) => {
    setRenaming({ type: "collection", id });
    setRenameValue(currentName);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const handleRenameTag = (id: string, currentName: string) => {
    setRenaming({ type: "tag", id });
    setRenameValue(currentName);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const commitRename = () => {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      if (renaming.type === "collection") renameCollection(renaming.id, trimmed);
      else renameTag(renaming.id, trimmed);
    }
    setRenaming(null);
    setRenameValue("");
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === "collection") {
      deleteCollection(confirmDelete.id);
      if (selectedId === confirmDelete.id) onSelectId?.(null);
    } else if (confirmDelete.type === "tag") {
      deleteTag(confirmDelete.id);
      if (selectedId === confirmDelete.id) onSelectId?.(null);
    } else if (confirmDelete.type === "batch") {
      await doBatchDelete();
    } else if (confirmDelete.type === "reset") {
      resetAll();
    }
    setConfirmDelete(null);
  };

  // Delete key for batch delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIds.size > 0 &&
        openId === null
      ) {
        e.preventDefault();
        handleBatchDelete();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds.size, openId, handleBatchDelete]);

  const contextMenuPopupClass =
    "z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg text-sm text-popover-foreground";
  const contextMenuItemClass =
    "flex items-center px-3 py-1.5 rounded-md cursor-pointer hover:bg-accent hover:text-accent-foreground outline-none select-none";
  const contextMenuItemDestructiveClass =
    "flex items-center px-3 py-1.5 rounded-md cursor-pointer text-destructive hover:bg-destructive/10 outline-none select-none";

  // Collection grid view
  const renderCollectionGrid = () => (
    <div className="flex-1 overflow-y-auto p-4">
      {collections.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground select-none">
          <RiAlbumLine className="size-10 opacity-40" />
          <div className="text-center">
            <p className="text-sm font-medium">No collections yet</p>
            <p className="text-xs mt-1 opacity-70">Right-click a collection to rename or delete</p>
          </div>
          <button
            onClick={onCreateCollection}
            className="mt-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          >
            + Create collection
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {collections.map((col) => {
            const cover = getCollectionCover(col.id, allImages);
            const ids = getCollectionImageIds(col.id);
            return (
              <ContextMenu.Root key={col.id}>
                <ContextMenu.Trigger
                  className="rounded-lg overflow-hidden cursor-pointer relative aspect-square bg-muted hover:opacity-90 transition-opacity"
                  onClick={() => onSelectId?.(col.id)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelectId?.(col.id)}
                >
                  {cover ? (
                    <img
                      src={imgSrc(cover.thumb_path)}
                      alt={col.name}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full bg-muted" />
                  )}
                  <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center px-2">
                    {renaming?.type === "collection" && renaming.id === col.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") { setRenaming(null); setRenameValue(""); }
                        }}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-transparent text-white font-semibold text-sm text-center outline-none border-b border-white/60 w-full"
                      />
                    ) : (
                      <span className="text-white font-semibold text-sm text-center drop-shadow">
                        {col.name}
                      </span>
                    )}
                    <span className="text-white/70 text-xs mt-1">
                      {ids.size} {ids.size === 1 ? "image" : "images"}
                    </span>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner>
                    <ContextMenu.Popup className={contextMenuPopupClass}>
                      <ContextMenu.Item
                        className={contextMenuItemClass}
                        onClick={() => handleRenameCollection(col.id, col.name)}
                      >
                        Rename…
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className={contextMenuItemDestructiveClass}
                        onClick={() =>
                          setConfirmDelete({ type: "collection", id: col.id, name: col.name })
                        }
                      >
                        Delete
                      </ContextMenu.Item>
                    </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            );
          })}
        </div>
      )}
    </div>
  );

  // Tag chip grid view
  const renderTagGrid = () => {
    const tagCounts = new Map<string, { name: string; count: number }>();
    for (const tags of imageTagsMap.values()) {
      for (const t of tags) {
        const existing = tagCounts.get(t.id);
        if (existing) {
          existing.count++;
        } else {
          tagCounts.set(t.id, { name: t.name, count: 1 });
        }
      }
    }
    const tagList = Array.from(tagCounts.entries()).sort((a, b) =>
      a[1].name.localeCompare(b[1].name)
    );

    return (
      <div className="flex-1 overflow-y-auto p-4">
        {tagList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground select-none">
            <RiPriceTag2Line className="size-10 opacity-40" />
            <div className="text-center">
              <p className="text-sm font-medium">No tags yet</p>
              <p className="text-xs mt-1 opacity-70">Open an image and add tags in the detail view</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tagList.map(([id, { name, count }]) => (
              <ContextMenu.Root key={id}>
                <ContextMenu.Trigger className="contents">
                  {renaming?.type === "tag" && renaming.id === id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") { setRenaming(null); setRenameValue(""); }
                      }}
                      onBlur={commitRename}
                      className="rounded-full border border-ring bg-muted px-4 py-2 text-sm font-medium outline-none ring-1 ring-ring"
                    />
                  ) : (
                    <button
                      onClick={() => onSelectId?.(id)}
                      className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
                    >
                      {name}
                      <span className="ml-2 text-muted-foreground text-xs">{count}</span>
                    </button>
                  )}
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner>
                    <ContextMenu.Popup className={contextMenuPopupClass}>
                      <ContextMenu.Item
                        className={contextMenuItemClass}
                        onClick={() => handleRenameTag(id, name)}
                      >
                        Rename…
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className={contextMenuItemDestructiveClass}
                        onClick={() => setConfirmDelete({ type: "tag", id, name })}
                      >
                        Delete
                      </ContextMenu.Item>
                    </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Masonry image grid
  const renderMasonryGrid = () => {
    if (filteredImages.length === 0) {
      if (allImages.length === 0) {
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-10 select-none">
            <div className="text-center">
              <p className="text-xl font-bold">Start your board</p>
              <p className="text-sm text-muted-foreground mt-1">Save images from anywhere</p>
            </div>
            <div className="flex gap-4">
              <div className="flex w-40 flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center text-muted-foreground">
                <RiUploadLine className="size-7 opacity-40" />
                <div>
                  <p className="text-xs font-medium">Drag & drop</p>
                  <p className="text-xs opacity-60 mt-0.5">image files</p>
                </div>
              </div>
              <div className="flex w-40 flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center text-muted-foreground">
                <RiClipboardLine className="size-7 opacity-40" />
                <div>
                  <p className="text-xs font-medium">⌘V Paste</p>
                  <p className="text-xs opacity-60 mt-0.5">image or URL</p>
                </div>
              </div>
              <button
                onClick={handleFilePicker}
                className="flex w-40 flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center text-muted-foreground hover:border-foreground/30 hover:bg-accent transition-colors"
              >
                <RiFolderOpenLine className="size-7 opacity-40" />
                <div>
                  <p className="text-xs font-medium">Browse files</p>
                  <p className="text-xs opacity-60 mt-0.5">or click + Add</p>
                </div>
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground select-none">
          <RiImageAddLine className="size-10 opacity-30" />
          <p className="text-sm">No images match your filters</p>
        </div>
      );
    }

    const visibleImages = filteredImages.slice(0, visibleCount);
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
          {visibleImages.map((img) => (
            <div
              key={img.id}
              className={cn(
                "group mb-3 break-inside-avoid overflow-hidden rounded-lg relative cursor-pointer",
                selectedIds.has(img.id) &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background"
              )}
              style={img.file_path.toLowerCase().endsWith(".svg")
                ? { backgroundColor: "#fff" }
                : { backgroundColor: img.dominant_color ?? undefined }}
              onClick={(e) => {
                if (e.metaKey || e.shiftKey) {
                  e.preventDefault();
                  toggleSelect(img.id);
                } else {
                  setOpenId(img.id);
                  if (selectedIds.size > 0) setSelectedIds(new Set());
                }
              }}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setOpenId(img.id)}
            >
              {img.kind === "video" ? (
                <video
                  src={imgSrc(img.file_path)}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="w-full object-cover group-hover:opacity-90"
                  draggable={false}
                />
              ) : (
                <LazyImage
                  src={imgSrc(img.thumb_path)}
                  width={img.width}
                  height={img.height}
                  className="w-full object-cover group-hover:opacity-90"
                  draggable={false}
                />
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              {/* Tag chips on hover */}
              <div className="absolute bottom-0 left-0 right-0 hidden group-hover:flex flex-wrap gap-1 p-2 bg-gradient-to-t from-black/60 to-transparent">
                {(imageTagsMap.get(img.id) ?? []).slice(0, 3).map((t) => (
                  <span
                    key={t.id}
                    className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-black font-medium"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
              {/* Selection indicator */}
              {selectedIds.size > 0 && (
                <div
                  className={cn(
                    "absolute top-2 left-2 size-5 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors",
                    selectedIds.has(img.id)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-white/60 bg-black/30"
                  )}
                >
                  {selectedIds.has(img.id) && "✓"}
                </div>
              )}
            </div>
          ))}
        </div>
        {visibleCount < filteredImages.length && (
          <div ref={sentinelRef} className="h-1" />
        )}
      </div>
    );
  };

  // Determine which content to render
  const renderContent = () => {
    if (activeTab === "collections" && !selectedId) return renderCollectionGrid();
    if (activeTab === "tags" && !selectedId) return renderTagGrid();
    return renderMasonryGrid();
  };

  const cd = confirmDelete;
  const confirmTitle = !cd ? "" :
    cd.type === "collection" ? `Delete "${cd.name}"?` :
    cd.type === "tag" ? `Delete tag "${cd.name}"?` :
    cd.type === "batch" ? `Delete ${cd.count} image${cd.count !== 1 ? "s" : ""}?` :
    "Delete everything?";
  const confirmDescription = !cd ? undefined :
    cd.type === "tag" ? "This removes the tag from all images." :
    cd.type === "reset" ? "This permanently deletes all images and data. Cannot be undone." :
    undefined;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* main column */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* toolbar */}
        <div
          data-tauri-drag-region
          className="flex h-11 flex-shrink-0 items-center border-b border-border px-4 gap-2"
        >
          {/* Breadcrumb when drilling into a collection or tag */}
          {(activeTab === "collections" || activeTab === "tags") && selectedId && (
            <button
              onClick={() => onSelectId?.(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              ← {activeTab === "collections" ? "All Collections" : "All Tags"}
            </button>
          )}

          {/* Batch action toolbar */}
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <button
                onClick={handleBatchDelete}
                className="h-7 rounded-md border border-destructive/50 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                Delete all
              </button>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleBatchAddToCollection(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="" disabled>Add to collection…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                value={batchTagInput}
                onChange={(e) => setBatchTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBatchTag(batchTagInput);
                }}
                placeholder="Add tag…"
                className="h-7 w-28 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={() => setSelectedIds(new Set())}
                className="h-7 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </>
          )}

          <div className="flex-1" data-tauri-drag-region />
          {import.meta.env.DEV && (
            <>
              <button
                onClick={() => saveExample(1)}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                Save E1
              </button>
              <button
                onClick={() => loadExample(1)}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                E1
              </button>
              <button
                onClick={() => setConfirmDelete({ type: "reset" })}
                className="rounded-md border border-destructive/50 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                Reset
              </button>
            </>
          )}
          {allImages.length > 0 && (
            <button
              onClick={handleAnalyzeAll}
              className={cn(
                "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                analyzeProgress
                  ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              )}
            >
              {analyzeProgress
                ? `${analyzeProgress.done}/${analyzeProgress.total} — Cancel`
                : "✨ Analyze All"}
            </button>
          )}
          <button
            onClick={handleFilePicker}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            + Add
          </button>
        </div>

        {renderContent()}

        {/* drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80">
            <span className="text-sm font-medium text-primary select-none">
              Drop images here
            </span>
          </div>
        )}
      </div>

      <Lightbox
        images={filteredImages}
        currentIndex={currentIndex === -1 ? null : currentIndex}
        onNavigate={(idx) => setOpenId(idx !== null ? (filteredImages[idx]?.id ?? null) : null)}
        onClose={() => setOpenId(null)}
        onDelete={handleDelete}
        onUpdateTitle={updateTitle}
        onUpdateNotes={updateNotes}
        onUpdateDescription={updateDescription}
        imgSrc={imgSrc}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title={confirmTitle}
        description={confirmDescription}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
