import { useMemo, useState } from "react";
import { RiFolder2Line, RiPriceTag3Line } from "@remixicon/react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useImages } from "@/hooks/use-images";
import { useTags } from "@/hooks/use-tags";
import { useCollections } from "@/hooks/useCollections";

interface CmdKDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenImage: (id: string) => void;
  onOpenCollection: (id: string) => void;
  onOpenTag: (id: string) => void;
}

export function CmdKDialog({
  open,
  onClose,
  onOpenImage,
  onOpenCollection,
  onOpenTag,
}: CmdKDialogProps) {
  const { images, imgSrc } = useImages();
  const { allTags, imageTagsMap } = useTags();
  const { collections, getCollectionImageIds } = useCollections();

  const [query, setQuery] = useState("");

  const { imageResults, colResults, tagResults } = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) {
      return {
        imageResults: images.slice(0, 8).map((img) => ({
          id: img.id,
          title: img.title ?? "Untitled",
          thumbPath: img.thumb_path,
        })),
        colResults: [],
        tagResults: [],
      };
    }

    const imageResults = images
      .filter((img) => {
        const tagNames = (imageTagsMap.get(img.id) ?? []).map((t) =>
          t.name.toLowerCase()
        );
        return (
          (img.title ?? "").toLowerCase().includes(q) ||
          (img.description ?? "").toLowerCase().includes(q) ||
          (img.source_url ?? "").toLowerCase().includes(q) ||
          (img.ocr_text ?? "").toLowerCase().includes(q) ||
          tagNames.some((t) => t.includes(q))
        );
      })
      .slice(0, 6)
      .map((img) => ({
        id: img.id,
        title: img.title ?? "Untitled",
        thumbPath: img.thumb_path,
      }));

    const colResults = collections
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((c) => ({
        id: c.id,
        name: c.name,
        count: getCollectionImageIds(c.id).size,
      }));

    const tagResults = allTags
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((t) => ({
        id: t.id,
        name: t.name,
        count: images.filter((img) =>
          (imageTagsMap.get(img.id) ?? []).some((it) => it.id === t.id)
        ).length,
      }));

    return { imageResults, colResults, tagResults };
  }, [query, images, imageTagsMap, collections, allTags, getCollectionImageIds]);

  const hasResults =
    imageResults.length > 0 || colResults.length > 0 || tagResults.length > 0;

  const close = () => {
    onClose();
    setQuery("");
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => { if (!o) close(); }}
      title="Search"
      description="Search images, collections, and tags"
      showCloseButton={false}
      className="top-[15vh] translate-y-0 p-0! max-w-lg"
    >
      <Command shouldFilter={false} className="rounded-4xl">
        <CommandInput
          placeholder="Search images, collections, tags…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-[360px]">
          {!hasResults && <CommandEmpty>No results</CommandEmpty>}

          {imageResults.length > 0 && (
            <CommandGroup heading={query ? "Images" : "Recent"}>
              {imageResults.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`image:${item.id}`}
                  onSelect={() => { close(); onOpenImage(item.id); }}
                  className="gap-3"
                >
                  <img
                    src={imgSrc(item.thumbPath)}
                    alt=""
                    className="size-8 shrink-0 rounded-md object-cover"
                  />
                  <span className="truncate">{item.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {colResults.length > 0 && (
            <>
              {imageResults.length > 0 && <CommandSeparator />}
              <CommandGroup heading="Collections">
                {colResults.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`col:${item.id}`}
                    onSelect={() => { close(); onOpenCollection(item.id); }}
                  >
                    <RiFolder2Line className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.count}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {tagResults.length > 0 && (
            <>
              {(imageResults.length > 0 || colResults.length > 0) && <CommandSeparator />}
              <CommandGroup heading="Tags">
                {tagResults.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`tag:${item.id}`}
                    onSelect={() => { close(); onOpenTag(item.id); }}
                  >
                    <RiPriceTag3Line className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.count}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
