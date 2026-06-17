import { RiSearchLine, RiSortAsc, RiSortDesc, RiSettings3Line, RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import {
	forwardRef,
	type RefObject,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSettings, type AnalyzeMode } from "@/hooks/use-settings";

export type Tab = "all" | "collections" | "tags";
export type Sort = "newest" | "oldest";

export interface TopNavHandle {
	startNaming: () => void;
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
}

const TABS: { id: Tab; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "collections", label: "Collections" },
	{ id: "tags", label: "Tags" },
];

const TopNav = forwardRef<TopNavHandle, TopNavProps>(function TopNav(
	{
		activeTab,
		onTabChange,
		searchQuery,
		onSearchChange,
		sort,
		onSortChange,
		onCreateCollection,
		searchInputRef,
	}: TopNavProps,
	ref: React.Ref<TopNavHandle>,
) {
	const [naming, setNaming] = useState(false);
	const [nameValue, setNameValue] = useState("");
	const nameInputRef = useRef<HTMLInputElement>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [apiKeyValue, setApiKeyValue] = useState("");
	const [showApiKey, setShowApiKey] = useState(false);
	const [analyzeMode, setAnalyzeMode] = useState<AnalyzeMode>("manual");
	const [modelValue, setModelValue] = useState("anthropic/claude-sonnet-4-6");
	const { getSetting, setSetting } = useSettings();

	useImperativeHandle(ref, () => ({ startNaming }));

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
		const key = await getSetting("api_key");
		const mode = await getSetting("analyze_mode") as AnalyzeMode | null;
		const model = await getSetting("model");
		setApiKeyValue(key ?? "");
		setAnalyzeMode(mode ?? "manual");
		setModelValue(model ?? "anthropic/claude-sonnet-4-6");
		setShowApiKey(false);
		setSettingsOpen(true);
	};

	const saveSettings = async () => {
		await setSetting("api_key", apiKeyValue);
		await setSetting("analyze_mode", analyzeMode);
		await setSetting("model", modelValue);
		setSettingsOpen(false);
	};

	return (
		<>
		<div
			data-tauri-drag-region
			className="flex h-12 flex-shrink-0 items-center border-b border-border bg-background pl-[120px] pr-4"
		>
			{/* Logo */}
			<span className="shrink-0 select-none text-2xl font-black uppercase leading-none text-foreground cap-trim">
				KEEP
			</span>

			{/* Tabs — left-aligned, 188px after logo */}
			<div className="flex items-center gap-12 ml-[188px]">
				{TABS.map((tab) => (
					<button
						type="button"
						key={tab.id}
						onClick={() => {
							onTabChange(tab.id);
							setNaming(false);
						}}
						className={[
							"shrink-0 text-2xl font-bold uppercase leading-none transition-colors cap-trim",
							activeTab === tab.id
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						].join(" ")}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* Right controls */}
			<div className="ml-auto flex items-center gap-2 shrink-0">
				{/* Search */}
				<div className="relative">
					<RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
					<input
						ref={searchInputRef}
						value={searchQuery}
						onChange={(e) => onSearchChange(e.target.value)}
						placeholder="Search..."
						className="h-7 w-48 rounded-full border border-input bg-input/30 pl-7 pr-3 py-1 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
					/>
				</div>

				{/* Sort toggle */}
				<button
					type="button"
					onClick={() => onSortChange(sort === "newest" ? "oldest" : "newest")}
					title={sort === "newest" ? "Newest first" : "Oldest first"}
					className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
				>
					{sort === "newest" ? (
						<RiSortDesc className="size-4" />
					) : (
						<RiSortAsc className="size-4" />
					)}
				</button>

				{/* Settings */}
				<button
					type="button"
					onClick={openSettings}
					title="Settings"
					className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
				>
					<RiSettings3Line className="size-4" />
				</button>

				{/* New collection (collections tab only) */}
				{activeTab === "collections" &&
					(naming ? (
						<input
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
			</div>
		</div>

		{/* Settings Modal */}
		<AlertDialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
				<AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
					<AlertDialog.Popup className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-xl">
						<AlertDialog.Title className="text-base font-semibold">Settings</AlertDialog.Title>

						<div className="mt-4 space-y-4">
							{/* API Key */}
							<div>
								<label className="mb-1.5 block text-sm font-medium">OpenRouter API Key</label>
								<div className="relative">
									<input
										type={showApiKey ? "text" : "password"}
										value={apiKeyValue}
										onChange={(e) => setApiKeyValue(e.target.value)}
										placeholder="sk-or-..."
										className="h-9 w-full rounded-md border border-input bg-background px-3 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring"
									/>
									<button
										type="button"
										onClick={() => setShowApiKey((v) => !v)}
										className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
									>
										{showApiKey ? <RiEyeOffLine className="size-4" /> : <RiEyeLine className="size-4" />}
									</button>
								</div>
							</div>

							{/* Model */}
							<div>
								<label className="mb-1.5 block text-sm font-medium">Model</label>
								<input
									type="text"
									value={modelValue}
									onChange={(e) => setModelValue(e.target.value)}
									placeholder="anthropic/claude-sonnet-4-6"
									className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
								/>
							</div>

							{/* Analyze Mode */}
							<div>
								<label className="mb-1.5 block text-sm font-medium">Auto-analyze on open</label>
								<select
									value={analyzeMode}
									onChange={(e) => setAnalyzeMode(e.target.value as AnalyzeMode)}
									className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
								>
									<option value="manual">Off</option>
									<option value="auto_new">Auto — unanalyzed images only</option>
									<option value="auto_all">Auto — all images (re-analyze)</option>
								</select>
							</div>
						</div>

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
		</>
	);
});

export default TopNav;
