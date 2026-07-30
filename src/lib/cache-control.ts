import { extensionForKey } from "./utils";

/**
 * Cache-Control is what makes a CDN worth paying for: without it Cloudflare and
 * CloudFront fall back to short, conservative TTLs and re-fetch from the bucket,
 * so every viewer costs another Class B operation plus egress. With it the edge
 * answers for free until the TTL expires.
 *
 * The cost of a long TTL is staleness after an edit, which is what the purge
 * command in the save drawer is for.
 */
export type CachePreset = {
	label: string;
	value: string;
	hint: string;
};

export const CACHE_PRESETS: CachePreset[] = [
	{
		label: "Immutable — 1 year",
		value: "public, max-age=31536000, immutable",
		hint: "For files whose name changes when the content does (hashed assets). Never needs a purge.",
	},
	{
		label: "Long — 1 day",
		value: "public, max-age=86400",
		hint: "Media and static assets that rarely change. Purge after editing.",
	},
	{
		label: "Short — 5 minutes",
		value: "public, max-age=300, must-revalidate",
		hint: "Text and config you edit in place. Cheap at the edge, refreshes on its own.",
	},
	{
		label: "No caching",
		value: "no-store",
		hint: "Every request hits the bucket. Costs the most — use only for content that must never be stale.",
	},
];

const IMMUTABLE_MEDIA = new Set([
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"avif",
	"ico",
	"bmp",
	"tiff",
	"heic",
	"mp4",
	"webm",
	"mov",
	"mp3",
	"wav",
	"flac",
	"ogg",
	"woff",
	"woff2",
	"ttf",
	"otf",
	"zip",
	"tar",
	"gz",
	"pdf",
]);

/**
 * A safe default for a key we know nothing else about.
 *
 * Editable text deliberately does NOT get a year-long TTL: those are the files
 * this app rewrites in place under the same name, and an immutable TTL on them
 * strands the old bytes at the edge until someone purges. Media keeps the long
 * TTL, which is where the bandwidth savings actually are.
 */
export function suggestCacheControl(key: string) {
	return IMMUTABLE_MEDIA.has(extensionForKey(key))
		? "public, max-age=31536000, immutable"
		: "public, max-age=300, must-revalidate";
}

/** Seconds an edge may serve this without revalidating; 0 when uncacheable. */
export function maxAgeOf(cacheControl?: string) {
	if (!cacheControl) {
		return 0;
	}
	const value = cacheControl.toLowerCase();
	if (value.includes("no-store") || value.includes("no-cache")) {
		return 0;
	}
	// s-maxage wins for shared caches, which is exactly what a CDN edge is.
	const shared = value.match(/s-maxage\s*=\s*(\d+)/);
	const browser = value.match(/max-age\s*=\s*(\d+)/);
	const seconds = shared?.[1] ?? browser?.[1];
	return seconds ? Number(seconds) : 0;
}

/** Whether an edit to this object can be served stale from a CDN edge. */
export function isCached(cacheControl?: string) {
	return maxAgeOf(cacheControl) > 0;
}

export function describeCacheControl(cacheControl?: string) {
	if (!cacheControl) {
		return "No Cache-Control set — the CDN picks its own TTL and may keep hitting the bucket.";
	}
	const seconds = maxAgeOf(cacheControl);
	if (seconds === 0) {
		return "Not cached — every request reaches the bucket.";
	}
	if (seconds >= 86400) {
		const days = Math.round(seconds / 86400);
		return `Cached at the edge for ${days} day${days > 1 ? "s" : ""} — purge after saving or viewers keep the old file.`;
	}
	if (seconds >= 3600) {
		const hours = Math.round(seconds / 3600);
		return `Cached at the edge for ${hours} hour${hours > 1 ? "s" : ""} — purge after saving or viewers keep the old file.`;
	}
	const minutes = Math.max(1, Math.round(seconds / 60));
	return `Cached at the edge for ${minutes} minute${minutes > 1 ? "s" : ""}.`;
}
