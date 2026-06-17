import { useImages } from "@/hooks/use-images";

export default function Grid() {
  const { images, imgSrc } = useImages();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* toolbar */}
      <div
        data-tauri-drag-region
        className="flex h-11 flex-shrink-0 items-center border-b border-border px-4 gap-2"
      >
        <div className="flex-1" data-tauri-drag-region />
        <button className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity">
          + Add
        </button>
      </div>

      {images.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm select-none">
          Paste an image or click + Add
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
            {images.map((img) => (
              <div key={img.id} className="mb-3 break-inside-avoid overflow-hidden rounded-lg">
                <img
                  src={imgSrc(img.thumb_path)}
                  width={img.width}
                  height={img.height}
                  className="w-full object-cover"
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
