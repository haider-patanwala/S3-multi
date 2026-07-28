import { Alert01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { z } from "zod";
import { CODE_BLOCK, RichTextViewer } from "../components/rich-text-viewer";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import {
	CACHE_PRESETS,
	describeCacheControl,
	isCached,
	suggestCacheControl,
} from "../lib/cache-control";
import { buildPurgeCommand, canPurge, purgeCache } from "../lib/cdn";
import {
	objectTextQueryOptions,
	providerQueryOptions,
} from "../lib/query-options";
import {
	canFormat,
	type Diagnostic,
	detectTextLang,
	formatText,
	formatTextOrKeep,
	lintText,
} from "../lib/richtext";
import { putObjectText } from "../lib/s3";
import { cn, formatBytes } from "../lib/utils";

// Both editors are heavy (CodeMirror grammars, ProseMirror) and only this route
// uses them, so they stay out of the bundle every other page pays for.
const CodeEditor = lazy(() => import("../components/code-editor"));
const RichMarkdownEditor = lazy(
	() => import("../components/rich-markdown-editor"),
);

const searchSchema = z.object({
	providerId: z.string().optional(),
	bucket: z.string().optional(),
	key: z.string().default(""),
	prefix: z.string().optional().default(""),
});

export const Route = createFileRoute("/edit")({
	component: EditPage,
	validateSearch: searchSchema,
});

const SECTION_LABEL =
	"font-medium text-muted-foreground text-xs uppercase tracking-wider";

type Mode = "rich" | "code" | "preview";

function EditPage() {
	const search = Route.useSearch();
	const queryClient = useQueryClient();
	const providersQuery = useQuery(providerQueryOptions);
	const provider = (providersQuery.data ?? []).find(
		(entry) => entry.id === search.providerId,
	);
	const sourceQuery = useQuery(
		objectTextQueryOptions({
			provider,
			bucket: search.bucket,
			key: search.key,
		}),
	);

	const lang = detectTextLang(search.key, sourceQuery.data?.contentType ?? "");
	// Markdown is the only language whose rich representation round-trips back to
	// the same kind of file. HTML through a ProseMirror schema would lose <head>,
	// attributes and scripts; JSON and YAML have no rich form at all.
	const canEditRich = lang === "markdown";

	const [text, setText] = useState("");
	const [baseline, setBaseline] = useState("");
	const [mode, setMode] = useState<Mode>("code");
	const [status, setStatus] = useState<{
		text: string;
		error?: boolean;
	} | null>(null);
	const [saveOpen, setSaveOpen] = useState(false);
	const [saveCacheControl, setSaveCacheControl] = useState("");
	const [issues, setIssues] = useState<Diagnostic[]>([]);

	const setErrorMessage = useCallback(
		(message: string) => setStatus({ text: message, error: true }),
		[],
	);

	// The buffer opens pretty-printed while the baseline stays the raw bucket
	// bytes, so "unsaved changes" reflects a real difference against S3 and
	// saving a reformatted file genuinely persists the reformat.
	useEffect(() => {
		const raw = sourceQuery.data?.text;
		if (raw === undefined) {
			return;
		}
		let cancelled = false;
		setBaseline(raw);
		void formatTextOrKeep(
			raw,
			detectTextLang(search.key, sourceQuery.data?.contentType ?? ""),
		).then((formatted) => {
			if (!cancelled) {
				setText(formatted);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [sourceQuery.data, search.key]);

	// Markdown files open in the writing surface; everything else opens in code.
	useEffect(() => {
		setMode(canEditRich ? "rich" : "code");
	}, [canEditRich]);

	// Diagnostics drive the header badge and the warning in the save dialog. A
	// syntax error never blocks a save — sometimes the point of an edit is to
	// hand-fix a file the parser hates — but it must never be invisible either.
	useEffect(() => {
		let cancelled = false;
		const timer = setTimeout(() => {
			void lintText(text, lang).then((next) => {
				if (!cancelled) {
					setIssues(next);
				}
			});
		}, 300);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [text, lang]);

	useEffect(() => {
		if (sourceQuery.error) {
			setErrorMessage(sourceQuery.error.message);
		}
	}, [sourceQuery.error, setErrorMessage]);

	const dirty = text !== baseline;

	// Only worth showing when something can actually go stale: either the object
	// is cached now, or this save is about to make it cacheable.
	const savePurgeCommand = useMemo(() => {
		if (!(provider && search.key)) {
			return undefined;
		}
		if (
			!(isCached(sourceQuery.data?.cacheControl) || isCached(saveCacheControl))
		) {
			return undefined;
		}
		return buildPurgeCommand(provider, [search.key]);
	}, [provider, search.key, sourceQuery.data?.cacheControl, saveCacheControl]);

	const applyFormat = useCallback(() => {
		formatText(text, lang)
			.then(setText)
			.catch((error: unknown) =>
				setErrorMessage(
					error instanceof Error
						? `Cannot format: ${error.message}`
						: "Cannot format this file.",
				),
			);
	}, [text, lang, setErrorMessage]);

	const saveMutation = useMutation({
		mutationFn: async (cacheControl: string) => {
			if (!(provider && search.bucket && search.key && sourceQuery.data)) {
				throw new Error("Nothing to save.");
			}
			// putObjectText writes then reads the object back, so reaching the next
			// line means the bytes are really in the bucket.
			await putObjectText(
				provider,
				search.bucket,
				search.key,
				text,
				sourceQuery.data.contentType,
				cacheControl.trim() || undefined,
			);

			// A stale CDN copy is the other half of "my edit disappeared". AWS can
			// purge in-app; R2 cannot (Cloudflare's API refuses browser calls), so
			// there we point at the copy-paste command instead of failing. Either
			// way a purge problem must never read as a save failure.
			const wasCached =
				isCached(sourceQuery.data.cacheControl) || isCached(cacheControl);
			if (!wasCached) {
				return { saved: text, cacheControl, purge: undefined };
			}
			if (canPurge(provider)) {
				const purge = await purgeCache(provider, [search.key]).catch(
					(error: unknown) =>
						`Saved, but the CDN purge failed: ${
							error instanceof Error ? error.message : String(error)
						}`,
				);
				return { saved: text, cacheControl, purge };
			}
			const needsManualPurge =
				provider.type === "r2" &&
				Boolean(provider.cloudflareZoneId && provider.cloudflareApiToken);
			return {
				saved: text,
				cacheControl,
				purge: needsManualPurge
					? "CDN not purged — copy the command from the save dialog and run it."
					: undefined,
			};
		},
		onSuccess: async ({ saved, cacheControl, purge }) => {
			setBaseline(saved);
			// Keep the cache entry honest: the next visit to this key must not read
			// back the pre-save body from React Query.
			queryClient.setQueryData(
				["object-text", provider?.id, search.bucket, search.key],
				(current: { contentType: string } | undefined) =>
					current
						? {
								...current,
								text: saved,
								cacheControl: cacheControl.trim() || undefined,
							}
						: current,
			);
			setSaveOpen(false);
			setStatus({
				text: purge
					? `Saved to ${search.bucket}. ${purge}`
					: `Saved to ${search.bucket}.`,
			});
			await queryClient.invalidateQueries({
				queryKey: ["objects", provider?.id, search.bucket],
			});
		},
		onError: (error) => {
			setErrorMessage(error instanceof Error ? error.message : "Save failed.");
		},
	});

	// Successes fade; errors stay until the next action replaces them.
	useEffect(() => {
		if (!status || status.error) {
			return;
		}
		const timer = setTimeout(() => setStatus(null), 6000);
		return () => clearTimeout(timer);
	}, [status]);

	const backLink = (
		<Button
			render={
				<Link
					search={{
						providerId: search.providerId,
						bucket: search.bucket,
						prefix: search.prefix,
					}}
					to="/browse"
				/>
			}
			size="sm"
			variant="ghost"
		>
			<HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={1.5} />
			Back to browser
		</Button>
	);

	if (!(search.key && provider && search.bucket)) {
		return (
			<div className="mx-auto max-w-lg py-16 text-center">
				<p className="font-semibold text-lg">Nothing to edit</p>
				<p className="mt-3 text-muted-foreground text-sm">
					This page needs a provider, a bucket and an object key. Open a text
					file from the browser to get here.
				</p>
				<div className="mt-6 flex justify-center">{backLink}</div>
			</div>
		);
	}

	const fileName = search.key.split("/").pop() ?? search.key;

	return (
		<div className="flex h-[calc(100vh-6.5rem)] min-h-0 flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				{backLink}
				<div className="min-w-0">
					<div className="truncate font-medium text-sm">{fileName}</div>
					<div className="truncate text-muted-foreground text-xs">
						{search.bucket}/{search.key}
					</div>
				</div>
				<Badge variant="secondary">{lang}</Badge>
				{issues.length > 0 ? (
					<Badge
						title={issues.map((issue) => issue.message).join("\n")}
						variant="destructive"
					>
						{issues.length} syntax error{issues.length > 1 ? "s" : ""}
					</Badge>
				) : null}
				{dirty ? <Badge variant="outline">Unsaved</Badge> : null}

				<div className="ml-auto flex flex-wrap items-center gap-2">
					<ToggleGroup
						onValueChange={(value: string[]) =>
							setMode((value[0] as Mode) ?? "code")
						}
						value={[mode]}
						variant="outline"
					>
						{canEditRich ? (
							<ToggleGroupItem value="rich">Rich text</ToggleGroupItem>
						) : null}
						<ToggleGroupItem value="code">Code</ToggleGroupItem>
						<ToggleGroupItem value="preview">Preview</ToggleGroupItem>
					</ToggleGroup>
					{canFormat(lang) ? (
						<Button
							onClick={applyFormat}
							size="sm"
							type="button"
							variant="outline"
						>
							Format
						</Button>
					) : null}
					<Button
						disabled={!dirty}
						onClick={() => setText(baseline)}
						size="sm"
						type="button"
						variant="outline"
					>
						Reset
					</Button>
					<Button
						disabled={!dirty || saveMutation.isPending}
						onClick={() => {
							// Pre-fill with what the object already has, so the common case
							// is one click and the header never silently changes.
							setSaveCacheControl(
								sourceQuery.data?.cacheControl ||
									provider.defaultCacheControl ||
									suggestCacheControl(search.key),
							);
							setSaveOpen(true);
						}}
						size="sm"
						type="button"
					>
						{saveMutation.isPending ? "Saving…" : "Review & save"}
					</Button>
				</div>
			</div>

			{status ? (
				<Alert variant={status.error ? "destructive" : "default"}>
					<AlertDescription>{status.text}</AlertDescription>
				</Alert>
			) : null}

			<div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
				{sourceQuery.isPending ? (
					<div className="flex flex-col gap-3 p-6">
						<Skeleton className="h-5 w-1/3" />
						<Skeleton className="h-5 w-2/3" />
						<Skeleton className="h-5 w-1/2" />
					</div>
				) : (
					<Suspense
						fallback={
							<div className="p-6 text-muted-foreground text-sm">
								Loading the editor…
							</div>
						}
					>
						{mode === "preview" ? (
							<RichTextViewer
								className="h-full rounded-none border-0"
								lang={lang}
								text={text}
							/>
						) : mode === "rich" ? (
							<RichMarkdownEditor onChange={setText} value={text} />
						) : (
							<div className="h-full overflow-auto">
								<CodeEditor lang={lang} onChange={setText} value={text} />
							</div>
						)}
					</Suspense>
				)}
			</div>

			<Dialog onOpenChange={setSaveOpen} open={saveOpen}>
				{/* max-h + overflow so the preview and the purge command cannot push
				    the footer off-screen. min-w-0 on the children: DialogContent is a
				    grid, and a grid item defaults to min-width:auto, so a wide <pre>
				    stretches the track past the dialog instead of scrolling inside it. */}
				<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle className="truncate pr-10">
							Save {fileName}
						</DialogTitle>
						<DialogDescription>
							This is exactly what will be written to {search.bucket}. Nothing
							has been uploaded yet.
						</DialogDescription>
					</DialogHeader>

					{issues.length > 0 ? (
						<Alert variant="destructive">
							<HugeiconsIcon icon={Alert01Icon} size={16} strokeWidth={1.5} />
							<AlertDescription className="flex flex-col gap-1">
								<span>
									Saving anyway will store a file that does not parse:
								</span>
								{issues.slice(0, 5).map((issue) => (
									<span key={`${issue.from}-${issue.message}`}>
										{issue.message}
									</span>
								))}
								{issues.length > 5 ? (
									<span>…and {issues.length - 5} more.</span>
								) : null}
							</AlertDescription>
						</Alert>
					) : null}

					<div className="flex min-w-0 flex-col gap-2">
						<div className="flex items-center justify-between gap-3">
							<span className={SECTION_LABEL}>Preview</span>
							<span className="text-muted-foreground text-xs">
								{formatBytes(new TextEncoder().encode(text).byteLength)} ·{" "}
								{text.split("\n").length} lines
							</span>
						</div>
						<RichTextViewer className="max-h-64" lang={lang} text={text} />
						<details className="min-w-0">
							<summary className="cursor-pointer text-muted-foreground text-xs">
								Show the raw {lang} that will be written
							</summary>
							<pre className={cn(CODE_BLOCK, "mt-2 max-h-64")}>{text}</pre>
						</details>
					</div>

					<div className="flex min-w-0 flex-col gap-2">
						<div className={SECTION_LABEL}>Cache-Control</div>
						<ToggleGroup
							onValueChange={(value: string[]) =>
								setSaveCacheControl(value[0] ?? "")
							}
							value={saveCacheControl ? [saveCacheControl] : []}
							variant="outline"
						>
							{CACHE_PRESETS.map((preset) => (
								<ToggleGroupItem
									key={preset.value}
									title={preset.hint}
									value={preset.value}
								>
									{preset.label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						<Input
							onChange={(event) => setSaveCacheControl(event.target.value)}
							placeholder="public, max-age=300, must-revalidate"
							value={saveCacheControl}
						/>
						<p className="text-muted-foreground text-xs">
							{describeCacheControl(saveCacheControl)}
						</p>
						<p className="text-muted-foreground text-xs">
							Currently stored on this object:{" "}
							<code>{sourceQuery.data?.cacheControl || "nothing"}</code>
						</p>
					</div>

					{savePurgeCommand ? (
						<div className="flex min-w-0 flex-col gap-2">
							<div className="flex items-center justify-between gap-3">
								<span className={SECTION_LABEL}>
									Purge this file after saving
								</span>
								<Button
									onClick={async () => {
										await navigator.clipboard.writeText(
											savePurgeCommand.command,
										);
										setStatus({ text: "Copied the purge command." });
									}}
									size="xs"
									type="button"
									variant="outline"
								>
									Copy
								</Button>
							</div>
							<pre className={cn(CODE_BLOCK, "max-h-40")}>
								{savePurgeCommand.command}
							</pre>
							<p className="text-muted-foreground text-xs">
								{savePurgeCommand.scope}
							</p>
							{savePurgeCommand.notes.map((note) => (
								<p className="text-destructive text-xs" key={note}>
									{note}
								</p>
							))}
							{canPurge(provider) ? (
								<p className="text-muted-foreground text-xs">
									Saving also runs this purge in-app — the command is here for
									scripting or if the in-app call fails.
								</p>
							) : (
								<p className="text-muted-foreground text-xs">
									Cloudflare's API refuses browser calls, so run this yourself
									after saving. Until it completes, the edge keeps serving the
									old file.
								</p>
							)}
						</div>
					) : null}

					<DialogFooter>
						<Button
							onClick={() => setSaveOpen(false)}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={saveMutation.isPending}
							onClick={() => saveMutation.mutate(saveCacheControl)}
							size="sm"
							type="button"
						>
							{saveMutation.isPending ? "Saving…" : "Save file"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
