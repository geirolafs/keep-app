import { useEffect, useRef, useState } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCloseLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { useTags } from "@/hooks/use-tags";
import { useCollections } from "@/hooks/useCollections";
import type { Image } from "@/hooks/use-images";

export interface LightboxProps {
  images: Image[];
  currentIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDelete: (image: Image) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  imgSrc: (path: string) => string;
}

export function Lightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
  onDelete,
  onUpdateTitle,
  onUpdateNotes,
  imgSrc,
}: LightboxProps) {
  const { allTags, imageTagsMap, addTag, removeTag } = useTags();
  const {
    collections,
    imageCollectionsMap,
    addToCollection,
    removeFromCollection,
  } = useCollections();

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [notesValue, setNotesValue] = useState("");
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  const image = currentIndex !== null ? images[currentIndex] : null;

  // Sync title/notes state when image changes
  useEffect(() => {
    if (image) {
      setTitleValue(image.title ?? "");
      setNotesValue(image.notes ?? "");
      setTitleEditing(false);
      setTagInput("");
    }
  }, [currentIndex, image?.id]);

  // Keyboard navigation
  useEffect(() => {
    if (currentIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && currentIndex > 0) {
        onNavigate(currentIndex - 1);
      } else if (e.key === "ArrowRight" && currentIndex < images.length - 1) {
        onNavigate(currentIndex + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIndex, images.length, onClose, onNavigate]);

  if (currentIndex === null || !image) return null;

  const imageTags = imageTagsMap.get(image.id) ?? [];
  const imageCollections = imageCollectionsMap.get(image.id) ?? [];
  const unassignedCollections = collections.filter(
    (c) => !imageCollections.some((ic) => ic.id === c.id)
  );

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

  const date = new Date(image.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/90">
      {/* Image area */}
      <div className="absolute inset-0 flex items-center justify-center pb-40">
        <img
          src={imgSrc(image.file_path)}
          alt={image.title ?? ""}
          className="max-h-[75vh] max-w-[80vw] object-contain"
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
      </div>

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

      {/* Bottom strip */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-6 py-4 flex flex-col gap-2">
        {/* Title row */}
        <div>
          {titleEditing ? (
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
              className="bg-transparent text-white text-lg font-medium outline-none border-b border-white/40 w-full"
            />
          ) : (
            <span
              className="text-white text-lg font-medium cursor-text"
              onClick={() => setTitleEditing(true)}
            >
              {image.title || "Untitled"}
            </span>
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2">
          <span className="text-white/60 text-xs">{date}</span>
          {image.source_url && (
            <a
              href={image.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-white/60 text-xs hover:text-white/90 transition-colors"
            >
              <RiExternalLinkLine className="h-3 w-3" />
              Source
            </a>
          )}
        </div>

        {/* Tags row */}
        <div className="flex flex-wrap gap-1 items-center">
          {imageTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white"
            >
              {tag.name}
              <button
                onClick={() => removeTag(image.id, tag.id)}
                className="hover:text-white/60 transition-colors leading-none"
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
            className="bg-transparent text-white text-xs placeholder-white/40 outline-none border-b border-white/20 focus:border-white/50 w-16 py-0.5 transition-colors"
          />
          <datalist id="lightbox-tag-suggestions">
            {allTags
              .filter((t) => !imageTags.some((it) => it.id === t.id))
              .map((t) => (
                <option key={t.id} value={t.name} />
              ))}
          </datalist>
        </div>

        {/* Notes row */}
        <textarea
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          onBlur={() => onUpdateNotes(image.id, notesValue)}
          placeholder="Add a note…"
          rows={2}
          className="w-full resize-none bg-transparent py-0.5 text-xs text-white/80 outline-none placeholder-white/30 border-b border-white/20 focus:border-white/50 transition-colors"
        />

        {/* Collections row */}
        <div className="flex flex-wrap gap-1 items-center">
          {imageCollections.map((col) => (
            <span
              key={col.id}
              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white"
            >
              {col.name}
              <button
                onClick={() => removeFromCollection(col.id, image.id)}
                className="hover:text-white/60 transition-colors leading-none"
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
              className="bg-transparent text-white/60 text-xs outline-none cursor-pointer hover:text-white/90 transition-colors py-0.5"
            >
              <option value="" disabled>
                Add to collection…
              </option>
              {unassignedCollections.map((c) => (
                <option key={c.id} value={c.id} className="text-black bg-white">
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Delete button */}
        <div className="absolute bottom-4 right-6">
          <Button
            variant="destructive"
            size="sm"
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
