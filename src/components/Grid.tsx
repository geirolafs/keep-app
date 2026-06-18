import { ContextMenu } from "@base-ui/react/context-menu";
import {
	RiAlbumLine,
	RiClipboardLine,
	RiFolderOpenLine,
	RiImageAddLine,
	RiLoader4Line,
	RiPriceTag2Line,
	RiUploadLine,
	RiTwitterLine,
} from "@remixicon/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState } from "react";
import type { Ref } from "react";
import { BinView } from "@/components/BinView";
import { LazyImage } from "@/components/LazyImage";
import { Lightbox } from "@/components/Lightbox";
import type { Sort, Tab } from "@/components/TopNav";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useImages, type PendingItem } from "@/hooks/use-images";
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
			return { ...state, selectedIds: new Set() };
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
	const [visibleCount, setVisibleCount] = useState(50);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const masonryRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = masonryRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			if (numColsManual) return;
			const w = entry.contentRect.width;
			const n = w >= 1280 ? 5 : w >= 1024 ? 4 : w >= 640 ? 3 : 2;
			onAutoNumCols?.(n);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [numColsManual, onAutoNumCols]);
	const shuffleOrderRef = useRef<Map<string, number> | null>(null);
	useEffect(() => {
		if (shuffleSeed > 0) {
			const map = new Map<string, number>();
			allImages.forEach((img) => map.set(img.id, Math.random()));
			shuffleOrderRef.current = map;
		} else {
			shuffleOrderRef.current = null;
		}
	}, [shuffleSeed, allImages.forEach]); // eslint-disable-line react-hooks/exhaustive-deps

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
					return sort === "name-az" ? na.localeCompare(nb) : nb.localeCompare(na);
				});
			} else {
				imgs.sort((a, b) =>
					sort === "newest"
						? (b.created_at ?? 0) - (a.created_at ?? 0)
						: (a.created_at ?? 0) - (b.created_at ?? 0),
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
			{ rootMargin: "300px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [visibleCount, filteredImages.length]);

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
		await Promise.all(
			[...selectedIds].map((id) => softDelete(id)),
		);
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

	useImperativeHandle(ref, () => ({
		openImage: (id: string) => dispatch({ type: "setOpenId", id }),
		openFilePicker: handleFilePicker,
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
			if (
				(e.key === "Delete" || e.key === "Backspace") &&
				selectedIds.size > 0 &&
				openId === null
			) {
				e.preventDefault();
				handleBatchDelete();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [selectedIds.size, openId, handleBatchDelete]);

	const contextMenuPopupClass =
		"z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg text-sm text-popover-foreground";
	const contextMenuItemClass =
		"flex items-center px-3 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground outline-none select-none";
	const contextMenuItemDestructiveClass =
		"flex items-center px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 outline-none select-none";

	const FAN_CONFIGS: Record<number, { rotate: number; align: "center" | "start" | "end"; nudge?: string }[]> = {
		1: [{ rotate: 0,   align: "center" }],
		2: [{ rotate: -15, align: "center" }, { rotate: 15,  align: "center" }],
		3: [{ rotate: -15, align: "center", nudge: "10%" }, { rotate: 0, align: "center" }, { rotate: 15, align: "center", nudge: "10%" }],
		4: [{ rotate: -30, align: "center" }, { rotate: -15, align: "start"  }, { rotate: 15, align: "start"  }, { rotate: 30, align: "center" }],
	};

	// Collection grid view
	const renderCollectionGrid = () => (
		<div className="flex-1 overflow-y-auto p-4">
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
								<ContextMenu.Trigger
									className="relative aspect-square bg-card border border-border overflow-hidden hover:opacity-90 transition-opacity outline-none"
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
													style={slot.nudge ? { paddingTop: slot.nudge } : undefined}
												className={`shrink-0 w-[40%] mr-[-26%] last:mr-0 flex flex-col drop-shadow-[0_6px_12px_rgba(0,0,0,0.3)] ${slot.align === "end" ? "justify-end" : slot.align === "center" ? "justify-center" : "justify-start"}`}
												>
													{thumbs[i] && (
														<div
															style={{ transform: `rotate(${slot.rotate}deg)` }}
															className="w-[65%] mx-auto aspect-[3/4] overflow-hidden"
														>
															<img
																src={imgSrc(thumbs[i])}
																alt=""
																draggable={false}
																className="w-full h-full object-cover pointer-events-none"
															/>
														</div>
													)}
												</div>
											))}
										</div>
									</div>
									{/* name */}
									{renaming?.type === "collection" && renaming.id === col.id ? (
										<input
											aria-label="Rename collection"
											ref={renameInputRef}
											value={renameValue}
											onChange={(e) => dispatch({ type: "setRenameValue", value: e.target.value })}
											onKeyDown={(e) => {
												if (e.key === "Enter") commitRename();
												if (e.key === "Escape") dispatch({ type: "cancelRename" });
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

		return (
			<div className="flex-1 overflow-y-auto p-4">
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
					<div className="flex flex-wrap gap-2">
						{tagList.map(([id, { name, count }]) => (
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
											className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
										>
											{name}
											<span className="ml-2 text-muted-foreground text-xs">
												{count}
											</span>
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
						))}
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
		const cols = Array.from({ length: numCols }, (): typeof allDisplayItems => []);
		allDisplayItems.forEach((item, i) => cols[i % numCols].push(item));

		const renderCard = (item: PendingItem | (typeof visibleImages)[0]) => {
			if (!("file_path" in item)) {
				return (
					<div
						key={item.id}
						className="relative overflow-hidden rounded-sm bg-muted animate-pulse w-full aspect-square"
					>
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
							<RiLoader4Line className="size-5 text-muted-foreground animate-spin" />
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
					"group overflow-hidden relative outline-none w-full text-left",
					selectedIds.has(img.id) &&
						"ring-2 ring-primary ring-offset-2 ring-offset-background",
				)}
				style={
					img.file_path.toLowerCase().endsWith(".svg")
						? { backgroundColor: "#fff", transition: "transform 150ms ease" }
						: {
								backgroundColor: img.dominant_color ?? (img.kind === "link" ? "#1a1a1a" : undefined),
								transition: "transform 150ms ease",
							}
				}
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
				onMouseEnter={(e) => {
					(e.currentTarget as HTMLElement).style.transform = "scale(1.01)";
				}}
				onMouseLeave={(e) => {
					(e.currentTarget as HTMLElement).style.transform = "";
				}}
			>
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
						width={img.width}
						height={img.height}
						className="block w-full object-cover"
						draggable={false}
					/>
				)}
				{img.kind === "link" ? (() => {
					let platform = "";
					let domain = "";
					try {
						const meta = JSON.parse(img.post_meta ?? "{}") as { platform?: string; siteName?: string; url?: string };
						platform = meta.platform ?? "";
						domain = meta.siteName ?? meta.url?.split("://")[1]?.split("/")[0] ?? "";
					} catch {}
					// Fall back to source_url if post_meta missing
					if (!domain && img.source_url) {
						domain = img.source_url.split("://")[1]?.split("/")[0] ?? "";
					}
					if (!platform && img.source_url && /x\.com|twitter\.com/.test(img.source_url)) {
						platform = "twitter";
					}
					return (
						<div className="absolute bottom-0 left-0 right-0 flex items-end px-2 pb-2 pt-8 bg-gradient-to-t from-black/40 to-transparent">
							<span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-black font-medium max-w-full truncate flex items-center gap-1">
								{platform === "twitter" ? <RiTwitterLine className="size-3 shrink-0" /> : null}
								{platform !== "twitter" && domain ? domain : null}
							</span>
						</div>
					);
				})() : (
				<div className="absolute bottom-0 left-0 right-0 hidden group-hover:flex flex-wrap gap-1 pt-16 px-2 pb-2 bg-gradient-to-t from-black/20 to-transparent">
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
			<div ref={masonryRef} className="flex-1 overflow-y-auto p-4">
				<div className="flex gap-3 items-start">
					{cols.map((col, colIdx) => (
						<div key={colIdx} className="flex flex-1 flex-col gap-3 min-w-0">
							{col.map(renderCard)}
						</div>
					))}
				</div>
				{visibleCount < filteredImages.length && (
					<div ref={sentinelRef} className="h-1" />
				)}
			</div>
		);
	};

	// Determine which content to render
	const renderContent = () => {
		if (activeTab === "bin") return <BinView />;
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

	return (
		<div className="relative flex flex-1 overflow-hidden">
			{/* main column */}
			<div className="relative flex flex-1 flex-col overflow-hidden">
				{/* toolbar — only when breadcrumb or selection is active */}
				{(((activeTab === "collections" || activeTab === "tags") && selectedId) || selectedIds.size > 0) && (
					<div
						data-tauri-drag-region
						className="flex h-11 flex-shrink-0 items-center border-b border-border px-4 gap-2"
					>
						{(activeTab === "collections" || activeTab === "tags") && selectedId && (
							<button
								type="button"
								onClick={() => onSelectId?.(null)}
								className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
							>
								← {activeTab === "collections" ? "All Collections" : "All Tags"}
							</button>
						)}

						{selectedIds.size > 0 && (
							<>
								<span className="text-xs text-muted-foreground">
									{selectedIds.size} selected
								</span>
								<button
									type="button"
									onClick={handleBatchDelete}
									className="h-7 rounded-md border border-destructive/50 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
								>
									Delete all
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
										dispatch({ type: "setBatchTagInput", value: e.target.value })
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
					<div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80">
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
