import { useEffect, useRef, useState } from "react";
import { Toast } from "@base-ui/react/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastList } from "@/components/ui/toast-viewport";
import { toastManager } from "@/lib/toast";
import TopNav, { type Tab, type Sort, type TopNavHandle } from "@/components/TopNav";
import Grid from "@/components/Grid";
import { useCollections, CollectionsProvider } from "@/hooks/useCollections";
import { TagsProvider } from "@/hooks/use-tags";

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const topNavRef = useRef<TopNavHandle>(null);

  const { createCollection } = useCollections();

  const handleCreateCollection = (name: string) => {
    if (name.trim()) createCollection(name.trim());
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        if (activeTab === "collections") {
          e.preventDefault();
          topNavRef.current?.startNaming();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab]);

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopNav
          ref={topNavRef}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sort={sort}
          onSortChange={setSort}
          onCreateCollection={handleCreateCollection}
          searchInputRef={searchInputRef}
        />
        <Grid
          activeTab={activeTab}
          sort={sort}
          searchQuery={searchQuery}
          selectedId={selectedId}
          onSelectId={setSelectedId}
          onCreateCollection={() => topNavRef.current?.startNaming()}
        />
      </div>
      <ToastList />
    </TooltipProvider>
  );
}

export default function App() {
  return (
    <TagsProvider>
      <CollectionsProvider>
        <Toast.Provider toastManager={toastManager}>
          <AppContent />
        </Toast.Provider>
      </CollectionsProvider>
    </TagsProvider>
  );
}
