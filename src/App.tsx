import { useEffect, useReducer, useRef } from "react";
import { Toast } from "@base-ui/react/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastList } from "@/components/ui/toast-viewport";
import { toastManager } from "@/lib/toast";
import TopNav, { type Tab, type Sort, type TopNavHandle } from "@/components/TopNav";
import Grid from "@/components/Grid";
import { useCollections, CollectionsProvider } from "@/hooks/useCollections";
import { TagsProvider } from "@/hooks/use-tags";
import { ImagesProvider } from "@/hooks/use-images";

type ViewState = {
  activeTab: Tab;
  selectedId: string | null;
  searchQuery: string;
  sort: Sort;
  shuffleSeed: number;
};

type ViewAction =
  | { type: "setTab"; tab: Tab }
  | { type: "setSelectedId"; id: string | null }
  | { type: "setSearchQuery"; query: string }
  | { type: "setSort"; sort: Sort }
  | { type: "shuffle" };

function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "setTab":
      return { ...state, activeTab: action.tab, selectedId: null };
    case "setSelectedId":
      return { ...state, selectedId: action.id };
    case "setSearchQuery":
      return { ...state, searchQuery: action.query };
    case "setSort":
      return { ...state, sort: action.sort };
    case "shuffle":
      return { ...state, shuffleSeed: state.shuffleSeed + 1 };
  }
}

function AppContent() {
  const [view, dispatch] = useReducer(viewReducer, {
    activeTab: "all",
    selectedId: null,
    searchQuery: "",
    sort: "newest",
    shuffleSeed: 0,
  });
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
        if (view.activeTab === "collections") {
          e.preventDefault();
          topNavRef.current?.startNaming();
        }
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        topNavRef.current?.openHelp();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view.activeTab]);

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopNav
          ref={topNavRef}
          activeTab={view.activeTab}
          onTabChange={(tab) => dispatch({ type: "setTab", tab })}
          searchQuery={view.searchQuery}
          onSearchChange={(query) => dispatch({ type: "setSearchQuery", query })}
          sort={view.sort}
          onSortChange={(sort) => dispatch({ type: "setSort", sort })}
          onCreateCollection={handleCreateCollection}
          searchInputRef={searchInputRef}
          shuffleSeed={view.shuffleSeed}
          onShuffle={() => dispatch({ type: "shuffle" })}
        />
        <Grid
          activeTab={view.activeTab}
          sort={view.sort}
          searchQuery={view.searchQuery}
          selectedId={view.selectedId}
          onSelectId={(id) => dispatch({ type: "setSelectedId", id })}
          onCreateCollection={() => topNavRef.current?.startNaming()}
          shuffleSeed={view.shuffleSeed}
        />
      </div>
      <ToastList />
    </TooltipProvider>
  );
}

export default function App() {
  return (
    <ImagesProvider>
      <TagsProvider>
        <CollectionsProvider>
          <Toast.Provider toastManager={toastManager}>
            <AppContent />
          </Toast.Provider>
        </CollectionsProvider>
      </TagsProvider>
    </ImagesProvider>
  );
}
