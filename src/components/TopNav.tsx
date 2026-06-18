import { RiSearchLine, RiSortAsc, RiSortDesc, RiSettings3Line, RiEyeLine, RiEyeOffLine, RiLoader4Line, RiSparkling2Line, RiQuestionLine, RiAddLine } from "@remixicon/react";
import { devSaveExample, devLoadExample, devResetAll, refreshThumbnails, backfillVision, useImages } from "@/hooks/use-images";
import { useTags } from "@/hooks/use-tags";
import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { toastManager } from "@/lib/toast";
import {
	type Ref,
	type RefObject,
	useEffect,
	useImperativeHandle,
	useReducer,
	useRef,
	useState,
} from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings, type AnalyzeMode } from "@/hooks/use-settings";

export type Tab = "all" | "collections" | "tags" | "bin";
export type Sort = "newest" | "oldest" | "name-az" | "name-za";

export interface TopNavHandle {
	startNaming: () => void;
	openHelp: () => void;
}

interface TopNavProps {
	activeTab: Tab;
	onTabChange: (tab: Tab) => void;
	searchQuery: string;
	onSearchChange: (q: string) => void;
	sort: Sort;
	onSortChange: (s: Sort) => void;
	onCreateCollection: (name: string) => void;
	searchInputRef?: RefObject<HTMLInputElement | null>;
	shuffleSeed?: number;
	onShuffle?: () => void;
	numCols?: number;
	onNumColsChange?: (n: number) => void;
	onAddFiles?: () => void;
	ref?: Ref<TopNavHandle>;
}

type SettingsState = {
	open: boolean;
	apiKey: string;
	showApiKey: boolean;
	analyzeMode: AnalyzeMode;
	model: string;
	refreshProgress: { done: number; total: number } | null;
	analyzeProgress: { done: number; total: number } | null;
	visionProgress: { done: number; total: number } | null;
	resetConfirm: boolean;
};

type SettingsAction =
	| { type: "open"; apiKey: string; analyzeMode: AnalyzeMode; model: string }
	| { type: "close" }
	| { type: "setApiKey"; value: string }
	| { type: "toggleShowApiKey" }
	| { type: "setAnalyzeMode"; mode: AnalyzeMode }
	| { type: "setModel"; value: string }
	| { type: "setRefreshProgress"; progress: { done: number; total: number } | null }
	| { type: "setAnalyzeProgress"; progress: { done: number; total: number } | null }
	| { type: "setVisionProgress"; progress: { done: number; total: number } | null }
	| { type: "startResetConfirm" }
	| { type: "cancelResetConfirm" };

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
	switch (action.type) {
		case "open":
			return { ...state, open: true, apiKey: action.apiKey, analyzeMode: action.analyzeMode, model: action.model, showApiKey: false, resetConfirm: false };
		case "close": return { ...state, open: false };
		case "setApiKey": return { ...state, apiKey: action.value };
		case "toggleShowApiKey": return { ...state, showApiKey: !state.showApiKey };
		case "setAnalyzeMode": return { ...state, analyzeMode: action.mode };
		case "setModel": return { ...state, model: action.value };
		case "setRefreshProgress": return { ...state, refreshProgress: action.progress };
		case "setAnalyzeProgress": return { ...state, analyzeProgress: action.progress };
		case "setVisionProgress": return { ...state, visionProgress: action.progress };
		case "startResetConfirm": return { ...state, resetConfirm: true };
		case "cancelResetConfirm": return { ...state, resetConfirm: false };
	}
}

const TABS: { id: Tab; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "collections", label: "Collections" },
	{ id: "tags", label: "Tags" },
	{ id: "bin", label: "Bin" },
];

const SHORTCUTS: [string, string][] = [
	["⌘K", "Search palette"],
	["⌘F", "Focus search bar"],
	["← →", "Navigate lightbox"],
	["Esc", "Close / cancel"],
	["Del", "Delete selected"],
	["⌘+click", "Multi-select"],
	["Shift+click", "Range select"],
	["?", "This help"],
];

function TopNav({
	activeTab,
	onTabChange,
	searchQuery,
	onSearchChange,
	sort,
	onSortChange,
	onCreateCollection,
	searchInputRef,
	shuffleSeed = 0,
	onShuffle,
	numCols = 4,
	onNumColsChange,
	onAddFiles,
	ref,
}: TopNavProps) {
	const [naming, setNaming] = useState(false);
	const [nameValue, setNameValue] = useState("");
	const [helpOpen, setHelpOpen] = useState(false);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const analyzeCancelRef = useRef(false);
	const visionCancelRef = useRef(false);
	const [settings, settingsDispatch] = useReducer(settingsReducer, {
		open: false,
		apiKey: "",
		showApiKey: false,
		analyzeMode: "manual",
		model: "anthropic/claude-sonnet-4-6",
		refreshProgress: null,
		analyzeProgress: null,
		visionProgress: null,
		resetConfirm: false,
	});
	const { getSetting, setSetting } = useSettings();
	const { images: allImages, binImages, updateTitle, updateDescription } = useImages();

	// Auto-navigate away from Bin when it becomes empty
	useEffect(() => {
		if (activeTab === "bin" && binImages.length === 0) {
			onTabChange("all");
		}
	}, [binImages.length, activeTab, onTabChange]);
	const { imageTagsMap, addTag, removeTag } = useTags();

	useImperativeHandle(ref, () => ({ startNaming, openHelp: () => setHelpOpen(true) }));

	const commitName = () => {
		const trimmed = nameValue.trim();
		if (trimmed) onCreateCollection(trimmed);
		setNaming(false);
		setNameValue("");
	};

	const startNaming = () => {
		setNaming(true);
		setNameValue("");
		setTimeout(() => nameInputRef.current?.focus(), 0);
	};

	const openSettings = async () => {
		const [key, mode, model] = await Promise.all([
			getSetting("api_key"),
			getSetting("analyze_mode"),
			getSetting("model"),
		]);
		settingsDispatch({ type: "open", apiKey: key ?? "", analyzeMode: (mode as AnalyzeMode | null) ?? "manual", model: model ?? "anthropic/claude-sonnet-4-6" });
	};

	const handleRefreshThumbnails = async () => {
		await refreshThumbnails((done, total) => settingsDispatch({ type: "setRefreshProgress", progress: { done, total } }));
		settingsDispatch({ type: "setRefreshProgress", progress: null });
	};

	const handleVisionScan = async () => {
		if (settings.visionProgress) {
			visionCancelRef.current = true;
			return;
		}
		visionCancelRef.current = false;
		const unindexed = allImages.filter((img) => img.ocr_text === null && img.kind !== "video");
		if (unindexed.length === 0) {
			return;
		}
		settingsDispatch({ type: "setVisionProgress", progress: { done: 0, total: unindexed.length } });
		const count = await backfillVision(allImages, (done, total) => settingsDispatch({ type: "setVisionProgress", progress: { done, total } }), visionCancelRef);
		settingsDispatch({ type: "setVisionProgress", progress: null });
		try { sendNotification({ title: "KEEP", body: `Vision indexed ${count} images` }); } catch {}
		setTimeout(() => window.location.reload(), 1500);
	};

	const handleAnalyzeAll = async () => {
		if (settings.analyzeProgress) {
			analyzeCancelRef.current = true;
			return;
		}
		const apiKey = await getSetting("api_key");
		if (!apiKey) {
			toastManager.add({ title: "Add your OpenRouter API key in Settings", type: "error" });
			return;
		}
		const model = (await getSetting("model")) ?? "anthropic/claude-sonnet-4-6";
		analyzeCancelRef.current = false;
		settingsDispatch({ type: "setAnalyzeProgress", progress: { done: 0, total: allImages.length } });
		let analyzedCount = 0;

		for (let i = 0; i < allImages.length; i++) {
			if (analyzeCancelRef.current) break;
			const img = allImages[i];
			if (img.kind === "video") {
				settingsDispatch({ type: "setAnalyzeProgress", progress: { done: i + 1, total: allImages.length } });
				continue;
			}
			try {
				const result = await invoke<{ title: string; tags: string[]; description: string } | null>("analyze_image", {
					thumbPath: img.thumb_path,
					apiKey,
					model,
				});
				if (result && !analyzeCancelRef.current) {
					analyzedCount++;
					await Promise.all([
						updateTitle(img.id, result.title),
						updateDescription(img.id, result.description),
						(async () => {
							await Promise.all((imageTagsMap.get(img.id) ?? []).map((tag) => removeTag(img.id, tag.id)));
							await Promise.all(result.tags.map((tag) => addTag(img.id, tag)));
						})(),
					]);
				}
			} catch (err) {
				console.error(`[keep] batch analyze failed for ${img.id}:`, err);
			}
			settingsDispatch({ type: "setAnalyzeProgress", progress: { done: i + 1, total: allImages.length } });
		}

		settingsDispatch({ type: "setAnalyzeProgress", progress: null });
		if (!analyzeCancelRef.current) {
			try { sendNotification({ title: "KEEP", body: `Analyzed ${analyzedCount} image${analyzedCount !== 1 ? "s" : ""}` }); } catch {}
		}
	};

	const saveSettings = async () => {
		await Promise.all([
			setSetting("api_key", settings.apiKey),
			setSetting("analyze_mode", settings.analyzeMode),
			setSetting("model", settings.model),
		]);
		settingsDispatch({ type: "close" });
	};

	return (
		<>
		<div
			data-tauri-drag-region
			className="flex flex-shrink-0 items-center justify-between bg-background px-4 pt-[44px] pb-4"
		>
			{/* Logo */}
			<span className="shrink-0 select-none text-[44px] font-black uppercase leading-none tracking-[-0.065em] text-[#392115] cap-trim">
				KEEP
			</span>

			{/* Tabs */}
			<div className="flex items-center gap-6">
				{TABS.map((tab) => {
					const isDisabled = tab.id === "bin" && binImages.length === 0;

					if (isDisabled) {
						return (
							<Tooltip key={tab.id}>
								<TooltipTrigger render={<span className="shrink-0 text-3xl font-semibold leading-none cap-trim opacity-25 cursor-not-allowed" style={{ color: "#bfb7b1" }} />}>
									{tab.label}
								</TooltipTrigger>
								<TooltipContent side="bottom">Bin is empty</TooltipContent>
							</Tooltip>
						);
					}

					return (
						<button
							type="button"
							key={tab.id}
							onClick={() => {
								onTabChange(tab.id);
								setNaming(false);
							}}
							className={`shrink-0 text-3xl font-semibold leading-none transition-colors cap-trim ${activeTab === tab.id ? "text-[#392115]" : "text-[#bfb7b1] hover:text-[#392115]"}`}
						>
							{tab.label}
						</button>
					);
				})}
			</div>

			{/* Right controls */}
			<div className="flex items-center gap-3 shrink-0">
				{/* Sort + col slider group */}
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => onSortChange(sort === "newest" ? "oldest" : sort === "oldest" ? "name-az" : sort === "name-az" ? "name-za" : "newest")}
						title={sort === "newest" ? "Newest first" : sort === "oldest" ? "Oldest first" : sort === "name-az" ? "Name A→Z" : "Name Z→A"}
						className="flex h-7 items-center gap-1 px-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					>
						{sort === "newest" || sort === "name-za" ? (
							<RiSortDesc className="size-4" />
						) : (
							<RiSortAsc className="size-4" />
						)}
						<span className="text-xs font-medium">{sort === "name-az" || sort === "name-za" ? "Name" : "Date"}</span>
					</button>
					<span className="text-xs font-semibold tabular-nums" style={{ color: "#79716b" }}>{numCols}</span>
					<input
						type="range"
						min={2}
						max={12}
						value={numCols}
						onChange={(e) => onNumColsChange?.(parseInt(e.target.value))}
						title={`${numCols} columns`}
						className="col-slider w-20"
						style={{ "--col-pct": `${((numCols - 2) / 10) * 100}%` } as React.CSSProperties}
					/>
				</div>

				{/* Utility icons group */}
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => setHelpOpen(true)}
						title="Help (?)"
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					>
						<RiQuestionLine className="size-4" />
					</button>
					<button
						type="button"
						onClick={openSettings}
						title="Settings"
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					>
						<RiSettings3Line className="size-4" />
					</button>
				</div>

				{/* Search + add group */}
				<div className="flex items-center gap-2">
					<div className="relative">
						<RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
						<input
							aria-label="Search"
							ref={searchInputRef}
							value={searchQuery}
							onChange={(e) => onSearchChange(e.target.value)}
							placeholder="Search..."
							className="h-7 w-48 rounded-full border border-input bg-input/30 pl-7 pr-10 py-1 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
						/>
						<kbd className={[
							"absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none rounded border border-border px-1 py-0.5 font-mono text-[10px] text-muted-foreground transition-opacity",
							searchQuery ? "opacity-0" : "opacity-100",
						].join(" ")}>
							⌘K
						</kbd>
					</div>

					{/* New collection (collections tab only) */}
					{activeTab === "collections" &&
						(naming ? (
							<input
								aria-label="Collection name"
								ref={nameInputRef}
								value={nameValue}
								onChange={(e) => setNameValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") commitName();
									if (e.key === "Escape") {
										setNaming(false);
										setNameValue("");
									}
								}}
								onBlur={commitName}
								placeholder="Collection name…"
								className="h-7 w-40 rounded-md border border-ring bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
							/>
						) : (
							<button
								type="button"
								onClick={startNaming}
								className="h-7 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
							>
								+ Collection
							</button>
						))}

					<button
						type="button"
						onClick={onAddFiles}
						title="Add files"
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					>
						<RiAddLine className="size-4" />
					</button>
				</div>
			</div>
		</div>

		{/* Settings Modal */}
		<AlertDialog.Root open={settings.open} onOpenChange={(open) => { if (!open) settingsDispatch({ type: "close" }); }}>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
				<AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
					<AlertDialog.Popup className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-xl">
						<AlertDialog.Title className="text-base font-semibold">Settings</AlertDialog.Title>

						<div className="mt-4 space-y-4">
							{/* API Key */}
							<div>
								<label htmlFor="setting-api-key" className="mb-1.5 block text-sm font-medium">OpenRouter API Key</label>
								<div className="relative">
									<input
										id="setting-api-key"
										type={settings.showApiKey ? "text" : "password"}
										value={settings.apiKey}
										onChange={(e) => settingsDispatch({ type: "setApiKey", value: e.target.value })}
										placeholder="sk-or-..."
										className="h-9 w-full rounded-md border border-input bg-background px-3 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring"
									/>
									<button
										type="button"
										onClick={() => settingsDispatch({ type: "toggleShowApiKey" })}
										className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
									>
										{settings.showApiKey ? <RiEyeOffLine className="size-4" /> : <RiEyeLine className="size-4" />}
									</button>
								</div>
							</div>

							{/* Model */}
							<div>
								<label htmlFor="setting-model" className="mb-1.5 block text-sm font-medium">Model</label>
								<input
									id="setting-model"
									type="text"
									value={settings.model}
									onChange={(e) => settingsDispatch({ type: "setModel", value: e.target.value })}
									placeholder="anthropic/claude-sonnet-4-6"
									className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
								/>
							</div>

							{/* Analyze All */}
							<div>
								<Button
									variant={settings.analyzeProgress ? "destructive" : "outline"}
									size="sm"
									className="w-full"
									onClick={handleAnalyzeAll}
								>
									{settings.analyzeProgress ? (
										<><RiLoader4Line className="mr-1.5 size-3.5 animate-spin" />{settings.analyzeProgress.done}/{settings.analyzeProgress.total} — Cancel</>
									) : (
										<><RiSparkling2Line className="mr-1.5 size-3.5" />Analyze All</>
									)}
								</Button>
							</div>

							{/* Vision scan */}
							<div>
								<Button
									variant={settings.visionProgress ? "destructive" : "outline"}
									size="sm"
									className="w-full"
									onClick={handleVisionScan}
								>
									{settings.visionProgress ? (
										<><RiLoader4Line className="mr-1.5 size-3.5 animate-spin" />{settings.visionProgress.done}/{settings.visionProgress.total} — Cancel</>
									) : (
										"Scan with Vision"
									)}
								</Button>
								<p className="mt-1.5 text-xs text-muted-foreground">Auto-tag + OCR all unindexed images using macOS Vision — no API key needed</p>
							</div>

							{/* Analyze Mode */}
							<div>
								<label htmlFor="setting-analyze-mode" className="mb-1.5 block text-sm font-medium">Auto-analyze on open</label>
								<select
									id="setting-analyze-mode"
									value={settings.analyzeMode}
									onChange={(e) => settingsDispatch({ type: "setAnalyzeMode", mode: e.target.value as AnalyzeMode })}
									className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
								>
									<option value="manual">Off</option>
									<option value="auto_new">Auto — unanalyzed images only</option>
									<option value="auto_all">Auto — all images (re-analyze)</option>
								</select>
							</div>
						</div>

						{/* Dev tools */}
						{import.meta.env.DEV && (
							<div className="mt-4 border-t border-border/50 pt-4">
								<p className="mb-2 text-sm font-medium text-muted-foreground">Developer</p>
								<div className="flex gap-2 mb-2">
									<Button variant="outline" size="sm" className="flex-1" onClick={() => devSaveExample(1)}>Save E1</Button>
									<Button variant="outline" size="sm" className="flex-1" onClick={() => devLoadExample(1)}>Load E1</Button>
									{settings.resetConfirm ? (
										<>
											<Button variant="destructive" size="sm" className="flex-1" onClick={() => { settingsDispatch({ type: "cancelResetConfirm" }); devResetAll(); }}>Confirm</Button>
											<Button variant="outline" size="sm" onClick={() => settingsDispatch({ type: "cancelResetConfirm" })}>Cancel</Button>
										</>
									) : (
										<Button variant="outline" size="sm" className="flex-1 text-destructive border-destructive/50 hover:bg-destructive/10" onClick={() => settingsDispatch({ type: "startResetConfirm" })}>Reset</Button>
									)}
								</div>
								<div className="flex gap-2">
									<Button variant="outline" size="sm" className="flex-1" onClick={onShuffle}>
										Randomize {shuffleSeed > 0 && `(×${shuffleSeed})`}
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="flex-1"
										disabled={!!settings.refreshProgress}
										onClick={handleRefreshThumbnails}
									>
										{settings.refreshProgress
											? <><RiLoader4Line className="mr-1.5 size-3.5 animate-spin" />{settings.refreshProgress.done} of {settings.refreshProgress.total}</>
											: "Refresh Thumbs"}
									</Button>
								</div>
							</div>
						)}

						<div className="mt-5 flex justify-end gap-2">
							<AlertDialog.Close render={<Button variant="outline" size="sm" />}>
								Cancel
							</AlertDialog.Close>
							<Button size="sm" onClick={saveSettings}>
								Save
							</Button>
						</div>
					</AlertDialog.Popup>
				</AlertDialog.Viewport>
			</AlertDialog.Portal>
		</AlertDialog.Root>

		{/* Help Modal */}
		<AlertDialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
				<AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
					<AlertDialog.Popup className="w-full max-w-xs rounded-xl border border-border bg-background p-5 shadow-xl">
						<AlertDialog.Title className="text-base font-semibold">Keyboard Shortcuts</AlertDialog.Title>
						<div className="mt-3 space-y-2">
							{SHORTCUTS.map(([key, desc]) => (
								<div key={key} className="flex items-center justify-between gap-4">
									<kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground shrink-0">{key}</kbd>
									<span className="text-sm text-muted-foreground">{desc}</span>
								</div>
							))}
						</div>
						<p className="mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tips</p>
						<ul className="mt-1.5 space-y-1 text-xs text-muted-foreground list-disc list-inside">
							<li>Drag & drop files onto the window</li>
							<li>Paste a URL or image from clipboard</li>
							<li>⌘+click to multi-select, then bulk delete / tag / collect</li>
						</ul>
						<div className="mt-5 flex justify-end">
							<AlertDialog.Close render={<Button size="sm" />}>
								Close
							</AlertDialog.Close>
						</div>
					</AlertDialog.Popup>
				</AlertDialog.Viewport>
			</AlertDialog.Portal>
		</AlertDialog.Root>
		</>
	);
}

export default TopNav;
