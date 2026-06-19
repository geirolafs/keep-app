import { ContextMenu } from "@base-ui/react/context-menu";
import {
	RiAlbumLine,
	RiClipboardLine,
	RiFolderOpenLine,
	RiImageAddLine,
	RiLoader4Line,
	RiPriceTag2Line,
	RiTwitterLine,
	RiUploadLine,
} from "@remixicon/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { toastManager } from "@/lib/toast";
import type { Ref } from "react";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { BinView } from "@/components/BinView";
import type { LazyIO } from "@/components/LazyImage";
import { LazyImage, LazyObserverContext } from "@/components/LazyImage";
import { Lightbox } from "@/components/Lightbox";
import type { Sort, Tab } from "@/components/TopNav";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { type PendingItem, useImages } from "@/hooks/use-images";
import { useTags } from "@/hooks/use-tags";
import { useCollections } from "@/hooks/useCollections";
import { cn } from "@/lib/utils";

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"bmp",
	"tiff",
	"tif",
	"svg",
	"jxl",
	"heic",
	"heif",
	"mp4",
	"mov",
	"webm",
]);

type ConfirmDeleteState =
	| { type: "collection"; id: string; name: string }
	| { type: "tag"; id: string; name: string }
	| { type: "batch"; count: number };

type GridUIState = {
	isDragging: boolean;
	openId: string | null;
	selectedIds: Set<string>;
	confirmDelete: ConfirmDeleteState | null;
	batchTagInput: string;
	renaming: { type: "collection" | "tag"; id: string } | null;
	renameValue: string;
};

type GridUIAction =
	| { type: "dragStart" }
	| { type: "dragEnd" }
	| { type: "setOpenId"; id: string | null }
	| { type: "openAndClearSelection"; id: string }
	| { type: "toggleSelect"; id: string }
	| { type: "clearSelection" }
	| { type: "tabChanged" }
	| { type: "setConfirmDelete"; state: ConfirmDeleteState | null }
	| { type: "setBatchTagInput"; value: string }
	| { type: "clearBatchTagInput" }
	| {
			type: "startRename";
			kind: "collection" | "tag";
			id: string;
			currentName: string;
	  }
	| { type: "setRenameValue"; value: string }
	| { type: "commitRename" }
	| { type: "cancelRename" };

function gridUIReducer(state: GridUIState, action: GridUIAction): GridUIState {
	switch (action.type) {
		case "dragStart":
			return { ...state, isDragging: true };
		case "dragEnd":
			return { ...state, isDragging: false };
		case "setOpenId":
			return { ...state, openId: action.id };
		case "openAndClearSelection":
			return { ...state, openId: action.id, selectedIds: new Set() };
		case "toggleSelect": {
			const next = new Set(state.selectedIds);
			if (next.has(action.id)) next.delete(action.id);
			else next.add(action.id);
			return { ...state, selectedIds: next };
		}
		case "clearSelection":
			return { ...state, selectedIds: new Set() };
		case "tabChanged":
			return { ...state };
		case "setConfirmDelete":
			return { ...state, confirmDelete: action.state };
		case "setBatchTagInput":
			return { ...state, batchTagInput: action.value };
		case "clearBatchTagInput":
			return { ...state, batchTagInput: "" };
		case "startRename":
			return {
				...state,
				renaming: { type: action.kind, id: action.id },
				renameValue: action.currentName,
			};
		case "setRenameValue":
			return { ...state, renameValue: action.value };
		case "commitRename":
			return { ...state, renaming: null, renameValue: "" };
		case "cancelRename":
			return { ...state, renaming: null, renameValue: "" };
	}
}

const INITIAL_GRID_UI: GridUIState = {
	isDragging: false,
	openId: null,
	selectedIds: new Set(),
	confirmDelete: null,
	batchTagInput: "",
	renaming: null,
	renameValue: "",
};

function getExt(path: string) {
	return path.split(".").pop()?.toLowerCase() ?? "";
}

export interface GridHandle {
	openImage: (id: string) => void;
	openFilePicker: () => void;
	scrollToTop: () => void;
}

interface GridProps {
	activeTab?: Tab;
	sort?: Sort;
	searchQuery?: string;
	selectedId?: string | null;
	onSelectId?: (id: string | null) => void;
	onCreateCollection?: () => void;
	shuffleSeed?: number;
	numCols?: number;
	numColsManual?: boolean;
	onAutoNumCols?: (n: number) => void;
	onScrolledChange?: (scrolled: boolean) => void;
	navHeight?: number;
	onOpenSettings?: () => void;
	ref?: Ref<GridHandle>;
}

export default function Grid({
	activeTab = "all",
	sort = "newest",
	searchQuery = "",
	selectedId = null,
	onSelectId,
	onCreateCollection,
	shuffleSeed = 0,
	numCols = 4,
	numColsManual = false,
	onAutoNumCols,
	onScrolledChange,
	navHeight = 0,
	onOpenSettings,
	ref,
}: GridProps) {
	const {
		images: allImages,
		pendingItems,
		imgSrc,
		savePath,
		softDelete,
		updateTitle,
		updateNotes,
		updateDescription,
	} = useImages();
	const { imageTagsMap, addTag, deleteTag, renameTag } = useTags();
	const {
		collections,
		getCollectionImageIds,
		getCollectionThumbs,
		deleteCollection,
		renameCollection,
		addToCollection,
	} = useCollections();

	const [gridUI, dispatch] = useReducer(gridUIReducer, INITIAL_GRID_UI);
	const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
	const {
		isDragging,
		openId,
		selectedIds,
		confirmDelete,
		batchTagInput,
		renaming,
		renameValue,
	} = gridUI;
	const renameInputRef = useRef<HTMLInputElement>(null);
	const tagHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [visibleCount, setVisibleCount] = useState(100);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const activeScrollRef = useRef<HTMLDivElement | null>(null);
	// useState (not useRef) so the LazyObserverContext.Provider re-renders when the
	// masonry div mounts and we have a real root for the shared IntersectionObserver.
	const [masonryEl, setMasonryEl] = useState<HTMLDivElement | null>(null);
	const [activeScrollEl, setActiveScrollEl] = useState<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!masonryEl) return;
		const ro = new ResizeObserver(([entry]) => {
			if (numColsManual) return;
			const w = entry.contentRect.width;
			const n = w >= 1280 ? 5 : w >= 1024 ? 4 : w >= 640 ? 3 : 2;
			onAutoNumCols?.(n);
		});
		ro.observe(masonryEl);
		return () => ro.disconnect();
	}, [masonryEl, numColsManual, onAutoNumCols]);

	useEffect(() => {
		if (!activeScrollEl || !onScrolledChange) return;
		activeScrollEl.scrollTop = 0;
		onScrolledChange(false);
		const handler = () => onScrolledChange(activeScrollEl.scrollTop > 20);
		activeScrollEl.addEventListener("scroll", handler, { passive: true });
		return () => activeScrollEl.removeEventListener("scroll", handler);
	}, [activeScrollEl, onScrolledChange]);

	// Co-occurrence map: tagId → Map<tagId, sharedImageCount>
	const tagCoOccur = useMemo(() => {
		const map = new Map<string, Map<string, number>>();
		for (const tags of imageTagsMap.values()) {
			for (const a of tags) {
				if (!map.has(a.id)) map.set(a.id, new Map());
				for (const b of tags) {
					if (b.id === a.id) continue;
					const inner = map.get(a.id)!;
					inner.set(b.id, (inner.get(b.id) ?? 0) + 1);
				}
			}
		}
		return map;
	}, [imageTagsMap]);

	// One shared IntersectionObserver rooted on the masonry scroll container.
	// rootMargin: "800px" extends 800px beyond the container's visible fold —
	// this correctly prefetches images ahead of scroll without being clipped
	// by the overflow-y:auto ancestor (which would nullify root:null rootMargin).
	const lazyIO = useMemo<LazyIO | null>(() => {
		if (!masonryEl) return null;
		const callbacks = new Map<Element, () => void>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						callbacks.get(entry.target)?.();
						observer.unobserve(entry.target);
						callbacks.delete(entry.target);
					}
				}
			},
			{ root: masonryEl, rootMargin: "4000px" },
		);
		return {
			observe(el, cb) {
				callbacks.set(el, cb);
				observer.observe(el);
			},
			unobserve(el) {
				observer.unobserve(el);
				callbacks.delete(el);
			},
		};
	}, [masonryEl]);
	const shuffleOrderRef = useRef<Map<string, number> | null>(null);
	const prevShuffleSeedRef = useRef<number>(0);
	useEffect(() => {
		if (shuffleSeed > 0) {
			// Full re-shuffle when seed changes; preserve positions for new-image additions.
			const seedChanged = shuffleSeed !== prevShuffleSeedRef.current;
			prevShuffleSeedRef.current = shuffleSeed;
			const existing = seedChanged ? new Map<string, number>() : (shuffleOrderRef.current ?? new Map<string, number>());
			const map = new Map<string, number>();
			for (const img of allImages) {
				map.set(img.id, existing.get(img.id) ?? Math.random());
			}
			shuffleOrderRef.current = map;
		} else {
			prevShuffleSeedRef.current = 0;
			shuffleOrderRef.current = null;
		}
	}, [shuffleSeed, allImages]); // eslint-disable-line react-hooks/exhaustive-deps

	// Compute filtered + sorted images
	const filteredImages = (() => {
		let imgs = [...allImages];

		if (activeTab === "collections" && selectedId) {
			const ids = getCollectionImageIds(selectedId);
			imgs = imgs.filter((img) => ids.has(img.id));
		} else if (activeTab === "tags" && selectedId) {
			imgs = imgs.filter((img) => {
				const tags = imageTagsMap.get(img.id) ?? [];
				return tags.some((t) => t.id === selectedId);
			});
		}

		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			imgs = imgs.filter(
				(img) =>
					img.title?.toLowerCase().includes(q) ||
					img.source_url?.toLowerCase().includes(q) ||
					img.description?.toLowerCase().includes(q) ||
					img.ocr_text?.toLowerCase().includes(q) ||
					(imageTagsMap.get(img.id) ?? []).some((t) =>
						t.name.toLowerCase().includes(q),
					),
			);
		}

		if (shuffleSeed > 0 && shuffleOrderRef.current) {
			const order = shuffleOrderRef.current;
			imgs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
		} else {
			if (sort === "name-az" || sort === "name-za") {
				imgs.sort((a, b) => {
					const na = (a.title ?? a.file_path ?? "").toLowerCase();
					const nb = (b.title ?? b.file_path ?? "").toLowerCase();
					return sort === "name-az"
						? na.localeCompare(nb) || a.id.localeCompare(b.id)
						: nb.localeCompare(na) || b.id.localeCompare(a.id);
				});
			} else {
				imgs.sort((a, b) =>
					sort === "newest"
						? (b.created_at ?? 0) - (a.created_at ?? 0) || b.id.localeCompare(a.id)
						: (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id),
				);
			}
		}

		return imgs;
	})();

	const currentIndex = openId
		? filteredImages.findIndex((i) => i.id === openId)
		: -1;

	// Adjust during render: clear selection + reset pagination when filters/tab change
	const filterKey = `${activeTab}|${sort}|${searchQuery}|${selectedId ?? ""}`;
	const [prevSync, setPrevSync] = useState({ tab: activeTab, filterKey });
	if (prevSync.tab !== activeTab) {
		setPrevSync({ tab: activeTab, filterKey });
		dispatch({ type: "tabChanged" });
		setVisibleCount(50);
	} else if (prevSync.filterKey !== filterKey) {
		setPrevSync({ tab: activeTab, filterKey });
		setVisibleCount(50);
	}

	// Sentinel: load more DOM nodes as user scrolls
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el || visibleCount >= filteredImages.length) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) setVisibleCount((n) => n + 50);
			},
			{ root: masonryEl ?? null, rootMargin: "600px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [visibleCount, filteredImages.length, masonryEl]);

	// Tauri drag-drop listener
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let mounted = true;

		getCurrentWebviewWindow()
			.onDragDropEvent((event) => {
				const type = event.payload.type;
				if (type === "over") {
					dispatch({ type: "dragStart" });
				} else if (type === "leave") {
					dispatch({ type: "dragEnd" });
				} else if (type === "drop") {
					dispatch({ type: "dragEnd" });
					const paths: string[] =
						"paths" in event.payload ? (event.payload.paths as string[]) : [];
					const imagePaths = paths.filter((p) =>
						IMAGE_EXTENSIONS.has(getExt(p)),
					);
					for (const p of imagePaths) {
						savePath(p);
					}
				}
			})
			.then((fn) => {
				if (mounted) {
					unlisten = fn;
				} else {
					fn(); // cleanup already ran — tear down immediately
				}
			});

		return () => {
			mounted = false;
			unlisten?.();
		};
	}, [savePath]);

	const handleFilePicker = async () => {
		const result = await openDialog({
			multiple: true,
			filters: [
				{
					name: "Images & Video",
					extensions: [
						"png",
						"jpg",
						"jpeg",
						"gif",
						"webp",
						"avif",
						"bmp",
						"tiff",
						"tif",
						"svg",
						"jxl",
						"heic",
						"heif",
						"mp4",
						"mov",
						"webm",
					],
				},
			],
		});
		if (!result) return;
		const paths = Array.isArray(result) ? result : [result];
		await Promise.all(paths.map((p) => savePath(p)));
	};

	const handleDelete = (img: {
		id: string;
		file_path: string;
		thumb_path: string;
	}) => {
		softDelete(img.id);
		const idx = filteredImages.findIndex((i) => i.id === img.id);
		const newLen = filteredImages.length - 1;
		if (newLen <= 0) {
			dispatch({ type: "setOpenId", id: null });
		} else {
			const nextIdx = idx >= newLen ? newLen - 1 : idx;
			dispatch({ type: "setOpenId", id: filteredImages[nextIdx]?.id ?? null });
		}
	};

	const toggleSelect = (id: string) => {
		dispatch({ type: "toggleSelect", id });
	};

	const handleBatchDelete = useCallback(() => {
		if (selectedIds.size === 0) return;
		dispatch({
			type: "setConfirmDelete",
			state: { type: "batch", count: selectedIds.size },
		});
	}, [selectedIds]);

	const doBatchDelete = useCallback(async () => {
		await Promise.all([...selectedIds].map((id) => softDelete(id)));
		dispatch({ type: "clearSelection" });
	}, [selectedIds, softDelete]);

	const handleBatchAddToCollection = async (collectionId: string) => {
		await Promise.all(
			[...selectedIds].map((id) => addToCollection(collectionId, id)),
		);
	};

	const handleBatchTag = async (tagName: string) => {
		if (!tagName.trim()) return;
		await Promise.all([...selectedIds].map((id) => addTag(id, tagName.trim())));
		dispatch({ type: "clearBatchTagInput" });
	};

	const handleBatchCopy = useCallback(async () => {
		const ids = [...selectedIds];
		try {
			if (ids.length === 1) {
				const img = allImages.find((i) => i.id === ids[0]);
				if (!img) return;
				await invoke("copy_image_to_clipboard", { filePath: img.file_path });
			} else {
				const filePaths = ids
					.map((id) => allImages.find((i) => i.id === id)?.file_path)
					.filter(Boolean) as string[];
				await invoke("copy_files_to_clipboard", { filePaths });
			}
			toastManager.add({ title: `Copied ${ids.length} image${ids.length > 1 ? "s" : ""}`, type: "success" });
		} catch {
			toastManager.add({ title: "Copy failed", type: "error" });
		}
	}, [selectedIds, allImages]);

	const handleBatchExport = async () => {
		const ids = [...selectedIds];
		if (ids.length === 1) {
			const img = allImages.find((i) => i.id === ids[0]);
			if (!img) return;
			const filename = img.file_path.split("/").pop() ?? "image";
			const destPath = await saveDialog({ defaultPath: `~/Downloads/${filename}` });
			if (!destPath) return;
			try {
				await invoke("export_original", { filePath: img.file_path, destPath });
			} catch {
				toastManager.add({ title: "Export failed", type: "error" });
			}
		} else {
			const folder = await openDialog({ directory: true, title: "Export to folder" });
			if (!folder) return;
			const selected = allImages.filter((i) => ids.includes(i.id));
			let failed = 0;
			await Promise.all(
				selected.map(async (img) => {
					const filename = img.file_path.split("/").pop() ?? img.id;
					try {
						await invoke("export_original", {
							filePath: img.file_path,
							destPath: `${folder}/${filename}`,
						});
					} catch {
						failed++;
					}
				}),
			);
			if (failed > 0) {
				toastManager.add({ title: `${failed} export(s) failed`, type: "error" });
			} else {
				toastManager.add({ title: `Exported ${selected.length} files`, type: "success" });
			}
		}
	};

	useImperativeHandle(ref, () => ({
		openImage: (id: string) => dispatch({ type: "setOpenId", id }),
		openFilePicker: handleFilePicker,
		scrollToTop: () => activeScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }),
	}));

	const handleRenameCollection = (id: string, currentName: string) => {
		dispatch({ type: "startRename", kind: "collection", id, currentName });
		setTimeout(() => renameInputRef.current?.focus(), 0);
	};

	const handleRenameTag = (id: string, currentName: string) => {
		dispatch({ type: "startRename", kind: "tag", id, currentName });
		setTimeout(() => renameInputRef.current?.focus(), 0);
	};

	const commitRename = () => {
		if (!renaming) return;
		const trimmed = renameValue.trim();
		if (trimmed) {
			if (renaming.type === "collection")
				renameCollection(renaming.id, trimmed);
			else renameTag(renaming.id, trimmed);
		}
		dispatch({ type: "commitRename" });
	};

	const handleConfirmDelete = async () => {
		if (!confirmDelete) return;
		if (confirmDelete.type === "collection") {
			deleteCollection(confirmDelete.id);
			if (selectedId === confirmDelete.id) onSelectId?.(null);
		} else if (confirmDelete.type === "tag") {
			deleteTag(confirmDelete.id);
			if (selectedId === confirmDelete.id) onSelectId?.(null);
		} else if (confirmDelete.type === "batch") {
			await doBatchDelete();
		}
		dispatch({ type: "setConfirmDelete", state: null });
	};

	// Delete key for batch delete
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (selectedIds.size > 0 && openId === null) {
				if (e.key === "Delete" || e.key === "Backspace") {
					e.preventDefault();
					handleBatchDelete();
				} else if (e.key === "Escape") {
					dispatch({ type: "clearSelection" });
				} else if ((e.metaKey || e.ctrlKey) && e.key === "c") {
					e.preventDefault();
					handleBatchCopy();
				}
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [selectedIds.size, openId, handleBatchDelete, handleBatchCopy]);

	const contextMenuPopupClass =
		"z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg text-sm text-popover-foreground " +
		"origin-[var(--transform-origin)] transition-[opacity,transform] duration-[150ms] ease-[cubic-bezier(0.23,1,0.32,1)] " +
		"data-[ending-style]:duration-[100ms] " +
		"data-[starting-style]:opacity-0 data-[starting-style]:scale-95 " +
		"data-[ending-style]:opacity-0 data-[ending-style]:scale-95";
	const contextMenuItemClass =
		"flex items-center px-3 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground outline-none select-none";
	const contextMenuItemDestructiveClass =
		"flex items-center px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 outline-none select-none";

	const FAN_CONFIGS: Record<
		number,
		{ rotate: number; align: "center" | "start" | "end"; nudge?: string }[]
	> = {
		1: [{ rotate: 0, align: "center" }],
		2: [
			{ rotate: -15, align: "center" },
			{ rotate: 15, align: "center" },
		],
		3: [
			{ rotate: -15, align: "center", nudge: "10%" },
			{ rotate: 0, align: "center" },
			{ rotate: 15, align: "center", nudge: "10%" },
		],
		4: [
			{ rotate: -30, align: "center" },
			{ rotate: -15, align: "start" },
			{ rotate: 15, align: "start" },
			{ rotate: 30, align: "center" },
		],
	};

	// Collection grid view
	const renderCollectionGrid = () => (
		<div key="collections" ref={(el) => { activeScrollRef.current = el; setActiveScrollEl(el); }} className="flex-1 overflow-y-auto px-4 pb-4" style={{ paddingTop: navHeight + 16 }}>
			{collections.length === 0 ? (
				<div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground select-none">
					<RiAlbumLine className="size-10 opacity-40" />
					<div className="text-center">
						<p className="text-sm font-medium">No collections yet</p>
						<p className="text-xs mt-1 opacity-70">
							Right-click a collection to rename or delete
						</p>
					</div>
					<button
						type="button"
						onClick={onCreateCollection}
						className="mt-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
					>
						+ Create collection
					</button>
				</div>
			) : (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{collections.map((col) => {
						const ids = getCollectionImageIds(col.id);
						const slotCount = Math.min(ids.size, 4);
						const activeSlots = FAN_CONFIGS[slotCount] ?? [];
						const thumbs = getCollectionThumbs(col.id, allImages, slotCount);
						return (
							<ContextMenu.Root key={col.id}>
								<div
									className="collection-card-zone"
									onMouseEnter={(e) =>
										e.currentTarget.setAttribute("data-hovering", "")
									}
									onMouseLeave={(e) =>
										e.currentTarget.removeAttribute("data-hovering")
									}
								>
									<ContextMenu.Trigger
										className="relative block w-full aspect-square bg-card border border-border overflow-hidden outline-none"
										onClick={() => onSelectId?.(col.id)}
										tabIndex={0}
										onKeyDown={(e) => e.key === "Enter" && onSelectId?.(col.id)}
									>
										{/* fan of images */}
										<div className="absolute inset-0 flex items-center justify-center overflow-hidden">
											<div className="flex items-stretch justify-center w-full h-[55%]">
												{activeSlots.map((slot, i) => (
													<div
														key={i}
														style={
															slot.nudge
																? { paddingTop: slot.nudge }
																: undefined
														}
														className={`shrink-0 w-[40%] mr-[-26%] last:mr-0 flex flex-col drop-shadow-[0_6px_12px_rgba(0,0,0,0.3)] ${slot.align === "end" ? "justify-end" : slot.align === "center" ? "justify-center" : "justify-start"}`}
													>
														{thumbs[i] && (
															<div className="fan-wrapper" data-i={i}>
																<div
																	style={{
																		transform: `rotate(${slot.rotate}deg)`,
																	}}
																	className="w-[65%] mx-auto aspect-[3/4] overflow-hidden"
																>
																	<img
																		src={imgSrc(thumbs[i])}
																		alt=""
																		draggable={false}
																		className="w-full h-full object-cover pointer-events-none"
																	/>
																</div>
															</div>
														)}
													</div>
												))}
											</div>
										</div>
										{/* name */}
										{renaming?.type === "collection" &&
										renaming.id === col.id ? (
											<input
												aria-label="Rename collection"
												ref={renameInputRef}
												value={renameValue}
												onChange={(e) =>
													dispatch({
														type: "setRenameValue",
														value: e.target.value,
													})
												}
												onKeyDown={(e) => {
													if (e.key === "Enter") commitRename();
													if (e.key === "Escape")
														dispatch({ type: "cancelRename" });
												}}
												onBlur={commitRename}
												onClick={(e) => e.stopPropagation()}
												className="absolute top-3 left-3 right-10 bg-transparent font-semibold text-sm outline-none border-b border-foreground/30 z-10"
											/>
										) : (
											<span className="absolute top-3 left-3 text-sm font-semibold z-10 line-clamp-1 max-w-[70%] leading-tight">
												{col.name}
											</span>
										)}
										{/* count */}
										<span className="absolute bottom-3 right-3 text-sm font-medium text-muted-foreground z-10">
											{ids.size}
										</span>
									</ContextMenu.Trigger>
								</div>
								<ContextMenu.Portal>
									<ContextMenu.Positioner>
										<ContextMenu.Popup className={contextMenuPopupClass}>
											<ContextMenu.Item
												className={contextMenuItemClass}
												onClick={() => handleRenameCollection(col.id, col.name)}
											>
												Rename…
											</ContextMenu.Item>
											<ContextMenu.Item
												className={contextMenuItemDestructiveClass}
												onClick={() =>
													dispatch({
														type: "setConfirmDelete",
														state: {
															type: "collection",
															id: col.id,
															name: col.name,
														},
													})
												}
											>
												Delete
											</ContextMenu.Item>
										</ContextMenu.Popup>
									</ContextMenu.Positioner>
								</ContextMenu.Portal>
							</ContextMenu.Root>
						);
					})}
				</div>
			)}
		</div>
	);

	// Tag chip grid view
	const renderTagGrid = () => {
		const tagCounts = new Map<string, { name: string; count: number }>();
		for (const tags of imageTagsMap.values()) {
			for (const t of tags) {
				const existing = tagCounts.get(t.id);
				if (existing) {
					existing.count++;
				} else {
					tagCounts.set(t.id, { name: t.name, count: 1 });
				}
			}
		}
		const tagList = Array.from(tagCounts.entries()).sort(
			(a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name),
		);

		const coMap = hoveredTagId ? tagCoOccur.get(hoveredTagId) : null;
		const maxCoCount = coMap && coMap.size > 0 ? Math.max(...coMap.values()) : 0;

		return (
			<div key="tags" ref={(el) => { activeScrollRef.current = el; setActiveScrollEl(el); }} className="flex-1 overflow-y-auto px-4 pb-4" style={{ paddingTop: navHeight + 16 }}>
				{tagList.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground select-none">
						<RiPriceTag2Line className="size-10 opacity-40" />
						<div className="text-center">
							<p className="text-sm font-medium">No tags yet</p>
							<p className="text-xs mt-1 opacity-70">
								Open an image and add tags in the detail view
							</p>
						</div>
					</div>
				) : (
					<div
						className="flex flex-wrap gap-2"
						onMouseLeave={() => {
							if (tagHoverTimeout.current) clearTimeout(tagHoverTimeout.current);
							tagHoverTimeout.current = setTimeout(() => setHoveredTagId(null), 80);
						}}
					>
						{tagList.map(([id, { name, count }]) => {
							const isActive = hoveredTagId === id;
							const sharedCount = coMap?.get(id) ?? 0;
							const opacity = hoveredTagId === null || isActive
								? 1
								: maxCoCount > 0
									? 0.12 + (sharedCount / maxCoCount) * 0.88
									: 0.12;
							return (
							<ContextMenu.Root key={id}>
								<ContextMenu.Trigger className="contents">
									{renaming?.type === "tag" && renaming.id === id ? (
										<input
											aria-label="Rename tag"
											ref={renameInputRef}
											value={renameValue}
											onChange={(e) =>
												dispatch({
													type: "setRenameValue",
													value: e.target.value,
												})
											}
											onKeyDown={(e) => {
												if (e.key === "Enter") commitRename();
												if (e.key === "Escape")
													dispatch({ type: "cancelRename" });
											}}
											onBlur={commitRename}
											className="rounded-full border border-ring bg-muted px-4 py-2 text-sm font-medium outline-none ring-1 ring-ring"
										/>
									) : (
										<button
											type="button"
											onClick={() => onSelectId?.(id)}
											onMouseEnter={() => {
												if (tagHoverTimeout.current) clearTimeout(tagHoverTimeout.current);
												if (hoveredTagId === null || !tagCoOccur.get(hoveredTagId)?.has(id)) {
													setHoveredTagId(id);
												}
											}}
											onMouseLeave={() => {
												tagHoverTimeout.current = setTimeout(() => setHoveredTagId(null), 80);
											}}
											className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-medium hover:bg-accent"
											style={{
												opacity,
												transform: isActive ? "scale(1.04)" : "scale(1)",
												transition: hoveredTagId !== null
													? "opacity 120ms cubic-bezier(0.23,1,0.32,1), transform 120ms cubic-bezier(0.23,1,0.32,1), background-color 150ms ease"
													: "opacity 200ms ease, transform 120ms cubic-bezier(0.23,1,0.32,1), background-color 150ms ease",
											}}
										>
											{name}
											<span className="ml-2 text-muted-foreground text-xs">{count}</span>
										</button>
									)}
								</ContextMenu.Trigger>
								<ContextMenu.Portal>
									<ContextMenu.Positioner>
										<ContextMenu.Popup className={contextMenuPopupClass}>
											<ContextMenu.Item
												className={contextMenuItemClass}
												onClick={() => handleRenameTag(id, name)}
											>
												Rename…
											</ContextMenu.Item>
											<ContextMenu.Item
												className={contextMenuItemDestructiveClass}
												onClick={() =>
													dispatch({
														type: "setConfirmDelete",
														state: { type: "tag", id, name },
													})
												}
											>
												Delete
											</ContextMenu.Item>
										</ContextMenu.Popup>
									</ContextMenu.Positioner>
								</ContextMenu.Portal>
							</ContextMenu.Root>
						);
						})}
					</div>
				)}
			</div>
		);
	};

	// Masonry image grid
	const renderMasonryGrid = () => {
		if (filteredImages.length === 0) {
			if (allImages.length === 0) {
				return (
					<div className="flex flex-1 flex-col items-center justify-center gap-10 select-none">
						<div className="text-center">
							<p className="text-xl font-bold">Start your board</p>
							<p className="text-sm text-muted-foreground mt-1">
								Save images from anywhere
							</p>
						</div>
						<div className="flex gap-4">
							<div className="flex w-40 flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center text-muted-foreground">
								<RiUploadLine className="size-7 opacity-40" />
								<div>
									<p className="text-xs font-medium">Drag & drop</p>
									<p className="text-xs opacity-60 mt-0.5">image files</p>
								</div>
							</div>
							<div className="flex w-40 flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center text-muted-foreground">
								<RiClipboardLine className="size-7 opacity-40" />
								<div>
									<p className="text-xs font-medium">⌘V Paste</p>
									<p className="text-xs opacity-60 mt-0.5">image or URL</p>
								</div>
							</div>
							<button
								type="button"
								onClick={handleFilePicker}
								className="flex w-40 flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center text-muted-foreground hover:border-foreground/30 hover:bg-accent transition-colors"
							>
								<RiFolderOpenLine className="size-7 opacity-40" />
								<div>
									<p className="text-xs font-medium">Browse files</p>
									<p className="text-xs opacity-60 mt-0.5">or click + Add</p>
								</div>
							</button>
						</div>
					</div>
				);
			}
			return (
				<div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground select-none">
					<RiImageAddLine className="size-10 opacity-30" />
					<p className="text-sm">No images match your filters</p>
				</div>
			);
		}

		const visibleImages = filteredImages.slice(0, visibleCount);
		const allDisplayItems: (PendingItem | (typeof visibleImages)[0])[] = [
			...pendingItems,
			...visibleImages,
		];

		// Round-robin distribution so reading order (left→right) matches item order
		const cols = Array.from(
			{ length: numCols },
			(): typeof allDisplayItems => [],
		);
		allDisplayItems.forEach((item, i) => cols[i % numCols].push(item));

		const renderCard = (item: PendingItem | (typeof visibleImages)[0]) => {
			if (!("file_path" in item)) {
				return (
					<div
						key={item.id}
						className="relative overflow-hidden rounded-sm bg-muted motion-safe:animate-pulse w-full aspect-square"
					>
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
							<RiLoader4Line className="size-5 text-muted-foreground motion-safe:animate-spin" />
							<span className="text-xs text-muted-foreground text-center line-clamp-2 leading-tight">
								{item.label}
							</span>
						</div>
					</div>
				);
			}
			const img = item;
			return (
				<button
					type="button"
					key={img.id}
					aria-label={img.title ?? "Image"}
					className={cn(
						"group overflow-hidden relative outline-none w-full text-left transition-transform duration-[150ms] ease-out active:scale-[0.98] cursor-default select-none",
						selectedIds.has(img.id) &&
							"ring-2 ring-primary ring-offset-2 ring-offset-background",
					)}
					onClick={(e) => {
						if (e.metaKey || e.shiftKey) {
							e.preventDefault();
							toggleSelect(img.id);
						} else {
							if (selectedIds.size > 0)
								dispatch({ type: "openAndClearSelection", id: img.id });
							else dispatch({ type: "setOpenId", id: img.id });
						}
					}}
				>
					<div className="motion-safe:transition-transform motion-safe:duration-[200ms] motion-safe:ease-out motion-safe:group-hover:scale-[1.01]">
						{img.kind === "video" ? (
							<video
								src={imgSrc(img.file_path)}
								autoPlay
								muted
								loop
								playsInline
								className="block w-full object-cover"
								draggable={false}
								onLoadedData={(e) => {
									e.currentTarget.playbackRate = 0.25;
								}}
								onMouseEnter={(e) => {
									e.currentTarget.playbackRate = 1;
								}}
								onMouseLeave={(e) => {
									e.currentTarget.playbackRate = 0.25;
								}}
							/>
						) : (
							<LazyImage
								src={imgSrc(img.thumb_path)}
								placeholder={
									img.file_path.toLowerCase().endsWith(".svg")
										? "#fff"
										: (img.dominant_color ??
											(img.kind === "link" ? "#1a1a1a" : undefined))
								}
								thumbHash={img.thumb_hash ?? undefined}
								width={img.width}
								height={img.height}
								className="block w-full"
								draggable={false}
							/>
						)}
					</div>
					{img.kind === "link" ? (
						(() => {
							let platform = "";
							let domain = "";
							try {
								const meta = JSON.parse(img.post_meta ?? "{}") as {
									platform?: string;
									siteName?: string;
									url?: string;
								};
								platform = meta.platform ?? "";
								domain =
									meta.siteName ??
									meta.url?.split("://")[1]?.split("/")[0] ??
									"";
							} catch {}
							// Fall back to source_url if post_meta missing
							if (!domain && img.source_url) {
								domain = img.source_url.split("://")[1]?.split("/")[0] ?? "";
							}
							if (
								!platform &&
								img.source_url &&
								/x\.com|twitter\.com/.test(img.source_url)
							) {
								platform = "twitter";
							}
							return (
								<div className="absolute bottom-0 left-0 right-0 flex items-end px-2 pb-2 pt-8 bg-gradient-to-t from-black/40 to-transparent">
									<span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-black font-medium max-w-full truncate flex items-center gap-1">
										{platform === "twitter" ? (
											<RiTwitterLine className="size-3 shrink-0" />
										) : null}
										{platform !== "twitter" && domain ? domain : null}
									</span>
								</div>
							);
						})()
					) : (
						<div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-1 pt-16 px-2 pb-2 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-[120ms] ease-out">
							{(imageTagsMap.get(img.id) ?? []).slice(0, 3).map((t) => (
								<span
									key={t.id}
									className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-black font-medium"
								>
									{t.name}
								</span>
							))}
						</div>
					)}
					{selectedIds.size > 0 && (
						<div
							className={cn(
								"absolute top-2 left-2 size-5 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors",
								selectedIds.has(img.id)
									? "border-primary bg-primary text-primary-foreground"
									: "border-white/60 bg-black/30",
							)}
						>
							{selectedIds.has(img.id) && "✓"}
						</div>
					)}
				</button>
			);
		};

		return (
			<div key={`masonry-${activeTab}`} ref={(el) => { setMasonryEl(el); activeScrollRef.current = el; setActiveScrollEl(el); }} className="flex-1 overflow-y-auto px-4 pb-4" style={{ paddingTop: navHeight + 16 }}>
				<LazyObserverContext.Provider value={lazyIO}>
					<div className="flex gap-1 items-start">
						{cols.map((col, colIdx) => (
							<div key={colIdx} className="flex flex-1 flex-col gap-1 min-w-0">
								{col.map(renderCard)}
							</div>
						))}
					</div>
					{visibleCount < filteredImages.length && (
						<div ref={sentinelRef} className="h-1" />
					)}
				</LazyObserverContext.Provider>
			</div>
		);
	};

	// Determine which content to render
	const renderContent = () => {
		if (activeTab === "bin") return <BinView navHeight={navHeight} />;
		if (activeTab === "collections" && !selectedId)
			return renderCollectionGrid();
		if (activeTab === "tags" && !selectedId) return renderTagGrid();
		return renderMasonryGrid();
	};

	const cd = confirmDelete;
	const confirmTitle = !cd
		? ""
		: cd.type === "collection"
			? `Delete "${cd.name}"?`
			: cd.type === "tag"
				? `Delete tag "${cd.name}"?`
				: cd.type === "batch"
					? `Delete ${cd.count} image${cd.count !== 1 ? "s" : ""}?`
					: "";
	const confirmDescription = !cd
		? undefined
		: cd.type === "tag"
			? "This removes the tag from all images."
			: undefined;

	const showToolbar =
		((activeTab === "collections" || activeTab === "tags") && !!selectedId) ||
		selectedIds.size > 0;

	return (
		<div className="absolute inset-0 flex overflow-hidden">
			{/* main column */}
			<div
				className="relative flex flex-1 flex-col overflow-hidden"
			>
				{/* toolbar — absolutely positioned to avoid layout shift */}
				{showToolbar && (
					<div
						data-tauri-drag-region
						className="absolute left-0 right-0 z-10 flex h-11 items-center border-b border-border bg-background/95 backdrop-blur-sm px-4 gap-2"
						style={{ top: navHeight }}
					>
						{(activeTab === "collections" || activeTab === "tags") &&
							selectedId && (
								<button
									type="button"
									onClick={() => onSelectId?.(null)}
									className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
								>
									←{" "}
									{activeTab === "collections" ? "All Collections" : "All Tags"}
								</button>
							)}

						{selectedIds.size > 0 && (
							<>
								<span className="text-xs text-muted-foreground">
									{selectedIds.size} selected
								</span>
								<button
								type="button"
								onClick={handleBatchCopy}
								className="h-7 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
							>
								Copy
							</button>
								<button
									type="button"
									onClick={handleBatchExport}
									className="h-7 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
								>
									Export
								</button>
								<button
									type="button"
									onClick={handleBatchDelete}
									className="h-7 rounded-md border border-destructive/50 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
								>
									Delete
								</button>
								<select
									aria-label="Add to collection"
									defaultValue=""
									onChange={(e) => {
										if (e.target.value) {
											handleBatchAddToCollection(e.target.value);
											e.target.value = "";
										}
									}}
									className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
								>
									<option value="" disabled>
										Add to collection…
									</option>
									{collections.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name}
										</option>
									))}
								</select>
								<input
									aria-label="Batch tag"
									value={batchTagInput}
									onChange={(e) =>
										dispatch({
											type: "setBatchTagInput",
											value: e.target.value,
										})
									}
									onKeyDown={(e) => {
										if (e.key === "Enter") handleBatchTag(batchTagInput);
									}}
									placeholder="Add tag…"
									className="h-7 w-28 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
								/>
								<button
									type="button"
									onClick={() => dispatch({ type: "clearSelection" })}
									className="h-7 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
								>
									Clear
								</button>
							</>
						)}

						<div className="flex-1" data-tauri-drag-region />
					</div>
				)}

				{renderContent()}

				{/* drag overlay */}
				{isDragging && (
					<div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 animate-in fade-in duration-150">
						<span className="text-sm font-medium text-primary select-none">
							Drop images here
						</span>
					</div>
				)}
			</div>

			<Lightbox
				images={filteredImages}
				currentIndex={currentIndex === -1 ? null : currentIndex}
				onNavigate={(idx) =>
					dispatch({
						type: "setOpenId",
						id: idx !== null ? (filteredImages[idx]?.id ?? null) : null,
					})
				}
				onClose={() => dispatch({ type: "setOpenId", id: null })}
				onDelete={handleDelete}
				onUpdateTitle={updateTitle}
				onUpdateNotes={updateNotes}
				onUpdateDescription={updateDescription}
				imgSrc={imgSrc}
				onOpenSettings={onOpenSettings}
			/>

			<ConfirmDialog
				open={confirmDelete !== null}
				onOpenChange={(open) => {
					if (!open) dispatch({ type: "setConfirmDelete", state: null });
				}}
				title={confirmTitle}
				description={confirmDescription}
				onConfirm={handleConfirmDelete}
			/>
		</div>
	);
}
