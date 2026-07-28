import { renderMarkdown, type TextLang } from "../lib/richtext";
import { cn } from "../lib/utils";

/** Monospace source block. Shared so preview, save and purge dialogs match. */
export const CODE_BLOCK =
	"overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-muted-foreground text-xs leading-relaxed";

/**
 * The pretty side of a text file: Markdown and HTML render, everything else
 * shows the source. `text` is the live editor buffer, so the rendered view
 * follows edits without a save round-trip. Each branch owns its own frame — the
 * iframe brings its own border and scrolling, so wrapping it in the scroll pane
 * would double both.
 *
 * `className` sets the height, because the two callers differ: the editor page
 * fills the viewport, the save dialog gets a short scroll pane.
 */
export function RichTextViewer({
	text,
	lang,
	className,
}: {
	text: string;
	lang: TextLang;
	className?: string;
}) {
	if (lang === "markdown") {
		return (
			<div
				className={cn(
					"overflow-auto rounded-md border bg-muted p-4",
					className,
				)}
			>
				<div
					className="markdown-body"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify in renderMarkdown
					dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
				/>
			</div>
		);
	}
	if (lang === "html") {
		// Not sanitized on purpose: a sandbox="" iframe already blocks scripts,
		// forms, popups and same-origin access, and sanitizing would show the
		// operator something other than the file they are editing.
		return (
			<iframe
				className={cn("w-full rounded-md border bg-white", className)}
				sandbox=""
				srcDoc={text}
				title="HTML preview"
			/>
		);
	}
	return <pre className={cn(CODE_BLOCK, "p-4", className)}>{text}</pre>;
}
