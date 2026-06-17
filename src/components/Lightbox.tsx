import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiLoader4Line,
} from "@remixicon/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useTags } from "@/hooks/use-tags";
import { useCollections } from "@/hooks/useCollections";
import { useSettings } from "@/hooks/use-settings";
import { toastManager } from "@/lib/toast";
import type { Image } from "@/hooks/use-images";

export interface LightboxProps {
  images: Image[];
  currentIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDelete: (image: Image) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onUpdateDescription: (id: string, description: string) => void;
  imgSrc: (path: string) => string;
}

function buildMeshBackground(palette: string[]): string {
  if (palette.length === 0) return "#000";
  const positions = ["15% 15%", "85% 10%", "90% 85%", "10% 80%", "50% 50%"];
  const blobs = palette.slice(0, 5).map((color, i) => {
    const pos = positions[i] ?? "50% 50%";
    return `radial-gradient(at ${pos}, ${color}99 0%, transparent 60%)`;
  });
  return `${blobs.join(", ")}, #000`;
}

export function Lightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
  onDelete,
  onUpdateTitle,
  onUpdateNotes,
  onUpdateDescription,
  imgSrc,
}: LightboxProps) {
  const { allTags, imageTagsMap, addTag, removeTag } = useTags();
  const {
    collections,
    imageCollectionsMap,
    createCollection,
    addToCollection,
    removeFromCollection,
  } = useCollections();
  const { getSetting } = useSettings();

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [notesValue, setNotesValue] = useState("");
  const [descriptionValue, setDescriptionValue] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [creatingCol, setCreatingCol] = useState(false);
  const [newColInput, setNewColInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const image = currentIndex !== null ? images[currentIndex] : null;

  // Sync state when image changes
  useEffect(() => {
    if (image) {
      setTitleValue(image.title ?? "");
      setNotesValue(image.notes ?? "");
      setDescriptionValue(image.description ?? "");
      setTitleEditing(false);
      setTagInput("");
      setCreatingCol(false);
      setNewColInput("");
      setAnalyzing(false);
    }
  }, [currentIndex, image?.id]);

  // Auto-analyze when image opens (if mode is not manual)
  useEffect(() => {
    if (!image) return;
    let cancelled = false;

    (async () => {
      if (image.kind === "video") return;
      const mode = await getSetting("analyze_mode");
      if (!mode || mode === "manual") return;
      if (mode === "auto_new" && image.description) return;

      const apiKey = await getSetting("api_key");
      if (!apiKey) return;
      const model = (await getSetting("model")) ?? "anthropic/claude-sonnet-4-6";

      if (cancelled) return;
      setAnalyzing(true);
      try {
        const result = await invoke<{ title: string; tags: string[]; description: string } | null>(
          "analyze_image",
          { thumbPath: image.thumb_path, apiKey, model }
        );
        if (!result || cancelled) return;
        onUpdateTitle(image.id, result.title);
        if (!cancelled) setTitleValue(result.title);
        for (const tag of imageTagsMap.get(image.id) ?? []) {
          await removeTag(image.id, tag.id);
        }
        for (const tag of result.tags) {
          await addTag(image.id, tag);
        }
        onUpdateDescription(image.id, result.description);
        if (!cancelled) setDescriptionValue(result.description);
      } catch (err) {
        console.error("[mood] auto-analyze failed:", err);
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id]);

  // Keyboard navigation
  useEffect(() => {
    if (currentIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (titleEditing && image) onUpdateTitle(image.id, titleValue.trim());
        onClose();
      } else if (e.key === "ArrowLeft" && currentIndex > 0) {
        onNavigate(currentIndex - 1);
      } else if (e.key === "ArrowRight" && currentIndex < images.length - 1) {
        onNavigate(currentIndex + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIndex, images.length, onClose, onNavigate, titleEditing, titleValue, image, onUpdateTitle]);

  if (currentIndex === null || !image) return null;

  const isSvg = image.file_path.toLowerCase().endsWith(".svg");
  const isVideo = image.kind === "video";
  const imageTags = imageTagsMap.get(image.id) ?? [];
  const imageCollections = imageCollectionsMap.get(image.id) ?? [];
  const unassignedCollections = collections.filter(
    (c) => !imageCollections.some((ic) => ic.id === c.id)
  );

  let palette: string[] = [];
  try {
    palette = image.palette ? (JSON.parse(image.palette) as string[]) : [];
  } catch {
    // ignore malformed palette
  }

  const saveTitle = () => {
    const trimmed = titleValue.trim();
    onUpdateTitle(image.id, trimmed);
    setTitleEditing(false);
  };

  const handleAddTag = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await addTag(image.id, trimmed);
    setTagInput("");
  };

  const handleAnalyze = async () => {
    if (!image || analyzing) return;
    const apiKey = await getSetting("api_key");
    if (!apiKey) {
      toastManager.add({ title: "Add your OpenRouter API key in Settings", type: "error" });
      return;
    }
    const model = (await getSetting("model")) ?? "anthropic/claude-sonnet-4-6";
    setAnalyzing(true);
    try {
      const result = await invoke<{ title: string; tags: string[]; description: string } | null>(
        "analyze_image",
        { thumbPath: image.thumb_path, apiKey, model }
      );
      if (!result) return;
      onUpdateTitle(image.id, result.title);
      setTitleValue(result.title);
      for (const tag of imageTags) {
        await removeTag(image.id, tag.id);
      }
      for (const tag of result.tags) {
        await addTag(image.id, tag);
      }
      onUpdateDescription(image.id, result.description);
      setDescriptionValue(result.description);
    } catch (err) {
      console.error("[mood] analyze failed:", err);
      toastManager.add({ title: "Analysis failed", type: "error" });
    } finally {
      setAnalyzing(false);
    }
  };

  const date = new Date(image.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex"
      style={{ background: isSvg
        ? "repeating-conic-gradient(#d0d0d0 0% 25%, #f8f8f8 0% 50%) 0 0 / 24px 24px"
        : buildMeshBackground(palette) }}

    >
      {/* Image area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {isVideo ? (
          <video
            src={imgSrc(image.file_path)}
            controls
            autoPlay
            className="max-h-[90vh] max-w-full p-8"
            draggable={false}
          />
        ) : (
          <>
            <img
              src={imgSrc(image.file_path)}
              alt={image.title ?? ""}
              className="max-h-[90vh] max-w-full object-contain p-8"
              draggable={false}
              onError={(e) => {
                e.currentTarget.style.display = "none";
                const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.removeAttribute("hidden");
              }}
            />
            <div hidden className="flex h-48 w-48 items-center justify-center rounded-xl bg-white/10 text-white/50 text-sm">
              Image file missing
            </div>
          </>
        )}

        {/* Prev button */}
        {currentIndex > 0 && (
          <button
            onClick={() => onNavigate(currentIndex - 1)}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-colors"
            aria-label="Previous image"
          >
            <RiArrowLeftLine className="h-5 w-5" />
          </button>
        )}

        {/* Next button */}
        {currentIndex < images.length - 1 && (
          <button
            onClick={() => onNavigate(currentIndex + 1)}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-colors"
            aria-label="Next image"
          >
            <RiArrowRightLine className="h-5 w-5" />
          </button>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-colors"
          aria-label="Close lightbox"
        >
          <RiCloseLine className="h-5 w-5" />
        </button>
      </div>

      {/* Sidebar */}
      <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-background/80 backdrop-blur-xl">
        {/* Title */}
        <div className="border-b border-border/50 px-5 pb-3 pt-5">
          {analyzing ? (
            <Skeleton className="h-7 w-3/4" />
          ) : titleEditing ? (
            <input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  saveTitle();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-full bg-transparent text-xl font-semibold outline-none"
            />
          ) : (
            <h2
              className="cursor-text text-xl font-semibold"
              onClick={() => setTitleEditing(true)}
            >
              {image.title || "Untitled"}
            </h2>
          )}
        </div>

        {/* Description */}
        <div className="border-b border-border/50 px-5 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Description</span>
            {!isSvg && <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40"
            >
              {analyzing ? (
                <>
                  <RiLoader4Line className="size-3 animate-spin" />
                  Analyzing…
                </>
              ) : "✨ Analyze"}
            </button>}
          </div>
          {analyzing ? (
            <div className="space-y-1.5 pt-0.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3.5 w-4/6" />
            </div>
          ) : (
            <textarea
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value)}
              onBlur={() => { if (image) onUpdateDescription(image.id, descriptionValue); }}
              placeholder="No description yet…"
              rows={3}
              className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          )}
        </div>

        {/* Palette */}
        {palette.length > 0 && (
          <div className="border-b border-border/50 px-5 py-3">
            <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Colors</span>
            <div className="flex flex-wrap gap-2">
              {palette.map((color, i) => (
                <button
                  key={i}
                  onClick={() => {
                    navigator.clipboard.writeText(color);
                    toastManager.add({ title: `Copied ${color}`, type: "success", timeout: 1500 });
                  }}
                  className="size-6 rounded-md ring-1 ring-black/20 transition-transform hover:scale-110"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        <div className="border-b border-border/50 px-5 py-3">
          <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {imageTags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs"
              >
                {tag.name}
                <button
                  onClick={() => removeTag(image.id, tag.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors leading-none"
                  aria-label={`Remove tag ${tag.name}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              list="lightbox-tag-suggestions"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag(tagInput);
                }
              }}
              placeholder="+ tag"
              className="w-16 bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground/50"
            />
            <datalist id="lightbox-tag-suggestions">
              {allTags
                .filter((t) => !imageTags.some((it) => it.id === t.id))
                .map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
            </datalist>
          </div>
        </div>

        {/* Collections */}
        <div className="border-b border-border/50 px-5 py-3">
          <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Collections</span>
          <div className="flex flex-wrap gap-1.5">
            {imageCollections.map((col) => (
              <span
                key={col.id}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs"
              >
                {col.name}
                <button
                  onClick={() => removeFromCollection(col.id, image.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors leading-none"
                  aria-label={`Remove from collection ${col.name}`}
                >
                  ×
                </button>
              </span>
            ))}
            {unassignedCollections.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    addToCollection(e.target.value, image.id);
                    e.target.value = "";
                  }
                }}
                className="bg-transparent py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground cursor-pointer"
              >
                <option value="" disabled>+ add</option>
                {unassignedCollections.map((c) => (
                  <option key={c.id} value={c.id} className="bg-background text-foreground">
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {creatingCol ? (
              <input
                autoFocus
                value={newColInput}
                onChange={(e) => setNewColInput(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    const trimmed = newColInput.trim();
                    if (trimmed) {
                      const col = await createCollection(trimmed);
                      await addToCollection(col.id, image.id);
                    }
                    setCreatingCol(false);
                    setNewColInput("");
                  }
                  if (e.key === "Escape") {
                    setCreatingCol(false);
                    setNewColInput("");
                  }
                }}
                onBlur={() => { setCreatingCol(false); setNewColInput(""); }}
                placeholder="New collection…"
                className="w-32 bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground/50"
              />
            ) : (
              <button
                onClick={() => setCreatingCol(true)}
                className="py-0.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              >
                + new
              </button>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="border-b border-border/50 px-5 py-3">
          <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Notes</span>
          <textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            onBlur={() => onUpdateNotes(image.id, notesValue)}
            placeholder="Add a note…"
            rows={3}
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Date + source */}
        <div className="border-b border-border/50 px-5 py-3 text-xs text-muted-foreground">
          <p>{date}</p>
          {image.source_url && (
            <a
              href={image.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
            >
              <RiExternalLinkLine className="h-3 w-3" />
              Source
            </a>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Delete */}
        <div className="border-t border-border/50 px-5 py-4">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => {
              onDelete(image);
              onClose();
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
