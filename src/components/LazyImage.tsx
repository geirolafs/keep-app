import { cn } from "@/lib/utils";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { thumbHashToDataURL } from "thumbhash";

// 1×1 transparent GIF — valid image, no onError, zero visual footprint
const BLANK_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Module-level: persists across component mounts for the session lifetime.
// When a URL is in this set, LazyImage skips the IO and starts visible+loaded
// immediately — eliminates reloads when column count changes (which remounts
// images into different column <div>s, resetting per-component state).
const loadedSrcs = new Set<string>();

// ─── Shared IntersectionObserver context ─────────────────────────────────────
// Grid.tsx creates one IO rooted on the masonry scroll container and provides
// it here. rootMargin correctly extends *beyond* the scroll container's fold
// because the root is the container itself, not the window (which would be
// clipped by the overflow-y:auto ancestor and make rootMargin useless).

export interface LazyIO {
  observe: (el: Element, cb: () => void) => void;
  unobserve: (el: Element) => void;
}

export const LazyObserverContext = createContext<LazyIO | null>(null);

// ─── Component ───────────────────────────────────────────────────────────────

interface LazyImageProps {
  src: string;
  placeholder?: string; // dominant color — visible while thumb decodes
  thumbHash?: string;   // base64 ThumbHash — blurry LQIP shown before full thumb loads
  width?: number;
  height?: number;
  alt?: string;
  className?: string;
  draggable?: boolean;
}

export function LazyImage({
  src,
  placeholder,
  thumbHash,
  width,
  height,
  alt = "",
  className,
  draggable = false,
}: LazyImageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(() => loadedSrcs.has(src));
  const [loaded, setLoaded] = useState(() => loadedSrcs.has(src));
  const [error, setError] = useState(false);
  const lazyIO = useContext(LazyObserverContext);

  // On src change: jump to loaded if cached, otherwise reset so IO re-triggers.
  useEffect(() => {
    if (loadedSrcs.has(src)) {
      setInView(true);
      setLoaded(true);
    } else {
      setInView(false);
      setLoaded(false);
    }
  }, [src]);

  useEffect(() => {
    if (inView) return; // already visible — either cached or IO already fired
    const el = wrapperRef.current;
    if (!el) return;

    if (lazyIO) {
      lazyIO.observe(el, () => setInView(true));
      return () => lazyIO.unobserve(el);
    }

    // Fallback for LazyImage used outside the masonry grid (collection fan, etc.)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setInView(true); observer.disconnect(); }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [lazyIO, inView]);

  // Decode ThumbHash → tiny blurry data URL (memoised)
  const thumbHashDataURL = useMemo(() => {
    if (!thumbHash) return null;
    try {
      const binary = atob(thumbHash);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return thumbHashToDataURL(bytes);
    } catch {
      return null;
    }
  }, [thumbHash]);

  const aspectRatio = width && height ? `${width}/${height}` : undefined;

  // Background priority: ThumbHash > dominant color > bg-muted (class).
  // Never use a transparent fallback — that leaks the page background (often white)
  // through during the browser's 1-frame decode window, causing a white flash.
  const bgStyle: CSSProperties = thumbHashDataURL
    ? { backgroundImage: `url(${thumbHashDataURL})`, backgroundSize: "cover", backgroundPosition: "center" }
    : placeholder
    ? { backgroundColor: placeholder }
    : {};

  if (error) {
    return (
      <div
        className={cn("flex min-h-[80px] w-full items-center justify-center text-xs text-muted-foreground bg-muted", className)}
        style={{ aspectRatio, ...bgStyle }}
      >
        Missing
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={cn("relative w-full overflow-hidden bg-muted", className)}
      style={{ aspectRatio, ...bgStyle }}
    >
      <img
        src={inView ? src : BLANK_GIF}
        width={width}
        height={height}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out"
        draggable={draggable}
        decoding="async"
        style={{ opacity: loaded ? 1 : 0 }}
        onLoad={(e) => {
          // BLANK_GIF fires onLoad instantly on mount — ignore it.
          // Only mark the real image as loaded once the actual src has decoded.
          if (e.currentTarget.src === BLANK_GIF) return;
          loadedSrcs.add(src);
          setLoaded(true);
        }}
        onError={() => setError(true)}
      />
    </div>
  );
}
