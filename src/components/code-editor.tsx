import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { linter, lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { lintText, type TextLang } from "../lib/richtext";

const languageByLang: Record<TextLang, () => Extension> = {
	json,
	yaml,
	html,
	markdown,
	// No grammar for plain text — CodeMirror still gives line numbers and undo.
	text: () => [],
};

/**
 * Everything visual comes from the shadcn theme tokens rather than a CodeMirror
 * theme package, so the editor tracks light/dark with the rest of the app and
 * there is no second palette to keep in sync.
 */
const themeExtension = EditorView.theme({
	"&": {
		backgroundColor: "transparent",
		color: "var(--foreground)",
		fontSize: "0.8125rem",
	},
	".cm-content": { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
	".cm-gutters": {
		backgroundColor: "transparent",
		color: "var(--muted-foreground)",
		border: "none",
	},
	".cm-activeLine, .cm-activeLineGutter": {
		backgroundColor: "color-mix(in oklch, var(--muted) 60%, transparent)",
	},
	"&.cm-focused": { outline: "none" },
	// The error lens. CodeMirror's stock squiggle is a repeating SVG background
	// image, which sits behind the glyphs and washes out at some zoom levels;
	// `text-decoration: wavy` is drawn by the text engine, so it stays crisp and
	// tracks the font. `skip-ink: none` keeps the wave continuous under a `g` or
	// `y` instead of breaking into dashes.
	".cm-lintRange.cm-lintRange-error": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--destructive)",
		textDecorationSkipInk: "none",
		textDecorationThickness: "1px",
		textUnderlineOffset: "3px",
	},
	".cm-lintRange.cm-lintRange-warning": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--muted-foreground)",
		textDecorationSkipInk: "none",
		textDecorationThickness: "1px",
		textUnderlineOffset: "3px",
	},
	// Hovering the squiggle or the gutter dot shows the message.
	".cm-tooltip.cm-tooltip-lint": {
		backgroundColor: "var(--popover)",
		color: "var(--popover-foreground)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius-md)",
		fontSize: "0.75rem",
		padding: "0.25rem 0",
	},
	".cm-diagnostic-error": { borderLeftColor: "var(--destructive)" },
});

export default function CodeEditor({
	value,
	lang,
	onChange,
}: {
	value: string;
	lang: TextLang;
	onChange: (next: string) => void;
}) {
	const extensions = useMemo(
		() => [
			languageByLang[lang](),
			lintGutter(),
			// Prettier is the parser (see lib/richtext.ts:lintText), so a diagnostic
			// here is the same failure the Format button would report.
			linter(async (view) =>
				(await lintText(view.state.doc.toString(), lang)).map((issue) => ({
					...issue,
					severity: "error" as const,
					source: lang,
				})),
			),
			EditorView.lineWrapping,
			themeExtension,
		],
		[lang],
	);

	return (
		<CodeMirror
			basicSetup={{ foldGutter: true, highlightActiveLine: true }}
			extensions={extensions}
			height="100%"
			onChange={onChange}
			style={{ height: "100%" }}
			value={value}
		/>
	);
}
