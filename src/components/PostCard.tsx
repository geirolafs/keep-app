import { RiExternalLinkLine, RiTwitterLine } from "@remixicon/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Image } from "@/hooks/use-images";

interface PostMeta {
  platform: "twitter" | "web";
  url: string;
  title?: string | null;
  description?: string | null;
  siteName?: string | null;
  imageUrl?: string | null;
  authorName?: string | null;
}

export function PostCard({ image }: { image: Image }) {
  let meta: PostMeta | null = null;
  try {
    meta = image.post_meta ? (JSON.parse(image.post_meta) as PostMeta) : null;
  } catch {}
  if (!meta) return null;

  const displayUrl = meta.url;
  const domain = displayUrl.split("://")[1]?.split("/")[0] ?? displayUrl;
  const label = meta.siteName ?? domain;

  return (
    <div className="border-b border-border/50 px-5 py-3">
      <div className="mb-2">
        {meta.platform === "twitter" ? (
          <RiTwitterLine className="size-4 text-muted-foreground" />
        ) : (
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Link</span>
        )}
      </div>
      <div className="space-y-1.5">
        {meta.authorName && (
          <p className="text-xs text-muted-foreground">{meta.authorName}</p>
        )}
        {meta.title && (
          <p className="text-sm font-semibold leading-snug">{meta.title}</p>
        )}
        {meta.description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {meta.description}
          </p>
        )}
        <button
          type="button"
          onClick={() => openUrl(displayUrl).catch(() => {})}
          className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RiExternalLinkLine className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      </div>
    </div>
  );
}
