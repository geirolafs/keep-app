import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Toast } from "@base-ui/react/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastList } from "@/components/ui/toast-viewport";
import { toastManager } from "@/lib/toast";
import TopNav, { type Tab, type Sort, type TopNavHandle } from "@/components/TopNav";
import Grid, { type GridHandle } from "@/components/Grid";
import { CmdKDialog } from "@/components/CmdKDialog";
import { useCollections, CollectionsProvider } from "@/hooks/useCollections";
import { TagsProvider } from "@/hooks/use-tags";
import { ImagesProvider } from "@/hooks/use-images";
import { useSettings } from "@/hooks/use-settings";

type ViewState = {
  activeTab: Tab;
  selectedId: string | null;
  searchQuery: string;
  sort: Sort;
  shuffleSeed: number;
};

type ViewAction =
  | { type: "setTab"; tab: Tab }
  | { type: "setTabAndSelect"; tab: Tab; selectedId: string }
  | { type: "setSelectedId"; id: string | null }
  | { type: "setSearchQuery"; query: string }
  | { type: "setSort"; sort: Sort }
  | { type: "shuffle" };

function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "setTab":
      return { ...state, activeTab: action.tab, selectedId: null };
    case "setTabAndSelect":
      return { ...state, activeTab: action.tab, selectedId: action.selectedId };
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
  const gridRef = useRef<GridHandle>(null);
  const navContainerRef = useRef<HTMLDivElement>(null);
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const [numCols, setNumCols] = useState(4);
  const [numColsManual, setNumColsManual] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [navHeight, setNavHeight] = useState(0);
  const { getSetting, setSetting } = useSettings();

  useEffect(() => {
    getSetting("col_count").then((v) => {
      if (v) { setNumCols(parseInt(v)); setNumColsManual(true); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!navContainerRef.current) return;
    const ro = new ResizeObserver(([e]) => setNavHeight(e.contentRect.height));
    ro.observe(navContainerRef.current);
    return () => ro.disconnect();
  }, []);

  const handleNumColsChange = (n: number) => {
    setNumCols(n);
    setNumColsManual(true);
    setSetting("col_count", String(n));
  };

  const handleAutoNumCols = useCallback((n: number) => {
    setNumCols(n);
  }, []);

  const { createCollection } = useCollections();

  const handleCreateCollection = (name: string) => {
    if (name.trim()) createCollection(name.trim());
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdKOpen(true);
      }
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

  useEffect(() => {
    const unlisten = listen("open-settings", () => {
      topNavRef.current?.openSettings();
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  return (
    <TooltipProvider>
      <div className="relative h-screen overflow-hidden bg-background text-foreground">
        <div ref={navContainerRef} data-tauri-drag-region className="absolute top-0 left-0 right-0 z-10">
        <TopNav
          ref={topNavRef}
          scrolled={scrolled}
          activeTab={view.activeTab}
          onTabChange={(tab) => { setScrolled(false); dispatch({ type: "setTab", tab }); }}
          searchQuery={view.searchQuery}
          onSearchChange={(query) => dispatch({ type: "setSearchQuery", query })}
          sort={view.sort}
          onSortChange={(sort) => dispatch({ type: "setSort", sort })}
          onCreateCollection={handleCreateCollection}
          searchInputRef={searchInputRef}
          shuffleSeed={view.shuffleSeed}
          onShuffle={() => dispatch({ type: "shuffle" })}
          numCols={numCols}
          onNumColsChange={handleNumColsChange}
          onAddFiles={() => gridRef.current?.openFilePicker()}
          onLogoClick={() => gridRef.current?.scrollToTop()}
        />
        </div>
        <Grid
          onScrolledChange={setScrolled}
          navHeight={navHeight}
          ref={gridRef}
          activeTab={view.activeTab}
          sort={view.sort}
          searchQuery={view.searchQuery}
          selectedId={view.selectedId}
          onSelectId={(id) => dispatch({ type: "setSelectedId", id })}
          onCreateCollection={() => topNavRef.current?.startNaming()}
          shuffleSeed={view.shuffleSeed}
          numCols={numCols}
          numColsManual={numColsManual}
          onAutoNumCols={handleAutoNumCols}
          onOpenSettings={() => topNavRef.current?.openSettings()}
        />
      </div>
      <CmdKDialog
        open={cmdKOpen}
        onClose={() => setCmdKOpen(false)}
        onOpenImage={(id) => {
          dispatch({ type: "setTab", tab: "all" });
          gridRef.current?.openImage(id);
        }}
        onOpenCollection={(id) => dispatch({ type: "setTabAndSelect", tab: "collections", selectedId: id })}
        onOpenTag={(id) => dispatch({ type: "setTabAndSelect", tab: "tags", selectedId: id })}
      />
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
