import {
	BinaryCodeIcon,
	CssFile01Icon,
	Csv01Icon,
	Database01Icon,
	Doc01Icon,
	File01Icon,
	FileMusicIcon,
	FileVideoIcon,
	FileZipIcon,
	Folder02Icon,
	FolderOpenIcon,
	Image01Icon,
	JavaScriptIcon,
	Pdf01Icon,
	Ppt01Icon,
	SourceCodeIcon,
	TextFontIcon,
	Txt01Icon,
	Xls01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ObjectEntry } from "../lib/types";
import { cn, extensionForKey } from "../lib/utils";

/**
 * Extension → glyph. Grouped by what the operator is deciding, not by MIME
 * pedantry: "can I look at this", "is this text I can edit", "is this an
 * archive I'd have to unpack". Anything unmapped falls back to a plain sheet,
 * which is honest — an unknown extension IS just bytes.
 */
const GLYPHS: Record<string, typeof File01Icon> = {
	// images
	jpg: Image01Icon,
	jpeg: Image01Icon,
	png: Image01Icon,
	gif: Image01Icon,
	webp: Image01Icon,
	avif: Image01Icon,
	svg: Image01Icon,
	bmp: Image01Icon,
	ico: Image01Icon,
	tiff: Image01Icon,
	heic: Image01Icon,
	// video
	mp4: FileVideoIcon,
	webm: FileVideoIcon,
	mov: FileVideoIcon,
	avi: FileVideoIcon,
	mkv: FileVideoIcon,
	m4v: FileVideoIcon,
	// audio
	mp3: FileMusicIcon,
	wav: FileMusicIcon,
	flac: FileMusicIcon,
	aac: FileMusicIcon,
	ogg: FileMusicIcon,
	m4a: FileMusicIcon,
	// documents
	pdf: Pdf01Icon,
	doc: Doc01Icon,
	docx: Doc01Icon,
	rtf: Doc01Icon,
	odt: Doc01Icon,
	xls: Xls01Icon,
	xlsx: Xls01Icon,
	ods: Xls01Icon,
	ppt: Ppt01Icon,
	pptx: Ppt01Icon,
	// plain text & data
	txt: Txt01Icon,
	log: Txt01Icon,
	md: Txt01Icon,
	mdx: Txt01Icon,
	rst: Txt01Icon,
	csv: Csv01Icon,
	tsv: Csv01Icon,
	// code & config
	js: JavaScriptIcon,
	mjs: JavaScriptIcon,
	cjs: JavaScriptIcon,
	jsx: JavaScriptIcon,
	ts: SourceCodeIcon,
	tsx: SourceCodeIcon,
	json: SourceCodeIcon,
	yml: SourceCodeIcon,
	yaml: SourceCodeIcon,
	toml: SourceCodeIcon,
	xml: SourceCodeIcon,
	html: SourceCodeIcon,
	htm: SourceCodeIcon,
	py: SourceCodeIcon,
	rb: SourceCodeIcon,
	go: SourceCodeIcon,
	rs: SourceCodeIcon,
	java: SourceCodeIcon,
	php: SourceCodeIcon,
	sh: SourceCodeIcon,
	css: CssFile01Icon,
	scss: CssFile01Icon,
	less: CssFile01Icon,
	// archives
	zip: FileZipIcon,
	tar: FileZipIcon,
	gz: FileZipIcon,
	tgz: FileZipIcon,
	rar: FileZipIcon,
	"7z": FileZipIcon,
	bz2: FileZipIcon,
	// data stores
	sql: Database01Icon,
	db: Database01Icon,
	sqlite: Database01Icon,
	parquet: Database01Icon,
	// fonts
	woff: TextFontIcon,
	woff2: TextFontIcon,
	ttf: TextFontIcon,
	otf: TextFontIcon,
	eot: TextFontIcon,
	// binaries
	exe: BinaryCodeIcon,
	dmg: BinaryCodeIcon,
	bin: BinaryCodeIcon,
	wasm: BinaryCodeIcon,
	so: BinaryCodeIcon,
};

export function iconForEntry(item: Pick<ObjectEntry, "kind" | "key">) {
	if (item.kind === "folder") {
		return Folder02Icon;
	}
	return GLYPHS[extensionForKey(item.key)] ?? File01Icon;
}

/**
 * The extension, shown as a label beside the glyph. The glyph gives the family
 * at a glance; the label disambiguates within it (a .ts and a .yaml share a
 * glyph but are not the same thing). Empty for extensionless keys rather than
 * inventing a placeholder.
 */
export function extensionLabel(item: Pick<ObjectEntry, "kind" | "key">) {
	if (item.kind === "folder") {
		return "";
	}
	const extension = extensionForKey(item.key);
	// A key with no dot returns the whole name from extensionForKey; treat an
	// implausibly long "extension" as no extension at all.
	return extension && extension.length <= 5 ? extension : "";
}

const GLYPH_SIZES = {
	sm: "size-6 rounded-sm",
	md: "size-8 rounded-md",
	lg: "size-11 rounded-lg",
} as const;

/**
 * Folders get the accent tile, files the muted one. That is the one place
 * colour is allowed to differ here, because it encodes the only distinction
 * that changes what a click does: descend, or open.
 */
export function FileGlyph({
	item,
	open = false,
	size = "md",
	className,
}: {
	item: Pick<ObjectEntry, "kind" | "key">;
	open?: boolean;
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	const icon =
		item.kind === "folder" && open ? FolderOpenIcon : iconForEntry(item);
	const pixels = size === "sm" ? 15 : size === "lg" ? 22 : 18;

	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center border",
				GLYPH_SIZES[size],
				item.kind === "folder"
					? "border-primary/20 bg-primary/10 text-foreground"
					: "bg-muted text-muted-foreground",
				className,
			)}
		>
			<HugeiconsIcon icon={icon} size={pixels} strokeWidth={1.5} />
		</span>
	);
}
