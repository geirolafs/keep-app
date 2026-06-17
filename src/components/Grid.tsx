import { ContextMenu } from "@base-ui/react/context-menu";
import {
	RiAlbumLine,
	RiClipboardLine,
	RiFolderOpenLine,
	RiImageAddLine,
	RiPriceTag2Line,
	RiUploadLine,
} from "@remixicon/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { LazyImage } from "@/components/LazyImage";
import { Lightbox } from "@/components/Lightbox";
import type { Sort, Tab } from "@/components/TopNav";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useImages } from "@/hooks/use-images";
import { useSettings } from "@/hooks/use-settings";
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

interface GridProps {
	activeTab?: Tab;
	sort?: Sort;
	searchQuery?: string;
	selectedId?: string | null;
	onSelectId?: (id: string | null) => void;
	onCreateCollection?: () => void;
	shuffleSeed?: number;
}

export default function Grid({
	activeTab = "all",
	sort = "newest",
	searchQuery = "",
	selectedId = null,
	onSelectId,
	onCreateCollection,
	shuffleSeed = 0,
}: GridProps) {
	const {
		images: allImages,
		imgSrc,
		savePath,
		deleteImage,
		updateTitle,
		updateNotes,
		updateDescription,
	} = useImages();
	const { imageTagsMap, addTag, deleteTag, renameTag } = useTags();
	const { getSetting, setSetting } = useSettings();
	const {
		collections,
		getCollectionImageIds,
		getCollectionCover,
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
	const [numCols, setNumCols] = useState(4);
	const manualColsRef = useRef(false);
	const masonryRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		getSetting("col_count").then((v) => {
			if (v) { setNumCols(parseInt(v)); manualColsRef.current = true; }
		});
	}, []); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => {
		const el = masonryRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			if (manualColsRef.current) return;
			const w = entry.contentRect.width;
			if (w >= 1280) setNumCols(5);
			else if (w >= 1024) setNumCols(4);
			else if (w >= 640) setNumCols(3);
			else setNumCols(2);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
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
					(imageTagsMap.get(img.id) ?? []).some((t) =>
						t.name.toLowerCase().includes(q),
					),
			);
		}

		if (shuffleSeed > 0 && shuffleOrderRef.current) {
			const order = shuffleOrderRef.current;
			imgs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
		} else {
			imgs.sort((a, b) =>
				sort === "newest"
					? (b.created_at ?? 0) - (a.created_at ?? 0)
					: (a.created_at ?? 0) - (b.created_at ?? 0),
			);
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
		deleteImage(img.id, img.file_path, img.thumb_path);
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
		const imageMap = new Map(allImages.map((img) => [img.id, img]));
		await Promise.all(
			[...selectedIds].map((id) => {
				const img = imageMap.get(id);
				return img
					? deleteImage(id, img.file_path, img.thumb_path)
					: Promise.resolve();
			}),
		);
		dispatch({ type: "clearSelection" });
	}, [selectedIds, allImages, deleteImage]);

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

	const handleNumColsChange = (n: number) => {
		setNumCols(n);
		manualColsRef.current = true;
		setSetting("col_count", String(n));
	};

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
		"flex items-center px-3 py-1.5 rounded-md cursor-pointer hover:bg-accent hover:text-accent-foreground outline-none select-none";
	const contextMenuItemDestructiveClass =
		"flex items-center px-3 py-1.5 rounded-md cursor-pointer text-destructive hover:bg-destructive/10 outline-none select-none";

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
						const cover = getCollectionCover(col.id, allImages);
						const ids = getCollectionImageIds(col.id);
						return (
							<ContextMenu.Root key={col.id}>
								<ContextMenu.Trigger
									className="overflow-hidden cursor-pointer relative aspect-square bg-muted hover:opacity-90 transition-opacity outline-none"
									onClick={() => onSelectId?.(col.id)}
									tabIndex={0}
									onKeyDown={(e) => e.key === "Enter" && onSelectId?.(col.id)}
								>
									{cover ? (
										<img
											src={imgSrc(cover.thumb_path)}
											alt={col.name}
											className="w-full h-full object-cover"
											draggable={false}
										/>
									) : (
										<div className="w-full h-full bg-muted" />
									)}
									<div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center px-2">
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
												className="bg-transparent text-white font-semibold text-sm text-center outline-none border-b border-white/60 w-full"
											/>
										) : (
											<span className="text-white font-semibold text-sm text-center drop-shadow">
												{col.name}
											</span>
										)}
										<span className="text-white/70 text-xs mt-1">
											{ids.size} {ids.size === 1 ? "image" : "images"}
										</span>
									</div>
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

		// Distribute items into columns sequentially (same order as CSS columns)
		const perCol = Math.ceil(visibleImages.length / numCols);
		const cols = Array.from({ length: numCols }, (_, i) =>
			visibleImages.slice(i * perCol, (i + 1) * perCol),
		);

		const renderCard = (img: (typeof visibleImages)[0]) => (
			<button
				type="button"
				key={img.id}
				aria-label={img.title ?? "Image"}
				className={cn(
					"group overflow-hidden relative cursor-pointer outline-none w-full text-left",
					selectedIds.has(img.id) &&
						"ring-2 ring-primary ring-offset-2 ring-offset-background",
				)}
				style={
					img.file_path.toLowerCase().endsWith(".svg")
						? { backgroundColor: "#fff", transition: "transform 150ms ease" }
						: {
								backgroundColor: img.dominant_color ?? undefined,
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
						onMouseEnter={(e) => {
							e.currentTarget.playbackRate = 0.25;
						}}
						onMouseLeave={(e) => {
							e.currentTarget.playbackRate = 1;
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
				{/* toolbar */}
				<div
					data-tauri-drag-region
					className="flex h-11 flex-shrink-0 items-center border-b border-border px-4 gap-2"
				>
					{/* Breadcrumb when drilling into a collection or tag */}
					{(activeTab === "collections" || activeTab === "tags") &&
						selectedId && (
							<button
								type="button"
								onClick={() => onSelectId?.(null)}
								className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
							>
								← {activeTab === "collections" ? "All Collections" : "All Tags"}
							</button>
						)}

					{/* Batch action toolbar */}
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
					<div className="flex items-center gap-1.5">
						<input
							type="range"
							min={2}
							max={12}
							value={numCols}
							onChange={(e) => handleNumColsChange(parseInt(e.target.value))}
							className="w-20 accent-foreground"
							title={`${numCols} columns`}
						/>
						<span className="w-4 text-center text-xs text-muted-foreground">{numCols}</span>
					</div>
					<button
						type="button"
						onClick={handleFilePicker}
						className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
					>
						+ Add
					</button>
				</div>

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
