import { useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCloseLine,
  RiDownload2Line,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiFolderOpenLine,
  RiLoader4Line,
  RiPauseLine,
  RiPlayLine,
  RiSparkling2Line,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

import { useTags } from "@/hooks/use-tags";
import { useCollections } from "@/hooks/useCollections";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "@/lib/toast";
import { PostCard } from "@/components/PostCard";
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
  onOpenSettings?: () => void;
}

type EditState = {
  titleEditing: boolean;
  titleValue: string;
  notesValue: string;
  descriptionValue: string;
  tagInput: string;
  creatingCol: boolean;
  newColInput: string;
  analyzing: boolean;
  promptValue: string;
  generatingPrompt: boolean;
};

type EditAction =
  | { type: "imageChanged"; title: string; notes: string; description: string }
  | { type: "setTitleEditing"; value: boolean }
  | { type: "setTitleValue"; value: string }
  | { type: "setNotesValue"; value: string }
  | { type: "setDescriptionValue"; value: string }
  | { type: "setTagInput"; value: string }
  | { type: "setCreatingCol"; value: boolean }
  | { type: "setNewColInput"; value: string }
  | { type: "setAnalyzing"; value: boolean }
  | { type: "analysisDone"; title: string; description: string }
  | { type: "setGeneratingPrompt"; value: boolean }
  | { type: "promptDone"; value: string };

function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case "imageChanged":
      return {
        titleEditing: false,
        titleValue: action.title,
        notesValue: action.notes,
        descriptionValue: action.description,
        tagInput: "",
        creatingCol: false,
        newColInput: "",
        analyzing: false,
        promptValue: "",
        generatingPrompt: false,
      };
    case "setTitleEditing": return { ...state, titleEditing: action.value };
    case "setTitleValue": return { ...state, titleValue: action.value };
    case "setNotesValue": return { ...state, notesValue: action.value };
    case "setDescriptionValue": return { ...state, descriptionValue: action.value };
    case "setTagInput": return { ...state, tagInput: action.value };
    case "setCreatingCol": return { ...state, creatingCol: action.value, newColInput: "" };
    case "setNewColInput": return { ...state, newColInput: action.value };
    case "setAnalyzing": return { ...state, analyzing: action.value };
    case "analysisDone":
      return { ...state, analyzing: false, titleValue: action.title, descriptionValue: action.description };
    case "setGeneratingPrompt": return { ...state, generatingPrompt: action.value };
    case "promptDone": return { ...state, generatingPrompt: false, promptValue: action.value };
  }
}

function formatVideoTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
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
  onOpenSettings,
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

  const [edit, dispatch] = useReducer(editReducer, {
    titleEditing: false,
    titleValue: "",
    notesValue: "",
    descriptionValue: "",
    tagInput: "",
    creatingCol: false,
    newColInput: "",
    analyzing: false,
    promptValue: "",
    generatingPrompt: false,
  });
  const { titleEditing, titleValue, notesValue, descriptionValue, tagInput, creatingCol, newColInput, analyzing, promptValue, generatingPrompt } = edit;
  const tagInputRef = useRef<HTMLInputElement>(null);
  const titleTextareaRef = useRef<HTMLTextAreaElement>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const [notesFocused, setNotesFocused] = useState(false);
  const [tagInputFocused, setTagInputFocused] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoControlsVisible, setVideoControlsVisible] = useState(true);
  const videoIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubWasPlaying = useRef(false);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const displayImageRef = useRef<Image | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!colPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setColPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colPickerOpen]);

  useEffect(() => {
    if (currentIndex === null) return;
    (async () => {
      const key = await getSetting("api_key");
      if (key) { setAiReady(true); return; }
      const status = await invoke<{ present: boolean }>("get_local_model_status").catch(() => ({ present: false }));
      setAiReady(status.present);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  const image = currentIndex !== null ? images[currentIndex] : null;

  // Animation refs — keep last-known image/index so exit fade has content to show
  const hasOpenedRef = useRef(false);
  const lastImageRef = useRef<Image | null>(null);
  const lastIndexRef = useRef<number | null>(null);
  if (image) { hasOpenedRef.current = true; lastImageRef.current = image; }
  if (currentIndex !== null) lastIndexRef.current = currentIndex;
  const isOpen = currentIndex !== null;
  const displayImage = image ?? lastImageRef.current;
  const displayIndex = currentIndex ?? lastIndexRef.current;
  displayImageRef.current = displayImage;

  // Sync state when image changes
  useEffect(() => {
    if (image) {
      dispatch({
        type: "imageChanged",
        title: image.title ?? "",
        notes: image.notes ?? "",
        description: image.description ?? "",
      });
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setFileSize(null);
      setNotesFocused(false);
      setTagInputFocused(false);
      setDescFocused(false);
      invoke<number>("get_file_size", { filePath: image.file_path })
        .then(setFileSize)
        .catch(() => {});
    }
  }, [currentIndex, image?.id]);

  useEffect(() => {
    if (!titleEditing) return;
    const el = titleTextareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [titleEditing]);


  // Auto-analyze when image opens (if mode is not manual)
  useEffect(() => {
    if (!image) return;
    let cancelled = false;

    (async () => {
      if (image.kind === "video") return;
      const mode = await getSetting("analyze_mode");
      if (!mode || mode === "manual") return;
      if (mode === "auto_new" && image.description) return;

      if (!aiReady) return;
      const apiKey = (await getSetting("api_key")) ?? "";
      const model = (await getSetting("model")) ?? "anthropic/claude-sonnet-4-6";

      if (cancelled) return;
      dispatch({ type: "setAnalyzing", value: true });
      try {
        const result = await invoke<{ title: string; tags: string[]; description: string } | null>(
          "analyze_image",
          { thumbPath: image.thumb_path, apiKey, model }
        );
        if (!result || cancelled) return;
        onUpdateTitle(image.id, result.title);
        await Promise.all((imageTagsMap.get(image.id) ?? []).map(tag => removeTag(image.id, tag.id)));
        await Promise.all(result.tags.map(tag => addTag(image.id, tag)));
        onUpdateDescription(image.id, result.description);
        if (!cancelled) dispatch({ type: "analysisDone", title: result.title, description: result.description });
      } catch (err) {
        console.error("[keep] auto-analyze failed:", err);
      } finally {
        if (!cancelled) dispatch({ type: "setAnalyzing", value: false });
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id]);

  const handleAnalyzeRef = useRef<() => void>(() => {});
  const handleCopyRef = useRef<() => void>(() => {});
  const handleCopyVideoFrameRef = useRef<() => void>(() => {});

  // Keyboard navigation + zoom shortcuts
  useEffect(() => {
    if (currentIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        if (titleEditing && image) onUpdateTitle(image.id, titleValue.trim());
        onClose();
      } else if (e.key === "ArrowLeft" && !typing && currentIndex > 0) {
        onNavigate(currentIndex - 1);
      } else if (e.key === "ArrowRight" && !typing && currentIndex < images.length - 1) {
        onNavigate(currentIndex + 1);
      } else if ((e.key === "+" || e.key === "=") && !typing) {
        setZoom(z => Math.min(z * 1.5, 8));
      } else if (e.key === "-" && !typing) {
        setZoom(z => {
          const newZ = Math.max(z / 1.5, 1);
          if (newZ <= 1) { setPan({ x: 0, y: 0 }); return 1; }
          return newZ;
        });
      } else if (e.key === "0" && !typing) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === " " && !typing && videoRef.current) {
        e.preventDefault();
        videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
      } else if ((e.key === "Backspace" || e.key === "Delete") && !typing && image) {
        onDelete(image);
        onClose();
      } else if (e.key === "e" && !typing && image) {
        e.preventDefault();
        dispatch({ type: "setTitleEditing", value: true });
      } else if (e.key === "a" && !typing && !e.metaKey && !e.ctrlKey && image) {
        handleAnalyzeRef.current();
      } else if (e.key === "c" && (e.metaKey || e.ctrlKey) && !typing && image) {
        const hasSelection = !!window.getSelection()?.toString();
        if (!hasSelection) {
          const ext = image.file_path.split(".").pop()?.toLowerCase() ?? "";
          const isSvgKey = ext === "svg";
          const isVideoKey = image.kind === "video" || (image.kind === "link" && /\.(mp4|mov|webm)$/i.test(image.file_path));
          if (isVideoKey) {
            e.preventDefault();
            handleCopyVideoFrameRef.current();
          } else if (!isSvgKey) {
            e.preventDefault();
            handleCopyRef.current();
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIndex, images.length, onClose, onNavigate, titleEditing, titleValue, image, onUpdateTitle, onDelete]);

  // Scroll-to-zoom on image area (non-passive so we can preventDefault)
  useEffect(() => {
    if (!isOpen) return;
    const el = imageAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const di = displayImageRef.current;
      if (!di || di.kind === "video") return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.pow(1.12, -e.deltaY / 100);
      setZoom(z => {
        const newZoom = Math.min(Math.max(z * factor, 1), 8);
        if (newZoom <= 1) {
          setPan({ x: 0, y: 0 });
          return 1;
        }
        const ox = e.clientX - rect.left - rect.width / 2;
        const oy = e.clientY - rect.top - rect.height / 2;
        const ratio = newZoom / z;
        setPan(p => ({
          x: ox * (1 - ratio) + p.x * ratio,
          y: oy * (1 - ratio) + p.y * ratio,
        }));
        return newZoom;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isOpen]);

  // Global mouse handlers for panning
  useEffect(() => {
    if (!isOpen) return;
    const onMove = (e: MouseEvent) => {
      if (!isPanningRef.current || !panStartRef.current) return;
      const { mx, my, px, py } = panStartRef.current;
      setPan({ x: px + (e.clientX - mx), y: py + (e.clientY - my) });
    };
    const onUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setIsPanning(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isOpen]);

  if (!hasOpenedRef.current || !displayImage || displayIndex === null) return null;

  const isSvg = displayImage.file_path.toLowerCase().endsWith(".svg");
  const isVideo = displayImage.kind === "video";
  const isLink = displayImage.kind === "link";
  const isLinkVideo = isLink && /\.(mp4|mov|webm)$/i.test(displayImage.file_path);
  const imageTags = imageTagsMap.get(displayImage.id) ?? [];
  const imageCollections = imageCollectionsMap.get(displayImage.id) ?? [];
  const unassignedCollections = collections.filter(
    (c) => !imageCollections.some((ic) => ic.id === c.id)
  );

  let palette: string[] = [];
  try {
    palette = displayImage.palette ? (JSON.parse(displayImage.palette) as string[]) : [];
  } catch {
    // ignore malformed palette
  }

  const saveTitle = () => {
    if (!image) return;
    const trimmed = titleValue.trim();
    onUpdateTitle(image.id, trimmed);
    dispatch({ type: "setTitleEditing", value: false });
  };

  const handleAddTag = async (name: string) => {
    if (!image) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    await addTag(image.id, trimmed);
    dispatch({ type: "setTagInput", value: "" });
  };

  const handleAnalyze = async () => {
    if (!image || analyzing) return;
    if (!aiReady) {
      onOpenSettings?.();
      return;
    }
    const [storedKey, model, aiSource] = await Promise.all([
      getSetting("api_key"),
      getSetting("model"),
      getSetting("ai_source"),
    ]);
    const apiKey = aiSource === "cloud" ? (storedKey ?? "") : "";
    dispatch({ type: "setAnalyzing", value: true });
    try {
      const result = await invoke<{ title: string; tags: string[]; description: string } | null>(
        "analyze_image",
        { thumbPath: image.thumb_path, apiKey, model }
      );
      if (!result) return;
      onUpdateTitle(image.id, result.title);
      await Promise.all(imageTags.map(tag => removeTag(image.id, tag.id)));
      await Promise.all(result.tags.map(tag => addTag(image.id, tag)));
      onUpdateDescription(image.id, result.description);
      dispatch({ type: "analysisDone", title: result.title, description: result.description });
    } catch (err) {
      console.error("[keep] analyze failed:", err);
      const msg = typeof err === "string" ? err : "Analysis failed";
      toast.error(msg);
    } finally {
      dispatch({ type: "setAnalyzing", value: false });
    }
  };

  const handleGeneratePrompt = async () => {
    if (!image || generatingPrompt) return;
    const [storedKey, aiSource] = await Promise.all([getSetting("api_key"), getSetting("ai_source")]);
    const apiKey = aiSource === "cloud" ? (storedKey ?? "") : "";
    if (aiSource === "cloud" && !apiKey) {
      toast.error("Add your OpenRouter API key in Settings");
      return;
    }
    dispatch({ type: "setGeneratingPrompt", value: true });
    try {
      const result = await invoke<string>("generate_prompt", {
        thumbPath: image.thumb_path,
        apiKey,
        model: "google/gemini-2.5-flash",
      });
      dispatch({ type: "promptDone", value: result });
    } catch (err) {
      const msg = typeof err === "string" ? err : String(err);
      console.error("[keep] generate prompt failed:", msg);
      toast.error(`Prompt failed: ${msg}`);
      dispatch({ type: "setGeneratingPrompt", value: false });
    }
  };

  const handleExport = async () => {
    if (!image) return;
    const filename = image.file_path.split("/").pop() ?? "image";
    const destPath = await saveDialog({ defaultPath: `~/Downloads/${filename}` });
    if (!destPath) return;
    try {
      await invoke("export_original", { filePath: image.file_path, destPath });
    } catch {
      toast.error("Export failed");
    }
  };

  const handleCopy = async () => {
    if (!image) return;
    try {
      await invoke("copy_image_to_clipboard", { filePath: image.file_path });
      toast.success("Copied to clipboard", { duration: 1500 });
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleCopyVideoFrame = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const pngBase64 = canvas.toDataURL("image/png").split(",")[1];
      await invoke("copy_image_bytes_to_clipboard", { pngBase64 });
      toast.success("Frame copied", { duration: 1500 });
    } catch (err) {
      toast.error(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  handleAnalyzeRef.current = handleAnalyze;
  handleCopyRef.current = handleCopy;
  handleCopyVideoFrameRef.current = handleCopyVideoFrame;


  const date = new Date(displayImage.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const sourceHostname = displayImage.source_url
    ? (() => { try { return new URL(displayImage.source_url).hostname; } catch { return displayImage.source_url; } })()
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex lightbox-overlay"
      data-open={isOpen || undefined}
      style={{ background: isSvg
        ? "repeating-conic-gradient(#d0d0d0 0% 25%, #f8f8f8 0% 50%) 0 0 / 24px 24px"
        : (isLink && palette.length === 0 ? "#111" : buildMeshBackground(palette)) }}
    >
      {/* Image area */}
      <div ref={imageAreaRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
        {isVideo || isLinkVideo ? (
          <div
            className="group relative overflow-hidden rounded-xl shadow-2xl"
            onMouseMove={() => {
              setVideoControlsVisible(true);
              if (videoIdleTimer.current) clearTimeout(videoIdleTimer.current);
              videoIdleTimer.current = setTimeout(() => setVideoControlsVisible(false), 2000);
            }}
            onMouseLeave={() => {
              if (videoIdleTimer.current) clearTimeout(videoIdleTimer.current);
              setVideoControlsVisible(false);
            }}
          >
            <video
              ref={videoRef}
              key={displayImage.id}
              aria-label="Video player"
              src={imgSrc(displayImage.file_path)}
              crossOrigin="anonymous"
              autoPlay
              muted={videoMuted}
              className="block max-h-[65vh] max-w-full"
              draggable={false}
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.paused ? v.play() : v.pause();
              }}
              onPlay={() => setVideoPlaying(true)}
              onPause={() => setVideoPlaying(false)}
              onTimeUpdate={() => setVideoTime(videoRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => {
                setVideoDuration(videoRef.current?.duration ?? 0);
                setVideoTime(0);
                setVideoPlaying(true);
              }}
            />
            {/* Controls bar */}
            <div
              className="absolute right-0 bottom-0 left-0 flex items-center gap-2 px-3 pb-3 pt-8 transition-opacity duration-200"
              style={{
                background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.1) 70%, transparent 100%)",
                opacity: videoControlsVisible ? 1 : 0,
                pointerEvents: videoControlsVisible ? "auto" : "none",
              }}
            >
              {/* Play/pause */}
              <button
                className="text-white/90 hover:text-white transition-colors"
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.paused ? v.play() : v.pause();
                }}
              >
                {videoPlaying
                  ? <RiPauseLine className="size-4" />
                  : <RiPlayLine className="size-4" />}
              </button>
              {/* Scrubber */}
              <input
                type="range"
                min={0}
                max={videoDuration || 1}
                step={0.01}
                value={videoTime}
                onMouseDown={() => {
                  scrubWasPlaying.current = !videoRef.current?.paused;
                  videoRef.current?.pause();
                }}
                onMouseUp={() => { if (scrubWasPlaying.current) videoRef.current?.play(); }}
                onChange={(e) => {
                  const t = parseFloat(e.target.value);
                  setVideoTime(t);
                  if (videoRef.current) videoRef.current.currentTime = t;
                }}
                className="h-0.5 flex-1 appearance-none rounded-full bg-white/30 accent-white"
              />
              {/* Time */}
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/70">
                {formatVideoTime(videoTime)}&thinsp;/&thinsp;{formatVideoTime(videoDuration)}
              </span>
              {/* Mute */}
              <button
                className="text-white/70 hover:text-white transition-colors"
                onClick={() => {
                  setVideoMuted(m => !m);
                  if (videoRef.current) videoRef.current.muted = !videoMuted;
                }}
              >
                {videoMuted
                  ? <RiVolumeMuteLine className="size-3.5" />
                  : <RiVolumeUpLine className="size-3.5" />}
              </button>
            </div>
          </div>
        ) : isLink && displayImage.width === 0 ? (
          // Link with no usable image — show domain pill
          <div className="flex flex-col items-center gap-3 text-white/40 select-none">
            <RiExternalLinkLine className="size-12 opacity-30" />
            <span className="text-sm">
              {(() => {
                try {
                  const m = JSON.parse(displayImage.post_meta ?? "{}") as { siteName?: string; url?: string };
                  return m.siteName ?? m.url?.split("://")[1]?.split("/")[0] ?? "Link";
                } catch { return "Link"; }
              })()}
            </span>
          </div>
        ) : (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: "none",
              cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "auto",
            }}
            onMouseDown={(e) => {
              if (zoom <= 1) return;
              e.preventDefault();
              isPanningRef.current = true;
              setIsPanning(true);
              panStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
            }}
            onDoubleClick={() => {
              if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); }
              else setZoom(2);
            }}
          >
            <div className="p-8">
            <img
              key={displayImage.id}
              src={imgSrc(displayImage.file_path)}
              alt={displayImage.title ?? ""}
              className="max-h-[calc(90vh-4rem)] max-w-full object-contain lightbox-image"
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
          </div>
        )}

        {/* Zoom level indicator */}
        {zoom > 1 && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/80 backdrop-blur-sm select-none">
            {(Math.round(zoom * 10) / 10).toFixed(1)}×
          </div>
        )}

        {/* Prev button */}
        {displayIndex > 0 && (
          <button
            type="button"
            onClick={() => onNavigate(displayIndex - 1)}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-[transform,background-color] duration-[160ms] ease-out active:scale-[0.97]"
            aria-label="Previous image"
          >
            <RiArrowLeftLine className="h-5 w-5" />
          </button>
        )}

        {/* Next button */}
        {displayIndex < images.length - 1 && (
          <button
            type="button"
            onClick={() => onNavigate(displayIndex + 1)}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-[transform,background-color] duration-[160ms] ease-out active:scale-[0.97]"
            aria-label="Next image"
          >
            <RiArrowRightLine className="h-5 w-5" />
          </button>
        )}

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-[transform,background-color] duration-[160ms] ease-out active:scale-[0.97]"
          aria-label="Close lightbox"
        >
          <RiCloseLine className="h-5 w-5" />
        </button>
      </div>

      {/* Sidebar */}
      <div className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-white/10 bg-background/80 backdrop-blur-xl">

        {/* Title */}
        <div className="px-5 pb-2 pt-5">
          {analyzing ? (
            <div className="flex h-14 flex-col justify-start gap-2 pt-0.5">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : titleEditing ? (
            <textarea
              ref={titleTextareaRef}
              aria-label="Edit title"
              value={titleValue}
              rows={2}
              onChange={(e) => dispatch({ type: "setTitleValue", value: e.target.value })}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveTitle();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
              className="h-14 w-full resize-none border-b border-border/50 bg-transparent py-0 text-xl font-semibold leading-[1.75rem] outline-none"
            />
          ) : (
            <button
              type="button"
              className="block h-14 w-full cursor-text text-left"
              onClick={() => dispatch({ type: "setTitleEditing", value: true })}
            >
              <span className="line-clamp-2 text-xl font-semibold">
                {displayImage.title || "Untitled"}
              </span>
            </button>
          )}
        </div>

        {/* Link card metadata */}
        {isLink && <PostCard image={displayImage} />}

        {/* Description */}
        <div className="px-5 pb-3 pt-1">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Description</span>
            {!isSvg && !isLink && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors disabled:opacity-40 text-muted-foreground hover:bg-accent hover:text-foreground"
                title={!aiReady ? "Set up AI in Settings" : undefined}
              >
                {analyzing ? (
                  <><RiLoader4Line className="size-3 animate-spin" /> Analyzing…</>
                ) : aiReady ? (
                  <><RiSparkling2Line className="size-3" /> Analyze</>
                ) : (
                  <><RiSparkling2Line className="size-3 opacity-50" /><span className="opacity-50">Set up AI</span></>
                )}
              </button>
            )}
          </div>
          {analyzing ? (
            <div className="space-y-1.5 pt-0.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3.5 w-4/6" />
            </div>
          ) : descriptionValue || descFocused ? (
            <textarea
              ref={descRef}
              aria-label="Description"
              // biome-ignore lint/a11y/noAutofocus: intentional expand-on-click UX
              autoFocus={descFocused && !descriptionValue}
              value={descriptionValue}
              onChange={(e) => dispatch({ type: "setDescriptionValue", value: e.target.value })}
              onFocus={() => setDescFocused(true)}
              onBlur={() => { if (image) onUpdateDescription(image.id, descriptionValue); if (!descriptionValue) setDescFocused(false); }}
              placeholder="Write a description…"
              className="h-[70px] w-full resize-none overflow-y-auto bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          ) : (
            <button
              type="button"
              onClick={() => setDescFocused(true)}
              className="text-sm text-muted-foreground/40 transition-colors hover:text-muted-foreground/60"
            >
              No description yet…
            </button>
          )}
        </div>

        {/* Generation Prompt — header always visible, body only when active/generated */}
        {!isVideo && !isLink && (
          <div className="px-5 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Prompt</span>
              <button
                type="button"
                onClick={handleGeneratePrompt}
                disabled={generatingPrompt}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40"
              >
                {generatingPrompt
                  ? <><RiLoader4Line className="size-3 animate-spin" /> Generating…</>
                  : <><RiSparkling2Line className="size-3" /> Generate</>}
              </button>
            </div>
            {(generatingPrompt || promptValue) && (
              <div className="mt-1.5">
                {generatingPrompt ? (
                  <div className="space-y-1.5 pt-0.5">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-5/6" />
                    <Skeleton className="h-3.5 w-4/6" />
                  </div>
                ) : (
                  <div className="group relative max-h-48 overflow-y-auto">
                    <p className="pr-5 text-sm leading-relaxed text-foreground">{promptValue}</p>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(promptValue);
                        toast.success("Prompt copied", { duration: 1500 });
                      }}
                      className="absolute right-0 top-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Copy prompt"
                    >
                      <RiFileCopyLine className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Palette */}
        {palette.length > 0 && (
          <div className="px-5 pb-3">
            <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Colors</span>
            <div className="flex flex-wrap gap-2">
              {palette.map((color) => (
                <button
                  type="button"
                  key={color}
                  onClick={() => {
                    navigator.clipboard.writeText(color);
                    toast.success(`Copied ${color}`, { duration: 1500 });
                  }}
                  className="size-7 rounded-md ring-1 ring-black/20 transition-transform hover:scale-[1.06] active:scale-95"
                  style={{ backgroundColor: color }}
                  title={color}
                  aria-label={`Copy color ${color}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Separator: content → organisational */}
        <div className="mx-5 border-t border-border/40" />

        {/* Tags */}
        <div className="px-5 pb-3 pt-3">
          <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tags</span>
          {analyzing ? (
            <div className="flex flex-wrap gap-1.5">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-14 rounded-full" />
            </div>
          ) : (
          <div className="flex flex-wrap gap-1.5">
            {imageTags.map((tag) => (
              <Badge key={tag.id} variant="pill">
                {tag.name}
                <button
                  type="button"
                  onClick={() => removeTag(displayImage.id, tag.id)}
                  className="text-muted-foreground/60 hover:text-foreground transition-colors leading-none"
                  aria-label={`Remove tag ${tag.name}`}
                >
                  <RiCloseLine className="size-3" />
                </button>
              </Badge>
            ))}
            {tagInput || tagInputFocused ? (
              <input
                aria-label="Add tag"
                // biome-ignore lint/a11y/noAutofocus: intentional expand-on-click UX
                autoFocus
                ref={tagInputRef}
                list="lightbox-tag-suggestions"
                value={tagInput}
                onChange={(e) => dispatch({ type: "setTagInput", value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(tagInput); } }}
                onBlur={() => { if (!tagInput) setTagInputFocused(false); }}
                placeholder="tag name…"
                className="w-24 bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground/40"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTagInputFocused(true)}
                className="flex items-center py-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
                aria-label="Add tag"
              >
                <RiAddLine className="size-3.5" />
              </button>
            )}
            <datalist id="lightbox-tag-suggestions">
              {allTags.filter((t) => !imageTags.some((it) => it.id === t.id)).map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          </div>
          )}
        </div>

        {/* Collections */}
        <div className="px-5 pb-3">
          <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Collections</span>
          <div className="flex flex-wrap gap-1.5">
            {imageCollections.map((col) => (
              <Badge key={col.id} variant="pill">
                {col.name}
                <button
                  type="button"
                  onClick={() => removeFromCollection(col.id, displayImage.id)}
                  className="text-muted-foreground/60 hover:text-foreground transition-colors leading-none"
                  aria-label={`Remove from collection ${col.name}`}
                >
                  <RiCloseLine className="size-3" />
                </button>
              </Badge>
            ))}
            {/* Add to existing or create new — single dropdown, "New collection…" always first */}
            {creatingCol ? (
              <input
                aria-label="New collection name"
                // biome-ignore lint/a11y/noAutofocus: intentional expand-on-click UX
                autoFocus
                value={newColInput}
                onChange={(e) => dispatch({ type: "setNewColInput", value: e.target.value })}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    const trimmed = newColInput.trim();
                    if (trimmed) { const col = await createCollection(trimmed); await addToCollection(col.id, displayImage.id); }
                    dispatch({ type: "setCreatingCol", value: false });
                  }
                  if (e.key === "Escape") dispatch({ type: "setCreatingCol", value: false });
                }}
                onBlur={() => dispatch({ type: "setCreatingCol", value: false })}
                placeholder="Collection name…"
                className="w-32 bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground/40"
              />
            ) : (
              <div className="relative" ref={colPickerRef}>
                <button
                  type="button"
                  onClick={() => setColPickerOpen(v => !v)}
                  className="flex items-center py-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
                  aria-label="Add to collection"
                >
                  <RiAddLine className="size-3.5" />
                </button>
                {colPickerOpen && (
                  <div className="absolute left-0 top-full mt-1 z-10 min-w-[160px] rounded-lg border border-border bg-popover shadow-lg text-xs text-popover-foreground flex flex-col">
                    <div className="p-1 border-b border-border/50">
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        onMouseDown={(e) => { e.preventDefault(); setColPickerOpen(false); dispatch({ type: "setCreatingCol", value: true }); }}
                      >
                        New collection…
                      </button>
                    </div>
                    {unassignedCollections.length > 0 && (
                      <div className="overflow-y-auto max-h-[200px] p-1">
                        {unassignedCollections.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-foreground transition-colors"
                            onMouseDown={(e) => { e.preventDefault(); setColPickerOpen(false); addToCollection(c.id, displayImage.id); }}
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Notes — fills remaining sidebar space, scrolls internally */}
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-4">
          {notesValue || notesFocused ? (
            <>
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Notes</span>
              <textarea
                ref={notesTextareaRef}
                aria-label="Notes"
                // biome-ignore lint/a11y/noAutofocus: intentional expand-on-click UX
                autoFocus={notesFocused && !notesValue}
                value={notesValue}
                onChange={(e) => dispatch({ type: "setNotesValue", value: e.target.value })}
                onFocus={() => setNotesFocused(true)}
                onBlur={() => { onUpdateNotes(displayImage.id, notesValue); if (!notesValue) setNotesFocused(false); }}
                placeholder="Add a note…"
                className="min-h-12 w-full flex-1 resize-none overflow-y-auto bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setNotesFocused(true)}
              className="text-sm text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
            >
              Add a note…
            </button>
          )}
        </div>

        {/* Footer: source + metadata + actions + delete */}
        <div className="border-t border-border/30 px-5 py-3 text-xs text-muted-foreground">
          {sourceHostname && (
            <a
              href={displayImage.source_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2 flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <RiExternalLinkLine className="h-3 w-3 shrink-0" />
              <span className="truncate">{sourceHostname}</span>
            </a>
          )}
          <p>
            {displayImage.width > 0 && `${displayImage.width} × ${displayImage.height} · `}
            {displayImage.file_path.split(".").pop()?.toUpperCase()}
            {fileSize != null && ` · ${fileSize >= 1_048_576 ? `${(fileSize / 1_048_576).toFixed(1)} MB` : `${Math.round(fileSize / 1024)} KB`}`}
            {" · "}{date}
          </p>
          <div className="mt-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                title="Reveal in Finder"
                onClick={() => revealItemInDir(displayImage.file_path)}
                className="transition-colors hover:text-foreground"
              >
                <RiFolderOpenLine className="size-3.5" />
              </button>
              <button
                type="button"
                title="Export original"
                onClick={handleExport}
                className="transition-colors hover:text-foreground"
              >
                <RiDownload2Line className="size-3.5" />
              </button>
              {!isVideo && !isSvg && (
                <button
                  type="button"
                  title="Copy image"
                  onClick={handleCopy}
                  className="transition-colors hover:text-foreground"
                >
                  <RiFileCopyLine className="size-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => { onDelete(displayImage); onClose(); }}
              className="text-destructive/50 transition-colors hover:text-destructive"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
