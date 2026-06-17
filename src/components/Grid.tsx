import { useCallback, useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  RiImageAddLine,
  RiAlbumLine,
  RiPriceTag2Line,
} from "@remixicon/react";
import { useImages } from "@/hooks/use-images";
import { useTags } from "@/hooks/use-tags";
import { useCollections } from "@/hooks/useCollections";
import { Lightbox } from "@/components/Lightbox";
import { LazyImage } from "@/components/LazyImage";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { Tab, Sort } from "@/components/TopNav";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

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
  const { images: allImages, imgSrc, savePath, deleteImage, updateTitle, updateNotes, resetAll } = useImages();
  const { imageTagsMap, addTag, deleteTag, renameTag } = useTags();
  const { collections, getCollectionImageIds, getCollectionCover, deleteCollection, renameCollection, addToCollection } = useCollections();

  const [isDragging, setIsDragging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{
    type: "collection" | "tag";
    id: string;
    name: string;
  } | null>(null);
  const [batchTagInput, setBatchTagInput] = useState("");

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

  // Tauri drag-drop listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;

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
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [savePath]);

  const handleFilePicker = async () => {
    const result = await openDialog({
      multiple: true,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
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

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} image${selectedIds.size !== 1 ? "s" : ""}?`)) return;
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

  const handleRenameCollection = (id: string, currentName: string) => {
    const name = window.prompt("Rename collection:", currentName);
    if (name?.trim()) renameCollection(id, name.trim());
  };

  const handleRenameTag = (id: string, currentName: string) => {
    const name = window.prompt("Rename tag:", currentName);
    if (name?.trim()) renameTag(id, name.trim());
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === "collection") {
      deleteCollection(confirmDelete.id);
      if (selectedId === confirmDelete.id) onSelectId?.(null);
    } else {
      deleteTag(confirmDelete.id);
      if (selectedId === confirmDelete.id) onSelectId?.(null);
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
                  <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center">
                    <span className="text-white font-semibold text-sm text-center px-2 drop-shadow">
                      {col.name}
                    </span>
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
                  <button
                    onClick={() => onSelectId?.(id)}
                    className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
                  >
                    {name}
                    <span className="ml-2 text-muted-foreground text-xs">{count}</span>
                  </button>
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
  const renderMasonryGrid = () =>
    filteredImages.length === 0 ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground select-none">
        <RiImageAddLine className="size-12 opacity-40" />
        {allImages.length === 0 ? (
          <>
            <div className="text-center">
              <p className="text-sm font-medium">Drop images to start your mood board</p>
              <p className="text-xs mt-1 opacity-70">or paste a URL · or click + Add</p>
            </div>
          </>
        ) : (
          <p className="text-sm">No images match your filters</p>
        )}
      </div>
    ) : (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
          {filteredImages.map((img) => (
            <div
              key={img.id}
              className={cn(
                "group mb-3 break-inside-avoid overflow-hidden rounded-lg relative cursor-pointer",
                selectedIds.has(img.id) &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background"
              )}
              style={{ backgroundColor: img.dominant_color ?? undefined }}
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
              <LazyImage
                src={imgSrc(img.thumb_path)}
                width={img.width}
                height={img.height}
                className="w-full object-cover group-hover:opacity-90"
                draggable={false}
              />
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
      </div>
    );

  // Determine which content to render
  const renderContent = () => {
    if (activeTab === "collections" && !selectedId) return renderCollectionGrid();
    if (activeTab === "tags" && !selectedId) return renderTagGrid();
    return renderMasonryGrid();
  };

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
            <button
              onClick={() => { if (confirm("Delete everything and start fresh?")) resetAll(); }}
              className="rounded-md border border-destructive/50 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              Reset
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
        imgSrc={imgSrc}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title={
          confirmDelete?.type === "collection"
            ? `Delete "${confirmDelete.name}"?`
            : `Delete tag "${confirmDelete?.name}"?`
        }
        description={
          confirmDelete?.type === "tag"
            ? "This removes the tag from all images."
            : undefined
        }
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
