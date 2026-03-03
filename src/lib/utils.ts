import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ProviderType } from "./types";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatBytes(value?: number) {
	if (!value && value !== 0) {
		return "Unknown";
	}
	if (value === 0) {
		return "0 B";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	const exponent = Math.min(
		Math.floor(Math.log(value) / Math.log(1024)),
		units.length - 1,
	);
	const amount = value / 1024 ** exponent;
	return `${amount.toFixed(amount >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatTimestamp(value?: number | string) {
	if (!value) {
		return "Pending";
	}
	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(value));
}

export function shortProviderLabel(type: ProviderType) {
	switch (type) {
		case "aws":
			return "AWS S3";
		case "r2":
			return "Cloudflare R2";
		default:
			return "Custom S3";
	}
}

export function joinPrefix(prefix: string, segment: string) {
	const normalized = prefix ? prefix.replace(/\/+$/, "") : "";
	return `${normalized ? `${normalized}/` : ""}${segment}`.replace(/^\/+/, "");
}

export function normalizeFolderPrefix(prefix: string) {
	if (!prefix) {
		return "";
	}
	return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function parentPrefix(prefix: string) {
	const trimmed = prefix.replace(/\/$/, "");
	const lastSlash = trimmed.lastIndexOf("/");
	if (lastSlash === -1) {
		return "";
	}
	return `${trimmed.slice(0, lastSlash + 1)}`;
}

const previewableExtensions = new Set([
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"avif",
	"svg",
	"mp4",
	"webm",
	"mov",
	"txt",
	"json",
	"md",
	"csv",
	"yml",
	"yaml",
	"log",
	"xml",
]);

export function extensionForKey(key: string) {
	return key.split(".").pop()?.toLowerCase() ?? "";
}

export function isPreviewableKey(key: string) {
	return previewableExtensions.has(extensionForKey(key));
}

export function objectIcon(key: string) {
	const extension = extensionForKey(key);
	if (
		["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(extension)
	) {
		return "IMG";
	}
	if (["mp4", "webm", "mov"].includes(extension)) {
		return "VID";
	}
	if (
		["txt", "json", "md", "csv", "yml", "yaml", "log", "xml"].includes(
			extension,
		)
	) {
		return "TXT";
	}
	return "OBJ";
}
