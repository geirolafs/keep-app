import { useState } from "react";
import { RiDeleteBin2Line, RiArrowGoBackLine, RiDeleteBinLine } from "@remixicon/react";
import { useImages } from "@/hooks/use-images";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";

type ConfirmState =
  | { type: "single"; id: string; file_path: string; thumb_path: string }
  | { type: "batch"; ids: string[] }
  | { type: "empty" };

export function BinView() {
  const { binImages, imgSrc, restoreImage, permanentDelete, emptyBin } = useImages();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);

  const toggleSelect = (id: string, idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIdx !== null) {
        const [start, end] = [Math.min(idx, lastClickedIdx), Math.max(idx, lastClickedIdx)];
        for (let i = start; i <= end; i++) {
          next.add(binImages[i].id);
        }
      } else if (e.metaKey || e.ctrlKey) {
        if (next.has(id)) next.delete(id); else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
    setLastClickedIdx(idx);
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    if (confirm.type === "single") {
      await permanentDelete(confirm.id, confirm.file_path, confirm.thumb_path);
    } else if (confirm.type === "batch") {
      for (const id of confirm.ids) {
        const img = binImages.find((i) => i.id === id);
        if (img) await permanentDelete(img.id, img.file_path, img.thumb_path);
      }
      setSelectedIds(new Set());
    } else if (confirm.type === "empty") {
      await emptyBin();
      setSelectedIds(new Set());
    }
    setConfirm(null);
  };

  const handleRestoreBatch = async () => {
    for (const id of selectedIds) {
      await restoreImage(id);
    }
    setSelectedIds(new Set());
  };

  const confirmTitle =
    confirm?.type === "empty"
      ? "Empty Bin?"
      : confirm?.type === "batch"
        ? `Delete ${confirm.ids.length} item${confirm.ids.length !== 1 ? "s" : ""}?`
        : "Delete Forever?";

  const confirmMessage =
    confirm?.type === "empty"
      ? `Permanently delete all ${binImages.length} items? This cannot be undone.`
      : confirm?.type === "batch"
        ? `Permanently delete ${(confirm as { type: "batch"; ids: string[] }).ids.length} item${(confirm as { type: "batch"; ids: string[] }).ids.length !== 1 ? "s" : ""}? This cannot be undone.`
        : "Permanently delete this item? This cannot be undone.";

  if (binImages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <RiDeleteBin2Line className="size-10 opacity-30" />
        <p className="text-sm">Bin is empty</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {binImages.length} item{binImages.length !== 1 ? "s" : ""} in Bin
        </span>
        <div className="ml-auto flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleRestoreBatch}>
                <RiArrowGoBackLine className="mr-1.5 size-3.5" />
                Restore {selectedIds.size}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/50 hover:bg-destructive/10"
                onClick={() => setConfirm({ type: "batch", ids: [...selectedIds] })}
              >
                <RiDeleteBinLine className="mr-1.5 size-3.5" />
                Delete Forever {selectedIds.size}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/50 hover:bg-destructive/10"
            onClick={() => setConfirm({ type: "empty" })}
          >
            Empty Bin
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {binImages.map((img, idx) => {
            const selected = selectedIds.has(img.id);
            return (
              <div
                key={img.id}
                className={[
                  "group relative overflow-hidden cursor-pointer rounded-sm border-2 transition-colors",
                  selected ? "border-primary" : "border-transparent",
                ].join(" ")}
                onClick={(e) => toggleSelect(img.id, idx, e)}
              >
                {img.kind === "video" ? (
                  <video
                    src={imgSrc(img.thumb_path)}
                    className="aspect-square w-full object-cover"
                    muted
                    playsInline
                    style={{ display: "block" }}
                  />
                ) : (
                  <img
                    src={imgSrc(img.thumb_path)}
                    alt={img.title ?? ""}
                    className="aspect-square w-full object-cover"
                    style={{ display: "block" }}
                  />
                )}

                {/* Hover actions */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-white/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); restoreImage(img.id); }}
                  >
                    <RiArrowGoBackLine className="size-3.5" /> Restore
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-medium text-red-300 backdrop-blur-sm hover:bg-red-500/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setConfirm({ type: "single", id: img.id, file_path: img.file_path, thumb_path: img.thumb_path }); }}
                  >
                    <RiDeleteBinLine className="size-3.5" /> Delete Forever
                  </button>
                </div>

                {/* Deleted date */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] text-white/70 truncate">
                    {img.deleted_at ? new Date(img.deleted_at).toLocaleDateString() : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirmTitle}
        description={confirmMessage}
        confirmLabel="Delete Forever"
        onConfirm={handleConfirm}
      />
    </div>
  );
}
