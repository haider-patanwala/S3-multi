import DOMPurify from "dompurify";
import { marked } from "marked";
import { extensionForKey } from "./utils";

export type TextLang = "json" | "yaml" | "markdown" | "html" | "text";

const langByExtension: Record<string, TextLang> = {
	json: "json",
	jsonc: "json",
	geojson: "json",
	webmanifest: "json",
	yaml: "yaml",
	yml: "yaml",
	md: "markdown",
	markdown: "markdown",
	mdx: "markdown",
	html: "html",
	htm: "html",
};

/**
 * Extension wins over Content-Type: buckets are full of objects uploaded as
 * application/octet-stream or text/plain that are really JSON or Markdown.
 */
export function detectTextLang(key: string, contentType = ""): TextLang {
	const fromExtension = langByExtension[extensionForKey(key)];
	if (fromExtension) {
		return fromExtension;
	}
	if (contentType.includes("json")) {
		return "json";
	}
	if (contentType.includes("yaml") || contentType.includes("yml")) {
		return "yaml";
	}
	if (contentType.includes("markdown")) {
		return "markdown";
	}
	if (contentType.includes("html")) {
		return "html";
	}
	return "text";
}

/**
 * Parser plus only the plugins that parser needs. Loading the full set would
 * pull every Prettier language (~350 kB gzipped) in to reformat one JSON file.
 */
const formatterByLang: Record<
	TextLang,
	{ parser: string; load: () => Promise<unknown[]> } | null
> = {
	json: {
		parser: "json",
		load: () =>
			Promise.all([
				import("prettier/plugins/babel"),
				import("prettier/plugins/estree"),
			]),
	},
	yaml: {
		parser: "yaml",
		load: () => Promise.all([import("prettier/plugins/yaml")]),
	},
	markdown: {
		parser: "markdown",
		load: () => Promise.all([import("prettier/plugins/markdown")]),
	},
	html: {
		parser: "html",
		load: () => Promise.all([import("prettier/plugins/html")]),
	},
	text: null,
};

export function canFormat(lang: TextLang) {
	return formatterByLang[lang] !== null;
}

/**
 * Prettier is loaded on demand — it is far larger than the rest of the app and
 * most sessions never open a text file.
 */
export async function formatText(text: string, lang: TextLang) {
	const formatter = formatterByLang[lang];
	if (!formatter) {
		return text;
	}
	const [standalone, plugins] = await Promise.all([
		import("prettier/standalone"),
		formatter.load(),
	]);
	return standalone.format(text, {
		parser: formatter.parser,
		plugins: plugins as NonNullable<
			Parameters<typeof standalone.format>[1]
		>["plugins"],
	});
}

/** Best effort: unparseable text is left exactly as it was. */
export async function formatTextOrKeep(text: string, lang: TextLang) {
	return await formatText(text, lang).catch(() => text);
}

export function renderMarkdown(text: string) {
	return DOMPurify.sanitize(marked.parse(text, { async: false }));
}
