// PROTOTYPE — wayfinder ticket #3: "Bookmarks tab & post cards in grid".
// Three variants of how kind='post'/'link' items render in the masonry grid,
// switchable via ?variant=A|B|C (floating bottom bar, ← → keys).
// Throwaway code: delete this file and its Grid/TopNav hooks once a variant wins.

import {
	RiArrowLeftSLine,
	RiArrowRightSLine,
	RiGlobalLine,
	RiPlayFill,
	RiStackLine,
	RiTwitterXLine,
} from "@remixicon/react";
import { useEffect, useSyncExternalStore } from "react";
import type { Image } from "@/hooks/use-images";

const VARIANTS = ["A", "B", "C"] as const;
type Variant = (typeof VARIANTS)[number];
const VARIANT_NAMES: Record<Variant, string> = {
	A: "Tweet embed",
	B: "Media-first",
	C: "Note card",
};

// --- ?variant= plumbing (no router in this app) ---

const listeners = new Set<() => void>();

function getVariant(): Variant {
	const v = new URLSearchParams(window.location.search)
		.get("variant")
		?.toUpperCase();
	return VARIANTS.includes(v as Variant) ? (v as Variant) : "A";
}

function setVariant(v: Variant) {
	const url = new URL(window.location.href);
	url.searchParams.set("variant", v);
	history.replaceState(null, "", url);
	for (const l of listeners) l();
}

function cycleVariant(dir: 1 | -1) {
	const idx = VARIANTS.indexOf(getVariant());
	setVariant(VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length]);
}

export function usePrototypeVariant(): Variant {
	return useSyncExternalStore((cb) => {
		listeners.add(cb);
		window.addEventListener("popstate", cb);
		return () => {
			listeners.delete(cb);
			window.removeEventListener("popstate", cb);
		};
	}, getVariant);
}

// --- post_meta shape (ticket #2 sidecar + existing link fields) ---

interface ProtoMeta {
	platform?: string;
	siteName?: string | null;
	url?: string;
	title?: string | null;
	description?: string | null;
	authorName?: string | null;
	handle?: string | null;
	avatarUrl?: string | null;
	caption?: string | null;
	imageUrls?: string[];
	localImages?: string[];
	hasVideo?: boolean;
	timestamp?: string | null;
	quoted?: {
		authorName?: string;
		handle?: string;
		caption?: string;
	} | null;
}

function parseMeta(image: Image): ProtoMeta | null {
	try {
		return image.post_meta ? (JSON.parse(image.post_meta) as ProtoMeta) : null;
	} catch {
		return null;
	}
}

function mediaPaths(image: Image, meta: ProtoMeta): string[] {
	if (meta.localImages?.length) return meta.localImages;
	return image.file_path ? [image.file_path] : [];
}

function shortDate(ts?: string | null): string {
	if (!ts) return "";
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function domainOf(meta: ProtoMeta, image: Image): string {
	const url = meta.url ?? image.source_url ?? "";
	return url.split("://")[1]?.split("/")[0]?.replace(/^www\./, "") ?? "";
}

function PlatformIcon({ meta, className }: { meta: ProtoMeta; className?: string }) {
	return meta.platform === "twitter" ? (
		<RiTwitterXLine className={className} />
	) : (
		<RiGlobalLine className={className} />
	);
}

// --- Variant A — "Tweet embed": bordered card, header byline, caption, media below ---

function MediaGridA({ paths, hasVideo, imgSrc }: { paths: string[]; hasVideo?: boolean; imgSrc: (p: string) => string }) {
	if (paths.length === 0) return null;
	if (paths.length === 1) {
		return (
			<div className="relative">
				<img src={imgSrc(paths[0])} alt="" draggable={false} className="block w-full object-cover" />
				{hasVideo && (
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="flex size-10 items-center justify-center rounded-full bg-black/60">
							<RiPlayFill className="size-5 text-white" />
						</div>
					</div>
				)}
			</div>
		);
	}
	return (
		<div className="grid grid-cols-2 gap-px bg-border">
			{paths.slice(0, 4).map((p, i) => (
				<div key={p} className="relative aspect-square">
					<img src={imgSrc(p)} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
					{i === 3 && paths.length > 4 && (
						<div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">
							+{paths.length - 4}
						</div>
					)}
				</div>
			))}
		</div>
	);
}

function QuotedBlock({ quoted }: { quoted: NonNullable<ProtoMeta["quoted"]> }) {
	return (
		<div className="rounded-md border border-border px-2.5 py-2">
			<p className="text-[11px] font-medium text-muted-foreground">
				{quoted.authorName}
				{quoted.handle ? <span className="font-normal opacity-70"> @{quoted.handle}</span> : null}
			</p>
			<p className="mt-0.5 line-clamp-3 text-xs leading-snug">{quoted.caption}</p>
		</div>
	);
}

function VariantA({ image, meta, imgSrc }: { image: Image; meta: ProtoMeta; imgSrc: (p: string) => string }) {
	const paths = mediaPaths(image, meta);
	if (image.kind === "link") {
		return (
			<div className="border border-border bg-card">
				{paths[0] && <img src={imgSrc(paths[0])} alt="" draggable={false} className="block w-full object-cover" />}
				<div className="px-3 py-2.5">
					<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						{meta.siteName ?? domainOf(meta, image)}
					</p>
					{meta.title && <p className="mt-1 text-[13px] font-semibold leading-snug">{meta.title}</p>}
					{meta.description && (
						<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{meta.description}</p>
					)}
				</div>
			</div>
		);
	}
	return (
		<div className="border border-border bg-card">
			<div className="flex items-center gap-2 px-3 pt-3">
				{meta.avatarUrl && (
					<img src={meta.avatarUrl} alt="" draggable={false} className="size-8 shrink-0 rounded-full object-cover" />
				)}
				<div className="min-w-0 leading-tight">
					<p className="truncate text-[13px] font-semibold">{meta.authorName}</p>
					<p className="truncate text-[11px] text-muted-foreground">
						@{meta.handle}
						{meta.timestamp ? ` · ${shortDate(meta.timestamp)}` : ""}
					</p>
				</div>
				<PlatformIcon meta={meta} className="ml-auto size-4 shrink-0 text-muted-foreground" />
			</div>
			{meta.caption && <p className="px-3 pt-2 text-[13px] leading-snug">{meta.caption}</p>}
			{meta.quoted && (
				<div className="px-3 pt-2">
					<QuotedBlock quoted={meta.quoted} />
				</div>
			)}
			<div className={paths.length > 0 ? "pt-2.5" : "pb-3"}>
				<MediaGridA paths={paths} hasVideo={meta.hasVideo} imgSrc={imgSrc} />
			</div>
		</div>
	);
}

// --- Variant B — "Media-first": media fills card, overlay byline; text-only = typographic card ---

function VariantB({ image, meta, imgSrc }: { image: Image; meta: ProtoMeta; imgSrc: (p: string) => string }) {
	const paths = mediaPaths(image, meta);
	const isLink = image.kind === "link";

	if (paths.length === 0) {
		// text-only → typographic card on dark ground
		return (
			<div
				className="relative flex flex-col justify-between gap-6 px-4 pb-4 pt-5 text-white"
				style={{ backgroundColor: image.dominant_color ?? "#1a1a1a" }}
			>
				<PlatformIcon meta={meta} className="absolute right-3 top-3 size-3.5 text-white/50" />
				<p className="pr-5 text-[15px] font-medium leading-snug">
					{isLink ? meta.title : meta.caption}
				</p>
				{meta.quoted && (
					<div className="border-l-2 border-white/25 pl-2.5">
						<p className="text-[11px] font-medium text-white/60">{meta.quoted.authorName}</p>
						<p className="mt-0.5 line-clamp-3 text-xs leading-snug text-white/80">{meta.quoted.caption}</p>
					</div>
				)}
				<div className="flex items-center gap-1.5">
					{meta.avatarUrl && (
						<img src={meta.avatarUrl} alt="" draggable={false} className="size-4 rounded-full object-cover" />
					)}
					<p className="truncate text-[11px] text-white/60">
						{isLink ? (meta.siteName ?? domainOf(meta, image)) : `@${meta.handle}`}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="relative">
			<img src={imgSrc(paths[0])} alt="" draggable={false} className="block w-full object-cover" />
			{/* badges */}
			<div className="absolute left-2 top-2 flex size-5 items-center justify-center rounded-full bg-black/55">
				<PlatformIcon meta={meta} className="size-3 text-white" />
			</div>
			{paths.length > 1 && (
				<span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
					<RiStackLine className="size-3" />
					{paths.length}
				</span>
			)}
			{meta.hasVideo && (
				<div className="absolute inset-0 flex items-center justify-center">
					<div className="flex size-10 items-center justify-center rounded-full bg-black/60">
						<RiPlayFill className="size-5 text-white" />
					</div>
				</div>
			)}
			{/* byline overlay */}
			<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-2.5 pb-2 pt-10">
				<div className="flex items-center gap-1.5">
					{meta.avatarUrl && (
						<img src={meta.avatarUrl} alt="" draggable={false} className="size-4 rounded-full object-cover" />
					)}
					<p className="truncate text-[11px] font-medium text-white">
						{isLink ? (meta.siteName ?? domainOf(meta, image)) : meta.authorName}
					</p>
				</div>
				<p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/85">
					{isLink ? meta.title : meta.caption}
				</p>
			</div>
		</div>
	);
}

// --- Variant C — "Note card": caption-first, media as thumbnail strip ---

function VariantC({ image, meta, imgSrc }: { image: Image; meta: ProtoMeta; imgSrc: (p: string) => string }) {
	const paths = mediaPaths(image, meta);
	const isLink = image.kind === "link";
	return (
		<div className="flex flex-col gap-2.5 border border-border bg-card p-3">
			<div className="flex items-center gap-1.5 text-muted-foreground">
				{meta.avatarUrl ? (
					<img src={meta.avatarUrl} alt="" draggable={false} className="size-4 rounded-full object-cover" />
				) : (
					<PlatformIcon meta={meta} className="size-3.5" />
				)}
				<p className="min-w-0 truncate text-[11px]">
					{isLink ? (meta.siteName ?? domainOf(meta, image)) : `${meta.authorName} · @${meta.handle}`}
					{meta.timestamp ? ` · ${shortDate(meta.timestamp)}` : ""}
				</p>
				{!isLink && <PlatformIcon meta={meta} className="ml-auto size-3.5 shrink-0" />}
			</div>
			{isLink ? (
				<div>
					{meta.title && <p className="text-sm font-semibold leading-snug">{meta.title}</p>}
					{meta.description && (
						<p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{meta.description}</p>
					)}
				</div>
			) : (
				meta.caption && <p className="text-[13px] leading-relaxed">{meta.caption}</p>
			)}
			{meta.quoted && (
				<div className="border-l-2 border-border pl-2.5">
					<p className="text-[11px] font-medium text-muted-foreground">{meta.quoted.authorName}</p>
					<p className="mt-0.5 line-clamp-3 text-xs leading-snug text-muted-foreground">{meta.quoted.caption}</p>
				</div>
			)}
			{paths.length > 0 && (
				<div className="flex gap-1">
					{paths.slice(0, 4).map((p, i) => (
						<div key={p} className="relative aspect-square w-0 flex-1 overflow-hidden">
							<img src={imgSrc(p)} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
							{i === 0 && meta.hasVideo && (
								<div className="absolute inset-0 flex items-center justify-center bg-black/25">
									<RiPlayFill className="size-4 text-white" />
								</div>
							)}
							{i === 3 && paths.length > 4 && (
								<div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-white">
									+{paths.length - 4}
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// --- Card entry point (Grid.tsx delegates post/link cards here) ---

export function PrototypePostCard({ image, imgSrc }: { image: Image; imgSrc: (p: string) => string }) {
	const variant = usePrototypeVariant();
	const meta = parseMeta(image);
	if (!meta) {
		return image.file_path ? (
			<img src={imgSrc(image.thumb_path || image.file_path)} alt="" draggable={false} className="block w-full" />
		) : null;
	}
	if (variant === "B") return <VariantB image={image} meta={meta} imgSrc={imgSrc} />;
	if (variant === "C") return <VariantC image={image} meta={meta} imgSrc={imgSrc} />;
	return <VariantA image={image} meta={meta} imgSrc={imgSrc} />;
}

// --- Floating switcher bar ---

export function PrototypeSwitcher() {
	const variant = usePrototypeVariant();

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			const t = e.target as HTMLElement | null;
			if (
				t instanceof HTMLInputElement ||
				t instanceof HTMLTextAreaElement ||
				t?.isContentEditable ||
				document.querySelector(".lightbox-overlay") // lightbox owns ← → for navigation
			)
				return;
			e.preventDefault();
			cycleVariant(e.key === "ArrowRight" ? 1 : -1);
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	if (import.meta.env.PROD) return null;

	return (
		<div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/85 px-1.5 py-1 text-white shadow-lg backdrop-blur-sm select-none">
			<button
				type="button"
				aria-label="Previous variant"
				onClick={() => cycleVariant(-1)}
				className="flex size-6 items-center justify-center rounded-full hover:bg-white/15 transition-colors"
			>
				<RiArrowLeftSLine className="size-4" />
			</button>
			<span className="min-w-32 px-1 text-center text-xs font-medium tabular-nums">
				{variant} — {VARIANT_NAMES[variant]}
			</span>
			<button
				type="button"
				aria-label="Next variant"
				onClick={() => cycleVariant(1)}
				className="flex size-6 items-center justify-center rounded-full hover:bg-white/15 transition-colors"
			>
				<RiArrowRightSLine className="size-4" />
			</button>
		</div>
	);
}
