import { RiCloseLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import type { Image } from "@/hooks/use-images";

interface Props {
  image: Image | null;
  onClose: () => void;
  onDelete: (image: Image) => void;
  imgSrc: (path: string) => string;
}

export function ImageDetail({ image, onClose, onDelete, imgSrc }: Props) {
  const palette: string[] = (() => {
    if (!image?.palette) return [];
    try {
      return JSON.parse(image.palette) as string[];
    } catch {
      return [];
    }
  })();

  return (
    <div
      className={[
        "fixed top-0 right-0 h-screen w-80 bg-background border-l border-border z-50",
        "flex flex-col transition-transform duration-200 ease-in-out",
        image ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
    >
      {image && (
        <>
          {/* header */}
          <div className="flex h-11 flex-shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-sm font-medium">Detail</span>
            <button
              onClick={onClose}
              className="rounded p-1 hover:bg-muted transition-colors"
              aria-label="Close detail panel"
            >
              <RiCloseLine className="h-4 w-4" />
            </button>
          </div>

          {/* scrollable content */}
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            {/* image preview */}
            <img
              src={imgSrc(image.file_path)}
              alt=""
              className="w-full object-contain max-h-64 rounded-md bg-muted"
              draggable={false}
            />

            {/* info */}
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs uppercase tracking-wide font-medium">
                Info
              </span>
              <span>
                {image.width} × {image.height}
              </span>
              <span className="text-muted-foreground">
                {new Date(image.created_at).toLocaleDateString()}
              </span>
              {image.source_url && (
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={image.source_url}
                >
                  {image.source_url}
                </span>
              )}
            </div>

            {/* palette */}
            {palette.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs uppercase tracking-wide font-medium">
                  Colors
                </span>
                <div className="flex flex-wrap gap-2">
                  {palette.map((hex) => (
                    <span
                      key={hex}
                      className="w-6 h-6 rounded-full inline-block border border-border"
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* footer */}
          <div className="flex-shrink-0 border-t border-border p-4">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => { onDelete(image); onClose(); }}
            >
              Delete
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
