import { type RefObject } from "react";
import { RiSearchLine } from "@remixicon/react";
import { MoodLogo } from "@/components/MoodLogo";

export type Tab = "all" | "collections" | "tags";
export type Sort = "newest" | "oldest";

interface TopNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sort: Sort;
  onSortChange: (s: Sort) => void;
  onCreateCollection: () => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "collections", label: "Collections" },
  { id: "tags", label: "Tags" },
];

export default function TopNav({
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  sort,
  onSortChange,
  onCreateCollection,
  searchInputRef,
}: TopNavProps) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-11 flex-shrink-0 items-center border-b border-border bg-background pl-[80px] pr-4 gap-4"
    >
      {/* Logo */}
      <MoodLogo className="h-4 w-auto shrink-0 select-none" />

      {/* Tabs — center */}
      <div className="flex flex-1 items-center justify-center gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={[
              "px-3 py-1 text-xs transition-colors relative",
              activeTab === tab.id
                ? "text-foreground font-medium border-b-2 border-foreground -mb-px"
                : "text-muted-foreground hover:text-foreground font-medium",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Right controls */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <div className="relative">
          <RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="h-7 w-48 rounded-4xl border border-input bg-input/30 pl-7 pr-3 py-1 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as Sort)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>

        {activeTab === "collections" && (
          <button
            onClick={onCreateCollection}
            className="h-7 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            + Collection
          </button>
        )}
      </div>
    </div>
  );
}
