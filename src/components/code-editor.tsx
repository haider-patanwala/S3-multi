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
	".cm-lintRange-error": {
		// The error lens: the offending token is underlined in place, and the
		// gutter marker carries the message on hover.
		backgroundImage: "none",
		textDecoration: "underline wavy var(--destructive)",
		textUnderlineOffset: "3px",
	},
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
