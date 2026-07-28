import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { Markdown } from "tiptap-markdown";
import { Separator } from "./ui/separator";
import { Toggle } from "./ui/toggle";

/**
 * Notion-style writing surface for Markdown files.
 *
 * The document of record is always Markdown text — the ProseMirror tree is a
 * view, never the thing that gets saved. `tiptap-markdown` parses on the way in
 * and serialises on the way out, so `onChange` hands back plain Markdown and
 * `putObjectText` writes the same kind of bytes it always did.
 *
 * The Notion feel comes from StarterKit's input rules, not from a command menu:
 * typing `# `, `- `, `1. `, `> `, ``` or `**bold**` converts as you type, which
 * is exactly the Markdown a Markdown file already contains.
 *
 * Ceiling: this is a round trip through a parser, so it normalises formatting —
 * `*` bullets become `-`, setext headings become ATX, wrapping is redone. The
 * Code tab is the byte-exact editor; this one is for prose.
 */
export default function RichMarkdownEditor({
	value,
	onChange,
}: {
	value: string;
	onChange: (next: string) => void;
}) {
	// What this editor last produced. Anything else arriving in `value` is an
	// outside edit (Reset, or a switch back from the Code tab) and has to be
	// pushed into the document; echoing our own output back would reset the
	// cursor on every keystroke.
	const emitted = useRef(value);
	const editor = useEditor({
		content: value,
		extensions: [
			StarterKit,
			Markdown.configure({ html: true, transformPastedText: true }),
		],
		editorProps: {
			attributes: {
				class:
					"markdown-body min-h-full px-6 py-5 focus:outline-none [&_*]:outline-none",
			},
		},
		onUpdate: ({ editor: instance }) => {
			// tiptap-markdown augments `Storage` for Tiptap v2 only, so v3 needs the
			// cast. The runtime key is unchanged.
			const markdown = (
				instance.storage as unknown as {
					markdown: { getMarkdown: () => string };
				}
			).markdown.getMarkdown();
			emitted.current = markdown;
			onChange(markdown);
		},
	});

	useEffect(() => {
		if (editor && value !== emitted.current) {
			emitted.current = value;
			editor.commands.setContent(value);
		}
	}, [editor, value]);

	if (!editor) {
		return null;
	}

	const marks = [
		{ label: "B", name: "bold", title: "Bold", className: "font-bold" },
		{ label: "I", name: "italic", title: "Italic", className: "italic" },
		{
			label: "S",
			name: "strike",
			title: "Strikethrough",
			className: "line-through",
		},
		{ label: "<>", name: "code", title: "Inline code", className: "font-mono" },
	] as const;

	const blocks = [
		{
			label: "H1",
			title: "Heading 1",
			name: "heading",
			attrs: { level: 1 as const },
		},
		{
			label: "H2",
			title: "Heading 2",
			name: "heading",
			attrs: { level: 2 as const },
		},
		{
			label: "H3",
			title: "Heading 3",
			name: "heading",
			attrs: { level: 3 as const },
		},
	] as const;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
				{blocks.map((block) => (
					<Toggle
						key={block.label}
						onPressedChange={() =>
							editor.chain().focus().toggleHeading(block.attrs).run()
						}
						pressed={editor.isActive(block.name, block.attrs)}
						size="sm"
						title={block.title}
					>
						{block.label}
					</Toggle>
				))}
				<Separator className="mx-1 h-5" orientation="vertical" />
				{marks.map((mark) => (
					<Toggle
						className={mark.className}
						key={mark.name}
						onPressedChange={() =>
							editor.chain().focus().toggleMark(mark.name).run()
						}
						pressed={editor.isActive(mark.name)}
						size="sm"
						title={mark.title}
					>
						{mark.label}
					</Toggle>
				))}
				<Separator className="mx-1 h-5" orientation="vertical" />
				<Toggle
					onPressedChange={() =>
						editor.chain().focus().toggleBulletList().run()
					}
					pressed={editor.isActive("bulletList")}
					size="sm"
					title="Bullet list"
				>
					List
				</Toggle>
				<Toggle
					onPressedChange={() =>
						editor.chain().focus().toggleOrderedList().run()
					}
					pressed={editor.isActive("orderedList")}
					size="sm"
					title="Numbered list"
				>
					1.
				</Toggle>
				<Toggle
					onPressedChange={() =>
						editor.chain().focus().toggleBlockquote().run()
					}
					pressed={editor.isActive("blockquote")}
					size="sm"
					title="Quote"
				>
					Quote
				</Toggle>
				<Toggle
					onPressedChange={() => editor.chain().focus().toggleCodeBlock().run()}
					pressed={editor.isActive("codeBlock")}
					size="sm"
					title="Code block"
				>
					Code
				</Toggle>
				<span className="ml-auto pr-1 text-muted-foreground text-xs">
					Markdown shortcuts work: <code># </code>, <code>- </code>,{" "}
					<code>&gt; </code>, <code>```</code>
				</span>
			</div>
			<EditorContent className="min-h-0 flex-1 overflow-auto" editor={editor} />
		</div>
	);
}
