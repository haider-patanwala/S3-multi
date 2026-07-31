import DOMPurify from "dompurify";
import { marked } from "marked";
// Explicit .ts so `node src/lib/richtext.check.ts` can resolve it.
import { extensionForKey } from "./utils.ts";

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

export type Diagnostic = { from: number; to: number; message: string };

/**
 * Every diagnostic has to underline at least one character. A parser that fails
 * on an unterminated construct reports at EOF, and a range starting there is
 * zero-width — CodeMirror renders nothing, so the error is invisible.
 */
function clampStart(text: string, offset: number) {
	return Math.max(0, Math.min(offset, text.length - 1));
}

/** 1-based line/column (how every parser here reports) → document offset. */
function offsetOfLineCol(text: string, line: number, column: number) {
	const lines = text.split("\n");
	let offset = 0;
	for (let i = 0; i < line - 1 && i < lines.length; i += 1) {
		offset += lines[i].length + 1;
	}
	return offset + Math.max(0, column - 1);
}

/** Prettier reports `cause.index` (babel), `loc.start.offset` (yaml), or only
 * line/column. Normalise all three to a document offset. */
function offsetOfError(text: string, error: unknown): number {
	const loc = (
		error as {
			loc?: { start?: { line?: number; column?: number; offset?: number } };
		}
	)?.loc?.start;
	const index = (error as { cause?: { index?: number } })?.cause?.index;
	if (typeof index === "number") {
		return index;
	}
	if (typeof loc?.offset === "number") {
		return loc.offset;
	}
	if (typeof loc?.line !== "number") {
		return 0;
	}
	return offsetOfLineCol(text, loc.line, loc.column ?? 1);
}

/**
 * JSON and YAML: the syntax check *is* the formatter. Prettier already parses
 * both, so "it does not format" and "it does not parse" are the same question,
 * and the answer is already a dependency. It stops at the first error.
 */
async function lintWithPrettier(
	text: string,
	lang: TextLang,
): Promise<Diagnostic[]> {
	try {
		await formatText(text, lang);
		return [];
	} catch (error) {
		// Clamped to the last character, not past it: an unterminated construct
		// reports at EOF, and a zero-width range draws no underline at all.
		const from = clampStart(text, offsetOfError(text, error));
		return [
			{
				from,
				to: Math.min(from + 1, text.length),
				message:
					error instanceof Error ? error.message.split("\n")[0] : String(error),
			},
		];
	}
}

/**
 * HTML needs its own checker, and the obvious candidates were measured and
 * rejected:
 *
 * - Prettier's `html` parser and lezer (`@codemirror/lang-html`) are both
 *   error-tolerant by design. Neither reports an unclosed `<p>` or a stray
 *   `</span>` at all.
 * - `parse5` reports HTML5 *spec* parse errors, which is a different question:
 *   it fires `missing-doctype` on every fragment and still says nothing about
 *   an unclosed `<div>`, because the spec tolerates one.
 *
 * htmlhint answers the question an editor actually asks — is this markup
 * balanced and well-formed — and reports every error, not just the first.
 *
 * The rule list is syntax only. htmlhint's default ruleset also carries style
 * opinions (lowercase tag names, double-quoted attributes, doctype required,
 * `<title>` required) that would light up correct files pulled out of a bucket.
 */
const HTML_RULES = {
	"tag-pair": true,
	"tagname-specialchars": true,
	"empty-tag-not-self-closed": false,
	"spec-char-escape": true,
	"id-unique": true,
	"attr-no-duplication": true,
	"attr-no-unnecessary-whitespace": false,
	"src-not-empty": true,
};

async function lintHtml(text: string): Promise<Diagnostic[]> {
	// Loaded on demand, like Prettier: most sessions never open an HTML file.
	// htmlhint is CJS with no `exports` map, so Vite's interop hands back a named
	// export while node's ESM loader hands back `default`. Take either — this
	// module has to run in the app *and* under `node richtext.check.ts`.
	// Types are declared in src/htmlhint.d.ts; the package ships none.
	const loaded = await import("htmlhint");
	const HTMLHint = loaded.HTMLHint ?? loaded.default?.HTMLHint;
	if (!HTMLHint) {
		return [];
	}
	return HTMLHint.verify(text, HTML_RULES).map((message) => {
		const from = clampStart(
			text,
			offsetOfLineCol(text, message.line, message.col),
		);
		// `raw` is the offending markup, but for "missing close tag" htmlhint
		// anchors at the *unclosed* tag while `raw` holds the tag that exposed the
		// problem. Underline it only when it is really there, else to end of line.
		const lineEnd = text.indexOf("\n", from);
		const to = text.startsWith(message.raw ?? "", from)
			? from + (message.raw?.length ?? 1)
			: lineEnd === -1
				? text.length
				: lineEnd;
		return {
			from,
			to: Math.max(from + 1, Math.min(to, text.length)),
			message: message.message,
		};
	});
}

/**
 * Syntax diagnostics for the editor's error lens. No language server: two
 * parsers that are already needed for other reasons, used for the one question
 * an editor has to answer.
 *
 * Ceiling: nothing for Markdown or plain text, and no semantic checks anywhere
 * (no JSON Schema, no "does this href resolve").
 */
export async function lintText(
	text: string,
	lang: TextLang,
): Promise<Diagnostic[]> {
	if (!text.trim()) {
		return [];
	}
	if (lang === "html") {
		return await lintHtml(text);
	}
	// Markdown deliberately excluded: Prettier's markdown parser accepts
	// anything, so linting it would load a 270 kB plugin to always return [].
	if (lang === "json" || lang === "yaml") {
		return await lintWithPrettier(text, lang);
	}
	return [];
}

export function renderMarkdown(text: string) {
	return DOMPurify.sanitize(marked.parse(text, { async: false }));
}
