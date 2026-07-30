import {
	ArrowRight01Icon,
	Cancel01Icon,
	CloudDownloadIcon,
	CopyLinkIcon,
	Database01Icon,
	Delete02Icon,
	DeleteThrowIcon,
	EyeIcon,
	FileEditIcon,
	Folder02Icon,
	FolderAddIcon,
	FolderOpenIcon,
	GridViewIcon,
	HelpCircleIcon,
	LeftToRightListBulletIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusSignIcon,
	Search01Icon,
	Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type DragEvent,
	Fragment,
	type ReactNode,
	startTransition,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { z } from "zod";
import { extensionLabel, FileGlyph } from "../components/file-glyph";
import { RichTextViewer } from "../components/rich-text-viewer";
import { TerminalBlock } from "../components/terminal-block";
import { Alert, AlertAction, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "../components/ui/breadcrumb";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "../components/ui/input-group";
import { Label } from "../components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../components/ui/popover";
import { Progress } from "../components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { buildPurgeCommand, type PurgeCommand, purgeCache } from "../lib/cdn";
import {
	getActiveProviderId,
	saveProvider,
	setActiveProviderId,
	setRecentBucket,
} from "../lib/providers";
import {
	bucketQueryOptions,
	objectQueryOptions,
	providerQueryOptions,
	recentBucketQueryOptions,
	transferQueryOptions,
} from "../lib/query-options";
import { detectTextLang } from "../lib/richtext";
import {
	buildObjectUrl,
	createFolder,
	deleteKeys,
	downloadObject,
	previewObject,
	renameKey,
	resolveObjectContentType,
	uploadObject,
} from "../lib/s3";
import { saveTransfer } from "../lib/transfers";
import type {
	BrowserView,
	ObjectEntry,
	ObjectPreview,
	TransferRecord,
} from "../lib/types";
import {
	cn,
	extensionForKey,
	formatBytes,
	formatTimestamp,
	isEditableTextContentType,
} from "../lib/utils";

const searchSchema = z.object({
	providerId: z.string().optional(),
	bucket: z.string().optional(),
	prefix: z.string().optional().default(""),
	view: z.enum(["list", "grid"]).default("list"),
});

const emptyCaptionsTrack = "data:text/vtt;charset=utf-8,WEBVTT%0A%0A";

/**
 * Browser-style location tabs. Each tab remembers a place (provider, bucket,
 * prefix, view); the URL stays the source of truth for where you are *now*,
 * tabs only remember the other places. sessionStorage so a round-trip through
 * /edit — which unmounts this route — comes back to the same set.
 */
type BrowseTab = {
	id: string;
	providerId?: string;
	bucket?: string;
	prefix: string;
	view: BrowserView;
};

type TabState = { tabs: BrowseTab[]; activeId: string };

const TABS_KEY = "browse-tabs";

function loadTabState(): TabState | null {
	try {
		const parsed = JSON.parse(
			sessionStorage.getItem(TABS_KEY) ?? "",
		) as TabState;
		return parsed.tabs?.length && parsed.activeId ? parsed : null;
	} catch {
		return null;
	}
}

function tabLabel(tab: BrowseTab) {
	const segment = tab.prefix.replace(/\/$/, "").split("/").pop();
	return segment || tab.bucket || "New tab";
}

/** Section heading above a group of controls. */
const SECTION_LABEL =
	"font-medium text-muted-foreground text-xs uppercase tracking-wider";

/**
 * One row of the list view: check · glyph · name · ext · size · modified ·
 * actions. Below 900px the three middle columns are dropped (see HIDE_SM) and
 * the track list shrinks to match, so the header and the rows stay aligned.
 */
const ENTRY_GRID =
	"grid grid-cols-[24px_32px_minmax(0,1fr)_32px] items-center gap-3 px-3 min-[900px]:grid-cols-[24px_32px_minmax(0,1fr)_56px_96px_132px_32px]";
const HIDE_SM = "hidden min-[900px]:block";

// Name-column widths for the loading rows; varied so the placeholder reads as
// "a folder listing is coming", not a repeated stripe. Doubles as the row key.
const SKELETON_ROWS = ["w-1/2", "w-2/3", "w-2/5", "w-3/5", "w-1/3", "w-3/4"];

export const Route = createFileRoute("/browse")({
	component: BrowsePage,
	validateSearch: searchSchema,
});

function updateTransferCache(
	queryClient: ReturnType<typeof useQueryClient>,
	transfer: TransferRecord,
) {
	queryClient.setQueryData<TransferRecord[]>(["transfers"], (current = []) => {
		const next = current.filter((entry) => entry.id !== transfer.id);
		return [transfer, ...next].sort(
			(left, right) => right.updatedAt - left.updatedAt,
		);
	});
}

function previewRenderer(
	preview: ObjectPreview | null,
	textPreview: string | null,
) {
	if (!preview) {
		return null;
	}
	if (preview.contentType.startsWith("image/")) {
		return (
			<img
				alt={preview.fileName}
				className="max-h-[70vh] rounded-lg object-contain"
				src={preview.blobUrl}
			/>
		);
	}
	if (preview.contentType.startsWith("video/")) {
		return (
			<video className="max-h-[70vh] rounded-lg" controls src={preview.blobUrl}>
				<track
					default
					kind="captions"
					label="Captions unavailable"
					src={emptyCaptionsTrack}
					srcLang="en"
				/>
			</video>
		);
	}
	if (isEditableTextContentType(preview.contentType)) {
		// Rendered view, not raw bytes: Markdown and HTML display as documents
		// (same component as the editor's Preview tab); the editor is one click
		// away in the drawer footer for anyone who wants the source.
		const lang = detectTextLang(preview.fileName, preview.contentType);
		return (
			<RichTextViewer
				className={cn("w-full", lang === "html" ? "h-[65vh]" : "max-h-[65vh]")}
				lang={lang}
				text={textPreview ?? ""}
			/>
		);
	}
	return (
		<iframe
			className="h-[70vh] w-full rounded-md border bg-background"
			src={preview.blobUrl}
			title={preview.fileName}
		/>
	);
}

/**
 * A field label with its instructions parked behind a "?". The purge dialog used
 * to print every "go to the Cloudflare dashboard and…" paragraph inline, which
 * made it taller than the viewport and buried the two inputs that matter.
 */
function LabelWithHelp({
	children,
	help,
	htmlFor,
}: {
	children: ReactNode;
	help: ReactNode;
	htmlFor: string;
}) {
	return (
		<div className="flex items-center gap-1">
			<Label htmlFor={htmlFor}>{children}</Label>
			<Popover>
				<PopoverTrigger
					render={
						<Button
							aria-label="Where do I find this?"
							size="icon-xs"
							type="button"
							variant="ghost"
						/>
					}
				>
					<HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.5} />
				</PopoverTrigger>
				<PopoverContent
					align="start"
					className="text-muted-foreground text-xs leading-relaxed"
				>
					{help}
				</PopoverContent>
			</Popover>
		</div>
	);
}

function keyForReplacement(targetKey: string, incomingFileName: string) {
	const segments = targetKey.split("/");
	const currentName = segments.pop() ?? targetKey;
	const currentExtension = extensionForKey(currentName);
	const incomingExtension = extensionForKey(incomingFileName);
	const baseName = currentExtension
		? currentName.slice(0, -(currentExtension.length + 1))
		: currentName;

	const nextName = incomingExtension
		? `${baseName}.${incomingExtension}`
		: currentName;

	return segments.length ? `${segments.join("/")}/${nextName}` : nextName;
}

function BrowsePage() {
	const queryClient = useQueryClient();
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const providersQuery = useQuery(providerQueryOptions);
	const activeProviderIdQuery = useQuery({
		queryKey: ["providers", "active"],
		queryFn: getActiveProviderId,
	});
	const transfersQuery = useQuery(transferQueryOptions);
	const providers = providersQuery.data ?? [];
	const provider =
		providers.find((entry) => entry.id === search.providerId) ??
		providers.find((entry) => entry.id === activeProviderIdQuery.data) ??
		providers[0];
	const recentBucketQuery = useQuery(recentBucketQueryOptions(provider?.id));
	const bucketsQuery = useQuery(bucketQueryOptions(provider));
	const bucket =
		search.bucket ??
		provider?.defaultBucket ??
		recentBucketQuery.data ??
		bucketsQuery.data?.[0] ??
		provider?.buckets?.[0];
	const [searchInput, setSearchInput] = useState("");
	const [bucketInput, setBucketInput] = useState("");
	const [tabState, setTabState] = useState<TabState>(() => {
		const stored = loadTabState();
		if (stored) {
			return stored;
		}
		const id = crypto.randomUUID();
		return {
			tabs: [
				{
					id,
					providerId: search.providerId,
					bucket: search.bucket,
					prefix: search.prefix,
					view: search.view,
				},
			],
			activeId: id,
		};
	});
	const deferredSearch = useDeferredValue(searchInput);
	const objectListQuery = useQuery(
		objectQueryOptions({
			provider,
			bucket,
			prefix: search.prefix,
			search: deferredSearch,
		}),
	);
	const objects = objectListQuery.data ?? [];
	const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
	const [preview, setPreview] = useState<ObjectPreview | null>(null);
	const [previewKey, setPreviewKey] = useState<string | null>(null);
	const [textPreview, setTextPreview] = useState<string | null>(null);
	const [purgeOpen, setPurgeOpen] = useState(false);
	// The "you left a field blank" notes are only useful once the operator acts
	// on the command — showing them on open reads as an error on a fresh form.
	const [purgeNotesShown, setPurgeNotesShown] = useState(false);
	const [cfDistId, setCfDistId] = useState("");
	const [cfZoneId, setCfZoneId] = useState("");
	const [cfToken, setCfToken] = useState("");
	const [cdnBaseUrl, setCdnBaseUrl] = useState("");
	// This used to be `_statusMessage` — set in a dozen places and rendered
	// nowhere, so every failure (including failed saves) was silent.
	const [status, setStatus] = useState<{ text: string; error?: boolean }>({
		text: "Select a provider and bucket to start browsing objects.",
	});
	const setStatusMessage = useCallback(
		(text: string) => setStatus({ text }),
		[],
	);
	const setErrorMessage = useCallback(
		(text: string) => setStatus({ text, error: true }),
		[],
	);
	// Runs on every dismissal path (close button, Escape, backdrop) because the
	// Dialog routes all three through onOpenChange.
	const closePreview = useCallback(() => {
		// The blob URL is revoked by the effect that watches `preview`.
		setPreview(null);
		setPreviewKey(null);
		setTextPreview(null);
	}, []);
	// Editing lives on its own page now (routes/edit.tsx); this is the link to it.
	const openEditor = useCallback(
		(key: string) => {
			closePreview();
			void navigate({
				search: {
					bucket,
					key,
					prefix: search.prefix,
					providerId: provider?.id,
				},
				to: "/edit",
			});
		},
		[bucket, closePreview, navigate, provider?.id, search.prefix],
	);
	const [isDragActive, setIsDragActive] = useState(false);
	const [replaceTarget, setReplaceTarget] = useState<ObjectEntry | null>(null);
	const [renameTarget, setRenameTarget] = useState<ObjectEntry | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [folderDialogOpen, setFolderDialogOpen] = useState(false);
	const [folderName, setFolderName] = useState("");
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const parentRef = useRef<HTMLDivElement | null>(null);
	const replaceInputRef = useRef<HTMLInputElement | null>(null);
	const dragDepthRef = useRef(0);
	const rowVirtualizer = useVirtualizer({
		count: objects.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 56,
		overscan: 8,
	});

	useEffect(() => {
		if (provider && search.providerId !== provider.id) {
			void navigate({
				search: (current) => ({
					...current,
					providerId: provider.id,
				}),
				replace: true,
			});
		}
	}, [navigate, provider, search.providerId]);

	useEffect(() => {
		if (provider && bucket && search.bucket !== bucket) {
			void navigate({
				search: (current) => ({
					...current,
					providerId: provider.id,
					bucket,
				}),
				replace: true,
			});
			void setRecentBucket(provider.id, bucket);
		}
	}, [bucket, navigate, provider, search.bucket]);

	useEffect(() => {
		setSelectedKeys((current) =>
			current.filter((key) => objects.some((entry) => entry.key === key)),
		);
	}, [objects]);

	// Mirror the resolved location into the active tab; persistence is one
	// effect below so every tab action saves without repeating itself.
	useEffect(() => {
		setTabState((state) => ({
			...state,
			tabs: state.tabs.map((tab) =>
				tab.id === state.activeId
					? {
							...tab,
							providerId: provider?.id ?? search.providerId,
							bucket,
							prefix: search.prefix,
							view: search.view,
						}
					: tab,
			),
		}));
	}, [provider?.id, bucket, search.providerId, search.prefix, search.view]);

	useEffect(() => {
		sessionStorage.setItem(TABS_KEY, JSON.stringify(tabState));
	}, [tabState]);

	const goToTab = (tab: BrowseTab) => {
		setTabState((state) => ({ ...state, activeId: tab.id }));
		void navigate({
			search: {
				providerId: tab.providerId,
				bucket: tab.bucket,
				prefix: tab.prefix,
				view: tab.view,
			},
		});
	};

	const openTab = (overrides: Partial<BrowseTab> = {}) => {
		const next: BrowseTab = {
			id: crypto.randomUUID(),
			providerId: provider?.id,
			bucket,
			prefix: search.prefix,
			view: search.view,
			...overrides,
		};
		setTabState((state) => ({
			tabs: [...state.tabs, next],
			activeId: next.id,
		}));
		void navigate({
			search: {
				providerId: next.providerId,
				bucket: next.bucket,
				prefix: next.prefix,
				view: next.view,
			},
		});
	};

	const closeTab = (id: string) => {
		const { tabs, activeId } = tabState;
		if (tabs.length === 1) {
			return;
		}
		const index = tabs.findIndex((tab) => tab.id === id);
		const remaining = tabs.filter((tab) => tab.id !== id);
		let nextActiveId = activeId;
		if (id === activeId) {
			const fallback = remaining[Math.max(0, index - 1)];
			nextActiveId = fallback.id;
			void navigate({
				search: {
					providerId: fallback.providerId,
					bucket: fallback.bucket,
					prefix: fallback.prefix,
					view: fallback.view,
				},
			});
		}
		setTabState({ tabs: remaining, activeId: nextActiveId });
	};

	useEffect(() => {
		return () => {
			if (preview) {
				URL.revokeObjectURL(preview.blobUrl);
			}
		};
	}, [preview]);

	// A failed listing rendered as "no files" is indistinguishable from an empty
	// bucket, so every fetch error here was invisible. Show it.
	useEffect(() => {
		const error = objectListQuery.error ?? bucketsQuery.error;
		if (error) {
			setErrorMessage(error.message);
		}
	}, [objectListQuery.error, bucketsQuery.error, setErrorMessage]);

	// Successes fade; errors stay until dismissed.
	useEffect(() => {
		if (status.error || !status.text) {
			return;
		}
		const timer = setTimeout(() => setStatus({ text: "" }), 5000);
		return () => clearTimeout(timer);
	}, [status]);

	// Built from the live form fields, not the saved provider, so the command
	// updates as the operator types and is correct before they hit Save.
	const purgeCommands = useMemo(() => {
		if (!provider) {
			return [];
		}
		const draft = {
			...provider,
			cloudFrontDistributionId: cfDistId.trim() || undefined,
			cloudflareZoneId: cfZoneId.trim() || undefined,
			cloudflareApiToken: cfToken.trim() || undefined,
			publicBaseUrl: cdnBaseUrl.trim() || undefined,
		};
		const entries: { label: string; value: PurgeCommand }[] = [];
		if (previewKey) {
			const single = buildPurgeCommand(draft, [previewKey], bucket);
			if (single) {
				entries.push({
					label: `Purge this file — ${previewKey}`,
					value: single,
				});
			}
		}
		const all = buildPurgeCommand(draft);
		if (all) {
			entries.push({
				label: previewKey ? "Purge everything" : "Purge everything in this CDN",
				value: all,
			});
		}
		return entries;
	}, [provider, bucket, cfDistId, cfZoneId, cfToken, cdnBaseUrl, previewKey]);

	const syncTransfer = async (transfer: TransferRecord) => {
		updateTransferCache(queryClient, transfer);
		await saveTransfer(transfer);
	};

	const downloadMutation = useMutation({
		mutationFn: async (item: ObjectEntry) => {
			if (!(provider && bucket)) {
				throw new Error("Choose a provider and bucket first.");
			}
			const transferId = crypto.randomUUID();
			const createdAt = Date.now();
			let lastWrite = 0;
			await syncTransfer({
				id: transferId,
				kind: "download",
				status: "running",
				providerId: provider.id,
				bucket,
				key: item.key,
				fileName: item.name,
				transferredBytes: 0,
				totalBytes: item.size,
				createdAt,
				updatedAt: createdAt,
			});
			try {
				const file = await downloadObject(
					provider,
					bucket,
					item.key,
					async (loaded, total) => {
						const now = performance.now();
						if (now - lastWrite < 160 && loaded !== total) {
							return;
						}
						lastWrite = now;
						await syncTransfer({
							id: transferId,
							kind: "download",
							status: "running",
							providerId: provider.id,
							bucket,
							key: item.key,
							fileName: item.name,
							transferredBytes: loaded,
							totalBytes: total,
							resumeSupported: false,
							createdAt,
							updatedAt: Date.now(),
						});
					},
				);
				const blobUrl = URL.createObjectURL(file.blob);
				const anchor = document.createElement("a");
				anchor.href = blobUrl;
				anchor.download = item.name;
				anchor.click();
				URL.revokeObjectURL(blobUrl);
				await syncTransfer({
					id: transferId,
					kind: "download",
					status: "completed",
					providerId: provider.id,
					bucket,
					key: item.key,
					fileName: item.name,
					transferredBytes: file.totalBytes ?? item.size,
					totalBytes: file.totalBytes ?? item.size,
					resumeSupported: file.resumeSupported,
					createdAt,
					updatedAt: Date.now(),
				});
				setStatusMessage(`Downloaded ${item.name}.`);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Download failed.";
				await syncTransfer({
					id: transferId,
					kind: "download",
					status: "failed",
					providerId: provider.id,
					bucket,
					key: item.key,
					fileName: item.name,
					transferredBytes: 0,
					totalBytes: item.size,
					errorMessage: message,
					createdAt,
					updatedAt: Date.now(),
				});
				throw error;
			}
		},
		onError: (error) => {
			setErrorMessage(
				error instanceof Error ? error.message : "Download failed.",
			);
		},
	});

	const previewMutation = useMutation({
		// The drawer opens on click and shows its skeleton while the object loads;
		// waiting for the fetch made a slow preview look like a dead button.
		onMutate: (item: ObjectEntry) => setPreviewKey(item.key),
		mutationFn: async (item: ObjectEntry) => {
			if (!(provider && bucket)) {
				throw new Error("Choose a provider and bucket first.");
			}
			const nextPreview = await previewObject(provider, bucket, item.key);
			// Read-only here: this dialog is the quick look. Changing bytes is the
			// /edit page's job.
			const nextText = isEditableTextContentType(nextPreview.contentType)
				? await fetch(nextPreview.blobUrl).then((response) => response.text())
				: null;
			return { nextPreview, nextText };
		},
		onSuccess: ({ nextPreview, nextText }, item) => {
			if (preview) {
				URL.revokeObjectURL(preview.blobUrl);
			}
			setPreview(nextPreview);
			setPreviewKey(item.key);
			setTextPreview(nextText);
		},
		onError: (error) => {
			// Leave nothing behind the error banner: an empty drawer over a failure
			// message reads as a second bug.
			closePreview();
			setErrorMessage(
				error instanceof Error ? error.message : "Preview failed.",
			);
		},
	});

	// Saving the settings and purging are separate acts now: R2 cannot purge from
	// the browser at all, so "save" has to stand on its own for the command
	// builder to have anything to work with.
	const purgeMutation = useMutation({
		mutationFn: async (options?: { purge?: boolean }) => {
			if (!provider) {
				throw new Error("Choose a provider first.");
			}
			const updated = {
				...provider,
				cloudFrontDistributionId: cfDistId.trim() || undefined,
				cloudflareZoneId: cfZoneId.trim() || undefined,
				cloudflareApiToken: cfToken.trim() || undefined,
				publicBaseUrl: cdnBaseUrl.trim() || undefined,
			};
			await saveProvider({ ...updated, createdAt: provider.createdAt });
			if (!options?.purge) {
				return "Purge settings saved.";
			}
			return purgeCache(updated, previewKey ? [previewKey] : undefined);
		},
		onSuccess: async (message, options) => {
			setStatusMessage(message);
			if (options?.purge) {
				setPurgeOpen(false);
			}
			await queryClient.invalidateQueries({ queryKey: ["providers"] });
		},
		onError: (error) => {
			setErrorMessage(
				error instanceof Error ? error.message : "Cache purge failed.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (keys: string[]) => {
			if (!(provider && bucket)) {
				throw new Error("Choose a provider and bucket first.");
			}
			await deleteKeys(provider, bucket, keys);
		},
		onSuccess: async (_, keys) => {
			setSelectedKeys((current) =>
				current.filter((key) => !keys.includes(key)),
			);
			setStatusMessage(
				`Deleted ${keys.length} item${keys.length > 1 ? "s" : ""}.`,
			);
			await queryClient.invalidateQueries({
				queryKey: ["objects", provider?.id, bucket],
			});
		},
		onError: (error) => {
			setErrorMessage(
				error instanceof Error ? error.message : "Delete failed.",
			);
		},
	});

	const renameMutation = useMutation({
		mutationFn: async ({
			fromKey,
			toKey,
		}: {
			fromKey: string;
			toKey: string;
		}) => {
			if (!(provider && bucket)) {
				throw new Error("Choose a provider and bucket first.");
			}
			await renameKey(provider, bucket, fromKey, toKey);
		},
		onSuccess: async (_, values) => {
			setStatusMessage(
				`Renamed ${values.fromKey.split("/").pop()} to ${values.toKey.split("/").pop()}.`,
			);
			await queryClient.invalidateQueries({
				queryKey: ["objects", provider?.id, bucket],
			});
		},
		onError: (error) => {
			setErrorMessage(
				error instanceof Error ? error.message : "Rename failed.",
			);
		},
	});

	const uploadMutation = useMutation({
		mutationFn: async (files: File[]) => {
			if (!(provider && bucket)) {
				throw new Error("Choose a provider and bucket first.");
			}
			for (const file of files) {
				const transferId = crypto.randomUUID();
				const createdAt = Date.now();
				const key = `${search.prefix}${file.name}`;
				let lastWrite = 0;
				await syncTransfer({
					id: transferId,
					kind: "upload",
					status: "running",
					providerId: provider.id,
					bucket,
					key,
					fileName: file.name,
					transferredBytes: 0,
					totalBytes: file.size,
					createdAt,
					updatedAt: createdAt,
				});
				try {
					await uploadObject(
						provider,
						bucket,
						key,
						file,
						undefined,
						async (loaded, total) => {
							const now = performance.now();
							if (now - lastWrite < 160 && loaded !== total) {
								return;
							}
							lastWrite = now;
							await syncTransfer({
								id: transferId,
								kind: "upload",
								status: "running",
								providerId: provider.id,
								bucket,
								key,
								fileName: file.name,
								transferredBytes: loaded,
								totalBytes: total,
								createdAt,
								updatedAt: Date.now(),
							});
						},
						provider.defaultCacheControl,
					);
					await syncTransfer({
						id: transferId,
						kind: "upload",
						status: "completed",
						providerId: provider.id,
						bucket,
						key,
						fileName: file.name,
						transferredBytes: file.size,
						totalBytes: file.size,
						createdAt,
						updatedAt: Date.now(),
					});
				} catch (error) {
					await syncTransfer({
						id: transferId,
						kind: "upload",
						status: "failed",
						providerId: provider.id,
						bucket,
						key,
						fileName: file.name,
						transferredBytes: 0,
						totalBytes: file.size,
						errorMessage:
							error instanceof Error ? error.message : "Upload failed.",
						createdAt,
						updatedAt: Date.now(),
					});
					throw error;
				}
			}
		},
		onSuccess: async (_, files) => {
			setStatusMessage(
				`Uploaded ${files.length} file${files.length > 1 ? "s" : ""}.`,
			);
			await queryClient.invalidateQueries({
				queryKey: ["objects", provider?.id, bucket],
			});
			await queryClient.invalidateQueries({ queryKey: ["transfers"] });
		},
		onError: (error) => {
			setErrorMessage(
				error instanceof Error ? error.message : "Upload failed.",
			);
		},
	});

	const replaceMutation = useMutation({
		mutationFn: async ({ item, file }: { item: ObjectEntry; file: File }) => {
			if (!(provider && bucket)) {
				throw new Error("Choose a provider and bucket first.");
			}
			const nextKey = keyForReplacement(item.key, file.name);
			const nextName = nextKey.split("/").pop() ?? nextKey;
			const transferId = crypto.randomUUID();
			const createdAt = Date.now();
			let lastWrite = 0;
			await syncTransfer({
				id: transferId,
				kind: "upload",
				status: "running",
				providerId: provider.id,
				bucket,
				key: nextKey,
				fileName: nextName,
				transferredBytes: 0,
				totalBytes: file.size,
				createdAt,
				updatedAt: createdAt,
			});
			try {
				await uploadObject(
					provider,
					bucket,
					nextKey,
					file,
					resolveObjectContentType(nextKey, file.type || undefined),
					async (loaded, total) => {
						const now = performance.now();
						if (now - lastWrite < 160 && loaded !== total) {
							return;
						}
						lastWrite = now;
						await syncTransfer({
							id: transferId,
							kind: "upload",
							status: "running",
							providerId: provider.id,
							bucket,
							key: nextKey,
							fileName: nextName,
							transferredBytes: loaded,
							totalBytes: total,
							createdAt,
							updatedAt: Date.now(),
						});
					},
					// A replace is a new object under an old name, so it gets the
					// provider's default rather than inheriting the old header.
					provider.defaultCacheControl,
				);
				if (nextKey !== item.key) {
					await deleteKeys(provider, bucket, [item.key]);
				}
				await syncTransfer({
					id: transferId,
					kind: "upload",
					status: "completed",
					providerId: provider.id,
					bucket,
					key: nextKey,
					fileName: nextName,
					transferredBytes: file.size,
					totalBytes: file.size,
					createdAt,
					updatedAt: Date.now(),
				});
				return { nextKey, nextName };
			} catch (error) {
				await syncTransfer({
					id: transferId,
					kind: "upload",
					status: "failed",
					providerId: provider.id,
					bucket,
					key: nextKey,
					fileName: nextName,
					transferredBytes: 0,
					totalBytes: file.size,
					errorMessage:
						error instanceof Error ? error.message : "Replace failed.",
					createdAt,
					updatedAt: Date.now(),
				});
				throw error;
			}
		},
		onSuccess: async (result, values) => {
			setStatusMessage(
				result.nextKey === values.item.key
					? `Replaced ${values.item.name}.`
					: `Replaced ${values.item.name} and renamed it to ${result.nextName}.`,
			);
			await queryClient.invalidateQueries({
				queryKey: ["objects", provider?.id, bucket],
			});
			await queryClient.invalidateQueries({ queryKey: ["transfers"] });
		},
		onError: (error) => {
			setErrorMessage(
				error instanceof Error ? error.message : "Replace failed.",
			);
		},
	});

	const pathSegments = useMemo(() => {
		const trimmed = search.prefix.replace(/\/$/, "");
		if (!trimmed) {
			return [];
		}
		return trimmed.split("/");
	}, [search.prefix]);
	const visibleBytes = useMemo(
		() =>
			objects.reduce(
				(total, item) => total + (item.kind === "file" ? item.size : 0),
				0,
			),
		[objects],
	);

	const folderCount = useMemo(
		() => objects.filter((item) => item.kind === "folder").length,
		[objects],
	);
	const fileCount = objects.length - folderCount;
	const previewEntry = previewKey
		? objects.find((entry) => entry.key === previewKey)
		: undefined;

	/*
	 * Denominator for the weight rule under each row. Relative to the largest
	 * item *in view*, not the bucket — the question being answered is "what is
	 * heavy in this folder", and a bucket-wide scale would flatten every rule to
	 * nothing the moment one huge object existed somewhere else.
	 */
	const maxVisibleSize = useMemo(
		() =>
			objects.reduce(
				(largest, item) =>
					item.kind === "file" ? Math.max(largest, item.size) : largest,
				0,
			),
		[objects],
	);

	const copyObjectUrl = useCallback(
		async (item: ObjectEntry) => {
			if (!(provider && bucket)) {
				return;
			}
			const url = buildObjectUrl(provider, bucket, item.key);
			if (!url) {
				setErrorMessage("Direct URL unavailable for this provider.");
				return;
			}
			try {
				await navigator.clipboard.writeText(url);
				setStatusMessage(`Copied URL for ${item.name}.`);
			} catch {
				// A denied clipboard permission must not read as a successful copy.
				setErrorMessage(`Clipboard blocked by the browser. URL: ${url}`);
			}
		},
		[bucket, provider, setErrorMessage, setStatusMessage],
	);

	const openBucket = useCallback(
		(nextBucket: string) => {
			void navigate({
				search: (current) => ({ ...current, bucket: nextBucket, prefix: "" }),
			});
			setStatusMessage(`Opened bucket ${nextBucket}.`);
		},
		[navigate, setStatusMessage],
	);

	const bucketOptions = useMemo(
		() =>
			Array.from(
				new Set([
					...(bucketsQuery.data ?? []),
					...(provider?.buckets ?? []),
					...(bucket ? [bucket] : []),
				]),
			).filter(Boolean),
		[bucket, bucketsQuery.data, provider?.buckets],
	);
	const transferToasts = useMemo(
		() =>
			(transfersQuery.data ?? [])
				.filter(
					(transfer) =>
						transfer.status === "running" || transfer.status === "failed",
				)
				.slice(0, 4),
		[transfersQuery.data],
	);

	const isFileDrag = (dataTransfer?: DataTransfer | null) =>
		Boolean(dataTransfer?.types.includes("Files"));

	const openReplacePicker = (item: ObjectEntry) => {
		setReplaceTarget(item);
		replaceInputRef.current?.click();
	};

	const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
		if (!isFileDrag(event.dataTransfer)) {
			return;
		}
		event.preventDefault();
		dragDepthRef.current += 1;
		setIsDragActive(true);
	};

	const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
		if (!isFileDrag(event.dataTransfer)) {
			return;
		}
		event.preventDefault();
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) {
			setIsDragActive(false);
		}
	};

	const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
		if (!isFileDrag(event.dataTransfer)) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		setIsDragActive(true);
	};

	const handleDrop = (event: DragEvent<HTMLDivElement>) => {
		if (!isFileDrag(event.dataTransfer)) {
			return;
		}
		event.preventDefault();
		dragDepthRef.current = 0;
		setIsDragActive(false);
		const files = Array.from(event.dataTransfer.files ?? []);
		if (!files.length) {
			return;
		}
		uploadMutation.mutate(files);
		setStatusMessage(
			`Uploading ${files.length} dropped file${files.length > 1 ? "s" : ""}.`,
		);
	};

	if (!providers.length) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center gap-3 py-16 text-center">
					<FileGlyph item={{ kind: "folder", key: "" }} open size="lg" />
					<h2 className="font-semibold text-base">No provider configured</h2>
					<p className="max-w-md text-muted-foreground text-sm">
						Add a provider profile to start browsing. Credentials stay in this
						browser and requests go straight to the S3 API.
					</p>
					<Button render={<Link to="/providers" />}>Open providers</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<input
				className="sr-only"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file && replaceTarget) {
						const nextKey = keyForReplacement(replaceTarget.key, file.name);
						const nextName = nextKey.split("/").pop() ?? nextKey;
						const localExtension = extensionForKey(file.name);
						const nextExtension = extensionForKey(nextKey);
						if (nextKey !== replaceTarget.key) {
							setStatusMessage(
								`Replacing ${replaceTarget.name} with ${file.name}. Result will be saved as ${nextName}.`,
							);
						} else if (localExtension && nextExtension) {
							setStatusMessage(`Replacing ${replaceTarget.name}.`);
						}
						replaceMutation.mutate({ item: replaceTarget, file });
					}
					event.target.value = "";
					setReplaceTarget(null);
				}}
				ref={replaceInputRef}
				type="file"
			/>
			<div className="flex items-center gap-1 overflow-x-auto">
				{tabState.tabs.map((tab) => {
					const isActive = tab.id === tabState.activeId;
					return (
						<div
							className={cn(
								"group/tab flex h-8 max-w-52 shrink-0 items-center rounded-lg border border-transparent transition-all duration-200",
								isActive
									? "border-border/60 bg-card font-medium shadow-xs"
									: "text-muted-foreground hover:bg-card/70 hover:text-foreground",
							)}
							key={tab.id}
						>
							<button
								className="flex min-w-0 items-center gap-1.5 py-1.5 pr-1 pl-2.5 text-sm"
								onClick={() => goToTab(tab)}
								title={`${tab.bucket ?? ""}/${tab.prefix}`}
								type="button"
							>
								<HugeiconsIcon
									className="shrink-0 text-muted-foreground"
									icon={tab.prefix ? Folder02Icon : Database01Icon}
									size={13}
									strokeWidth={1.5}
								/>
								<span className="truncate">{tabLabel(tab)}</span>
							</button>
							{tabState.tabs.length > 1 ? (
								<Button
									aria-label={`Close tab ${tabLabel(tab)}`}
									className="mr-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/tab:opacity-100"
									onClick={() => closeTab(tab.id)}
									size="icon-xs"
									type="button"
									variant="ghost"
								>
									<HugeiconsIcon
										icon={Cancel01Icon}
										size={12}
										strokeWidth={1.5}
									/>
								</Button>
							) : (
								<span className="w-1.5" />
							)}
						</div>
					);
				})}
				<Button
					aria-label="New tab"
					onClick={() => openTab()}
					size="icon-sm"
					title="New tab"
					type="button"
					variant="ghost"
				>
					<HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={1.5} />
				</Button>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							{/* BreadcrumbLink is an <a> by default, and both call sites
							    render a <button> instead — so it needs the display and
							    alignment an inline <a> came with for free, matching
							    BreadcrumbPage below. */}
							{pathSegments.length ? (
								<BreadcrumbLink
									className="inline-flex items-center gap-1.5"
									render={
										<button
											onClick={() =>
												void navigate({
													search: (current) => ({ ...current, prefix: "" }),
												})
											}
											type="button"
										/>
									}
								>
									<HugeiconsIcon
										icon={Database01Icon}
										size={14}
										strokeWidth={1.5}
									/>
									{bucket ?? "root"}
								</BreadcrumbLink>
							) : (
								<BreadcrumbPage className="flex items-center gap-1.5">
									<HugeiconsIcon
										icon={Database01Icon}
										size={14}
										strokeWidth={1.5}
									/>
									{bucket ?? "root"}
								</BreadcrumbPage>
							)}
						</BreadcrumbItem>
						{pathSegments.map((segment, index) => {
							const nextPrefix = `${pathSegments.slice(0, index + 1).join("/")}/`;
							const isLast = index === pathSegments.length - 1;
							return (
								<Fragment key={nextPrefix}>
									<BreadcrumbSeparator>
										<HugeiconsIcon
											icon={ArrowRight01Icon}
											size={13}
											strokeWidth={1.5}
										/>
									</BreadcrumbSeparator>
									<BreadcrumbItem>
										{isLast ? (
											<BreadcrumbPage>{segment}</BreadcrumbPage>
										) : (
											<BreadcrumbLink
												className="inline-flex items-center gap-1.5"
												render={
													<button
														onClick={() =>
															void navigate({
																search: (current) => ({
																	...current,
																	prefix: nextPrefix,
																}),
															})
														}
														type="button"
													/>
												}
											>
												{segment}
											</BreadcrumbLink>
										)}
									</BreadcrumbItem>
								</Fragment>
							);
						})}
					</BreadcrumbList>
				</Breadcrumb>

				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="outline">
						{folderCount ? `${folderCount} ▸ ` : ""}
						{fileCount} {fileCount === 1 ? "file" : "files"}
						{visibleBytes > 0 ? ` · ${formatBytes(visibleBytes)}` : ""}
					</Badge>
					<input
						className="sr-only"
						id="upload-input"
						multiple
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							if (files.length) {
								uploadMutation.mutate(files);
							}
							event.target.value = "";
						}}
						type="file"
					/>
					{/* A styled <label>, not a Button — the label is what opens the
					    file picker for the visually-hidden input above. */}
					<label
						className={cn(buttonVariants(), "cursor-pointer")}
						htmlFor="upload-input"
					>
						<HugeiconsIcon icon={Upload01Icon} size={15} strokeWidth={1.5} />
						Upload
					</label>
					<Button
						onClick={() => {
							setFolderName("");
							setFolderDialogOpen(true);
						}}
						type="button"
						variant="outline"
					>
						<HugeiconsIcon icon={FolderAddIcon} size={15} strokeWidth={1.5} />
						New folder
					</Button>
					{selectedKeys.length > 0 && (
						<Button
							onClick={() => setDeleteConfirmOpen(true)}
							type="button"
							variant="destructive"
						>
							<HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={1.5} />
							Delete {selectedKeys.length}
						</Button>
					)}
				</div>
			</div>
			{/* The location toolbar is its own raised layer: provider, bucket and
			    filter live together on one card above the canvas. */}
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-2 shadow-xs">
				<div className="flex flex-wrap items-center gap-2">
					<Select
						onValueChange={(nextProviderId) => {
							if (!nextProviderId) {
								return;
							}
							startTransition(() => {
								void navigate({
									search: () => ({
										providerId: nextProviderId,
										bucket: "",
										prefix: "",
										view: search.view,
									}),
								});
							});
							void setActiveProviderId(nextProviderId);
							void queryClient.invalidateQueries({
								queryKey: ["providers", "active"],
							});
						}}
						value={provider?.id}
					>
						<SelectTrigger className="w-[168px]" size="sm">
							<SelectValue placeholder="Select provider">
								{provider?.name ?? "Select provider"}
							</SelectValue>
						</SelectTrigger>
						<SelectContent align="start">
							{providers.map((entry) => (
								<SelectItem key={entry.id} value={entry.id}>
									{entry.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					{/*
					 * ListBuckets is blocked in the browser for most R2/scoped-token setups,
					 * so a picker is sometimes the only control over a list that can never
					 * populate. Fall back to typing the name.
					 */}
					{bucketOptions.length ? (
						<Select
							onValueChange={(nextBucket) => {
								if (!nextBucket) {
									return;
								}
								openBucket(nextBucket);
							}}
							value={bucket}
						>
							<SelectTrigger className="w-[168px]" size="sm">
								<SelectValue placeholder="Select bucket" />
							</SelectTrigger>
							<SelectContent align="start">
								{bucketOptions.map((entry) => (
									<SelectItem key={entry} value={entry}>
										{entry}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const next = bucketInput.trim();
								if (next) {
									openBucket(next);
								}
							}}
						>
							<Input
								aria-label="Bucket name"
								className="w-[168px]"
								onChange={(event) => setBucketInput(event.target.value)}
								placeholder="Bucket name…"
								value={bucketInput}
							/>
						</form>
					)}

					<InputGroup className="w-[220px]">
						<InputGroupAddon>
							<HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.5} />
						</InputGroupAddon>
						<InputGroupInput
							aria-label="Filter this folder"
							onChange={(event) => setSearchInput(event.target.value)}
							placeholder="Filter this folder"
							value={searchInput}
						/>
					</InputGroup>
				</div>
				<ToggleGroup
					onValueChange={(value: string[]) => {
						const next = value[0];
						if (!next) {
							return;
						}
						void navigate({
							search: (current) => ({
								...current,
								view: next as BrowserView,
							}),
						});
					}}
					spacing={0}
					value={[search.view]}
					variant="outline"
				>
					{(
						[
							["list", LeftToRightListBulletIcon, "List"],
							["grid", GridViewIcon, "Grid"],
						] as const
					).map(([view, icon, label]) => (
						<ToggleGroupItem key={view} title={`${label} view`} value={view}>
							<HugeiconsIcon icon={icon} size={15} strokeWidth={1.5} />
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			{bucketsQuery.data?.length ? null : (
				<p className="text-muted-foreground text-xs">
					No buckets are available to show. If this is R2, account-level listing
					may be blocked by browser CORS.
				</p>
			)}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: this section is a drag-and-drop target for file uploads, not a click target */}
			<section
				className="relative min-w-0"
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				{isDragActive ? (
					<div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-lg border border-primary border-dashed bg-primary/5 font-medium text-sm">
						Drop to upload into {search.prefix || "/"}
					</div>
				) : null}

				{objectListQuery.isLoading ? (
					<div className="overflow-hidden rounded-xl border bg-card shadow-xs">
						{SKELETON_ROWS.map((width) => (
							<div
								className={cn(ENTRY_GRID, "h-14 border-b last:border-b-0")}
								key={width}
							>
								<span />
								<Skeleton className="size-7 rounded-md" />
								<Skeleton className={cn("h-4", width)} />
								<Skeleton className={cn("h-3 w-8", HIDE_SM)} />
								<Skeleton className={cn("h-3 w-14", HIDE_SM)} />
								<Skeleton className={cn("h-3 w-24", HIDE_SM)} />
								<span />
							</div>
						))}
					</div>
				) : objects.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-3 py-16 text-center">
							<FileGlyph item={{ kind: "folder", key: "" }} open size="lg" />
							<div className="font-semibold text-base">
								{searchInput
									? "Nothing matches that filter"
									: "This folder is empty"}
							</div>
							<p className="max-w-sm text-muted-foreground text-sm">
								{searchInput
									? "Clear the filter to see everything in this prefix."
									: "Drop files here to upload them into this prefix."}
							</p>
							{!searchInput && (
								<label
									className={cn(
										buttonVariants({ variant: "outline" }),
										"mt-1 cursor-pointer",
									)}
									htmlFor="upload-input"
								>
									<HugeiconsIcon
										icon={Upload01Icon}
										size={15}
										strokeWidth={1.5}
									/>
									Choose files
								</label>
							)}
						</CardContent>
					</Card>
				) : search.view === "grid" ? (
					<div className="fade-in-0 slide-in-from-bottom-1 grid animate-in grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3 duration-300">
						{objects.map((item) => (
							<ObjectCard
								item={item}
								key={item.key}
								maxSize={maxVisibleSize}
								onDelete={() => deleteMutation.mutate([item.key])}
								onDownload={() => downloadMutation.mutate(item)}
								onEdit={() => openEditor(item.key)}
								onOpenFolder={() =>
									void navigate({
										search: (current) => ({
											...current,
											prefix: item.key,
										}),
									})
								}
								onOpenInNewTab={() => openTab({ prefix: item.key })}
								onPreview={() => previewMutation.mutate(item)}
								onReplace={() => openReplacePicker(item)}
								onRename={() => {
									setRenameTarget(item);
									setRenameValue(item.name);
								}}
								onSelect={(checked) =>
									setSelectedKeys((current) =>
										checked
											? [...new Set([...current, item.key])]
											: current.filter((entry) => entry !== item.key),
									)
								}
								onShare={() => copyObjectUrl(item)}
								selected={selectedKeys.includes(item.key)}
							/>
						))}
					</div>
				) : (
					<div className="fade-in-0 slide-in-from-bottom-1 animate-in overflow-hidden rounded-xl border bg-card shadow-xs duration-300">
						<div className={cn(ENTRY_GRID, "h-9 border-b bg-muted/40")}>
							<Checkbox
								aria-label="Select all"
								checked={
									selectedKeys.length > 0 &&
									selectedKeys.length === objects.length
								}
								onCheckedChange={(checked) =>
									setSelectedKeys(
										checked ? objects.map((entry) => entry.key) : [],
									)
								}
							/>
							<span />
							<span className={SECTION_LABEL}>Name</span>
							<span className={cn(SECTION_LABEL, HIDE_SM)}>Type</span>
							<span className={cn(SECTION_LABEL, HIDE_SM)}>Size</span>
							<span className={cn(SECTION_LABEL, HIDE_SM)}>Modified</span>
							<span />
						</div>
						<div
							className="max-h-[calc(100vh-260px)] min-h-[320px] overflow-auto"
							ref={parentRef}
						>
							<div
								className="relative"
								style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
							>
								{rowVirtualizer.getVirtualItems().map((virtualItem) => {
									const item = objects[virtualItem.index];
									return (
										<div
											className="absolute right-0 left-0"
											key={item.key}
											style={{
												height: `${virtualItem.size}px`,
												transform: `translateY(${virtualItem.start}px)`,
											}}
										>
											<EntryRow
												item={item}
												maxSize={maxVisibleSize}
												onDelete={() => deleteMutation.mutate([item.key])}
												onDownload={() => downloadMutation.mutate(item)}
												onEdit={() => openEditor(item.key)}
												onOpenFolder={() =>
													void navigate({
														search: (current) => ({
															...current,
															prefix: item.key,
														}),
													})
												}
												onOpenInNewTab={() => openTab({ prefix: item.key })}
												onPreview={() => previewMutation.mutate(item)}
												onReplace={() => openReplacePicker(item)}
												onRename={() => {
													setRenameTarget(item);
													setRenameValue(item.name);
												}}
												onSelect={(checked) =>
													setSelectedKeys((current) =>
														checked
															? [...new Set([...current, item.key])]
															: current.filter((entry) => entry !== item.key),
													)
												}
												onShare={() => copyObjectUrl(item)}
												selected={selectedKeys.includes(item.key)}
											/>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				)}
			</section>
			{status.error ? (
				<Alert variant="destructive">
					<AlertDescription>{status.text}</AlertDescription>
					<AlertAction>
						<Button
							onClick={() => setStatusMessage("")}
							size="xs"
							type="button"
							variant="outline"
						>
							Dismiss
						</Button>
					</AlertAction>
				</Alert>
			) : status.text ? (
				<Alert>
					<AlertDescription>{status.text}</AlertDescription>
				</Alert>
			) : null}
			{transferToasts.length ? (
				<div className="fixed right-4 bottom-4 z-60 grid w-[min(320px,calc(100vw-2rem))] gap-2">
					{transferToasts.map((transfer) => {
						const progress = transfer.totalBytes
							? Math.min(
									100,
									(transfer.transferredBytes / transfer.totalBytes) * 100,
								)
							: transfer.status === "failed"
								? 100
								: 24;
						return (
							<Card
								className="fade-in-0 slide-in-from-bottom-2 animate-in shadow-lg duration-300"
								key={transfer.id}
								size="sm"
							>
								<CardContent className="space-y-3">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<div className="truncate font-medium text-sm">
												{transfer.fileName}
											</div>
											<div className="text-muted-foreground text-xs">
												{transfer.kind} • {transfer.status}
											</div>
										</div>
										<Badge
											variant={
												transfer.status === "failed"
													? "destructive"
													: "secondary"
											}
										>
											{transfer.totalBytes
												? `${Math.round(progress)}%`
												: "live"}
										</Badge>
									</div>
									<Progress
										className={
											transfer.status === "failed"
												? "[&_[data-slot=progress-indicator]]:bg-destructive"
												: undefined
										}
										value={progress}
									/>
									<div
										className={cn(
											"text-xs",
											transfer.errorMessage
												? "text-destructive"
												: "text-muted-foreground",
										)}
									>
										{transfer.errorMessage
											? transfer.errorMessage
											: `${formatBytes(transfer.transferredBytes)} / ${formatBytes(transfer.totalBytes)}`}
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			) : null}
			{/* Quick look lives in a drawer, not a modal: the listing stays visible
          behind it, so "peek at a few files in a row" needs no re-orientation. */}
			<Sheet
				onOpenChange={(open) => {
					if (!open) {
						closePreview();
					}
				}}
				open={!!previewKey}
			>
				<SheetContent
					className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
					side="right"
				>
					<SheetHeader className="border-b pr-12">
						<SheetTitle className="truncate">
							{preview?.fileName ?? previewKey?.split("/").pop()}
						</SheetTitle>
						<SheetDescription className="truncate">
							{bucket}/{previewKey}
						</SheetDescription>
					</SheetHeader>
					<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
						<dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
							{(
								[
									["Type", preview?.contentType ?? "Loading…"],
									[
										"Size",
										previewEntry?.kind === "file"
											? formatBytes(previewEntry.size)
											: "—",
									],
									[
										"Modified",
										previewEntry?.kind === "file"
											? formatTimestamp(previewEntry.lastModified)
											: "—",
									],
								] as const
							).map(([label, value]) => (
								<div className="bg-card px-3 py-2" key={label}>
									<dt className="text-muted-foreground text-xs">{label}</dt>
									<dd
										className="mt-0.5 truncate font-medium text-xs tabular-nums"
										title={value}
									>
										{value}
									</dd>
								</div>
							))}
						</dl>
						{previewMutation.isPending ? (
							<div className="flex flex-col gap-3">
								<Skeleton className="h-64 w-full" />
								<Skeleton className="h-4 w-2/3" />
								<Skeleton className="h-4 w-2/5" />
							</div>
						) : (
							<div className="flex min-w-0 justify-center">
								{previewRenderer(preview, textPreview)}
							</div>
						)}
					</div>
					<SheetFooter className="flex-row flex-wrap justify-end border-t">
						{previewEntry ? (
							<>
								<Button
									onClick={() => downloadMutation.mutate(previewEntry)}
									size="sm"
									type="button"
									variant="outline"
								>
									<HugeiconsIcon
										icon={CloudDownloadIcon}
										size={15}
										strokeWidth={1.5}
									/>
									Download
								</Button>
								<Button
									onClick={() => copyObjectUrl(previewEntry)}
									size="sm"
									type="button"
									variant="outline"
								>
									<HugeiconsIcon
										icon={CopyLinkIcon}
										size={15}
										strokeWidth={1.5}
									/>
									Copy URL
								</Button>
							</>
						) : null}
						{provider && (provider.type === "aws" || provider.type === "r2") ? (
							<Button
								onClick={() => {
									setCfDistId(provider.cloudFrontDistributionId ?? "");
									setCfZoneId(provider.cloudflareZoneId ?? "");
									setCfToken(provider.cloudflareApiToken ?? "");
									setCdnBaseUrl(provider.publicBaseUrl ?? "");
									setPurgeOpen(true);
								}}
								size="sm"
								type="button"
								variant="outline"
							>
								Purge cache
							</Button>
						) : null}
						{preview &&
						previewKey &&
						isEditableTextContentType(preview.contentType) ? (
							<Button
								onClick={() => openEditor(previewKey)}
								size="sm"
								type="button"
							>
								<HugeiconsIcon
									icon={FileEditIcon}
									size={15}
									strokeWidth={1.5}
								/>
								Open in editor
							</Button>
						) : null}
					</SheetFooter>
				</SheetContent>
			</Sheet>
			<Dialog
				open={purgeOpen}
				onOpenChange={(open) => {
					setPurgeOpen(open);
					if (!open) {
						setPurgeNotesShown(false);
					}
				}}
			>
				{/* max-h + overflow: the R2 branch has two inputs, a URL field and a
				    pair of multi-line curl commands, which together are taller than
				    most viewports. min-w-0 on the form: DialogContent is a grid, so
				    without it the wide <pre> stretches the track instead of
				    scrolling inside it. */}
				<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Purge CDN cache</DialogTitle>
						<DialogDescription>
							{provider?.type === "r2"
								? "Cloudflare's API refuses browser calls, so this builds a command for you to run yourself. Credentials never leave your machine."
								: "Invalidates the distribution so viewers get the latest objects. Credentials never leave your machine."}
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex min-w-0 flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							setPurgeNotesShown(true);
							purgeMutation.mutate({});
						}}
					>
						{provider?.type === "aws" ? (
							<div className="flex min-w-0 flex-col gap-2">
								<LabelWithHelp
									help={
										<>
											AWS Console → CloudFront → Distributions → copy the ID of
											the distribution serving this bucket. Uses this provider's
											existing access key, which needs the{" "}
											<code>cloudfront:CreateInvalidation</code> IAM permission.
										</>
									}
									htmlFor="cf-dist"
								>
									CloudFront Distribution ID
								</LabelWithHelp>
								<Input
									autoFocus
									id="cf-dist"
									onChange={(event) => setCfDistId(event.target.value)}
									placeholder="E1A2B3C4D5E6F7"
									value={cfDistId}
								/>
							</div>
						) : provider?.type === "r2" ? (
							<div className="flex min-w-0 flex-col gap-2">
								<LabelWithHelp
									help={
										<>
											Cloudflare dashboard → select your domain → Overview → API
											panel on the right.
										</>
									}
									htmlFor="cf-zone"
								>
									Cloudflare Zone ID
								</LabelWithHelp>
								<Input
									autoFocus
									id="cf-zone"
									onChange={(event) => setCfZoneId(event.target.value)}
									placeholder="0123456789abcdef0123456789abcdef"
									value={cfZoneId}
								/>
								<LabelWithHelp
									help={
										<>
											My Profile → API Tokens → Create Token, and give it{" "}
											<code>Zone · Cache Purge</code> permission for this zone
											only. The token appears in the command below, so keep its
											scope narrow.
										</>
									}
									htmlFor="cf-token"
								>
									Cloudflare API Token
								</LabelWithHelp>
								<Input
									id="cf-token"
									onChange={(event) => setCfToken(event.target.value)}
									placeholder="API token with Cache Purge permission"
									type="password"
									value={cfToken}
								/>
							</div>
						) : (
							<p className="text-muted-foreground text-sm">
								Cache purge is only available for AWS (CloudFront) and
								Cloudflare R2 providers.
							</p>
						)}
						{provider?.type === "aws" || provider?.type === "r2" ? (
							<div className="flex min-w-0 flex-col gap-2">
								<LabelWithHelp
									help={
										<>
											The domain your visitors load these objects from. Set it
											and saving a file purges just that file instead of the
											whole zone or distribution.
										</>
									}
									htmlFor="cdn-base"
								>
									Public CDN URL (optional)
								</LabelWithHelp>
								<Input
									id="cdn-base"
									onChange={(event) => setCdnBaseUrl(event.target.value)}
									placeholder="https://cdn.example.com"
									value={cdnBaseUrl}
								/>
							</div>
						) : null}
						{purgeCommands.length ? (
							<div className="flex min-w-0 flex-col gap-4">
								<div className="flex items-center gap-1">
									<span className={SECTION_LABEL}>
										{provider?.type === "r2"
											? "Run this in your terminal"
											: "Or run it from your terminal"}
									</span>
									<Popover>
										<PopoverTrigger
											render={
												<Button
													aria-label="About these commands"
													size="icon-xs"
													type="button"
													variant="ghost"
												/>
											}
										>
											<HugeiconsIcon
												icon={HelpCircleIcon}
												size={14}
												strokeWidth={1.5}
											/>
										</PopoverTrigger>
										<PopoverContent
											align="start"
											className="text-muted-foreground text-xs leading-relaxed"
										>
											{provider?.type === "r2" ? (
												<>
													Paste it into a terminal after saving a file. The
													token is visible in the command, so clear your shell
													history if that matters to you. Cloudflare replies{" "}
													<code>{'"success": true'}</code> when the purge is
													accepted; edge propagation takes a few seconds.
												</>
											) : (
												<>
													Requires the AWS CLI and credentials with{" "}
													<code>cloudfront:CreateInvalidation</code>.{" "}
													<strong>Save &amp; purge now</strong> does the same
													thing without leaving the browser.
												</>
											)}
										</PopoverContent>
									</Popover>
								</div>
								{purgeCommands.map((entry) => (
									<div
										className="flex min-w-0 flex-col gap-2"
										key={entry.label}
									>
										<span className="truncate font-medium text-sm">
											{entry.label}
										</span>
										<TerminalBlock
											command={entry.value.command}
											fileUrl={entry.value.fileUrl}
											secrets={[cfToken]}
											onCopied={(message) => {
												setPurgeNotesShown(true);
												setStatusMessage(message);
											}}
										/>
										<p className="text-muted-foreground text-xs">
											{entry.value.scope}
										</p>
										{(purgeNotesShown ? entry.value.notes : []).map((note) => (
											<p className="text-destructive text-xs" key={note}>
												{note}
											</p>
										))}
									</div>
								))}
							</div>
						) : null}
						<DialogFooter>
							<Button
								onClick={() => setPurgeOpen(false)}
								size="xs"
								type="button"
								variant="outline"
							>
								Close
							</Button>
							<Button
								disabled={purgeMutation.isPending}
								size="xs"
								type="submit"
								variant="outline"
							>
								{purgeMutation.isPending ? "Saving…" : "Save settings"}
							</Button>
							{provider?.type === "aws" ? (
								<Button
									disabled={purgeMutation.isPending || !cfDistId.trim()}
									onClick={() => {
										setPurgeNotesShown(true);
										purgeMutation.mutate({ purge: true });
									}}
									size="xs"
									type="button"
									variant="default"
								>
									{purgeMutation.isPending ? "Purging…" : "Save & purge now"}
								</Button>
							) : null}
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={!!renameTarget}
				onOpenChange={(open) => {
					if (!open) {
						setRenameTarget(null);
						setRenameValue("");
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename object</DialogTitle>
						<DialogDescription>
							Enter a new name for {renameTarget?.name}.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (!(renameValue.trim() && provider && bucket && renameTarget)) {
								return;
							}
							renameMutation.mutate({
								fromKey: renameTarget.key,
								toKey: `${search.prefix}${renameValue.trim()}`,
							});
							setRenameTarget(null);
							setRenameValue("");
						}}
					>
						<Input
							autoFocus
							onChange={(event) => setRenameValue(event.target.value)}
							placeholder="New name"
							value={renameValue}
						/>
						<DialogFooter className="mt-4">
							<Button
								onClick={() => {
									setRenameTarget(null);
									setRenameValue("");
								}}
								size="xs"
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								disabled={!renameValue.trim()}
								size="xs"
								type="submit"
								variant="default"
							>
								Rename
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New folder</DialogTitle>
						<DialogDescription>
							Create a new folder in {search.prefix || "/"}.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (!(folderName.trim() && provider && bucket)) {
								return;
							}
							const name = folderName.trim();
							void createFolder(provider, bucket, `${search.prefix}${name}/`)
								.then(async () => {
									setStatusMessage(`Created folder ${name}.`);
									await queryClient.invalidateQueries({
										queryKey: ["objects", provider.id, bucket],
									});
								})
								.catch((error) => {
									setStatusMessage(
										error instanceof Error
											? error.message
											: "Folder creation failed.",
									);
								});
							setFolderDialogOpen(false);
							setFolderName("");
						}}
					>
						<Input
							autoFocus
							onChange={(event) => setFolderName(event.target.value)}
							placeholder="Folder name"
							value={folderName}
						/>
						<DialogFooter className="mt-4">
							<Button
								onClick={() => {
									setFolderDialogOpen(false);
									setFolderName("");
								}}
								size="xs"
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								disabled={!folderName.trim()}
								size="xs"
								type="submit"
								variant="default"
							>
								Create
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete items</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete {selectedKeys.length} selected
							item
							{selectedKeys.length > 1 ? "s" : ""}? This action cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => setDeleteConfirmOpen(false)}
							size="xs"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							onClick={() => {
								deleteMutation.mutate(selectedKeys);
								setDeleteConfirmOpen(false);
							}}
							size="xs"
							type="button"
							variant="destructive"
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

type EntryActions = {
	item: ObjectEntry;
	selected: boolean;
	onSelect: (checked: boolean) => void;
	onOpenFolder: () => void;
	onOpenInNewTab: () => void;
	onDownload: () => void;
	onPreview: () => void;
	onEdit: () => void;
	onReplace: () => void;
	onRename: () => void;
	onDelete: () => void;
	onShare: () => void;
};

/** Shared overflow menu — identical in list and grid, so it lives in one place. */
function EntryMenu(props: EntryActions) {
	const { item } = props;
	const isFile = item.kind === "file";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button size="icon-xs" title="More actions" variant="ghost" />}
			>
				<HugeiconsIcon icon={MoreHorizontalIcon} size={15} strokeWidth={1.5} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side="bottom">
				{isFile && item.isPreviewable && (
					<DropdownMenuItem onClick={props.onPreview}>
						<HugeiconsIcon icon={EyeIcon} size={15} strokeWidth={1.5} />
						Preview
					</DropdownMenuItem>
				)}
				{/* Decided from the key, not the object's declared Content-Type: the
				    menu opens before anything is fetched, and R2 objects routinely
				    arrive as application/octet-stream. */}
				{isFile &&
					isEditableTextContentType(resolveObjectContentType(item.key)) && (
						<DropdownMenuItem onClick={props.onEdit}>
							<HugeiconsIcon icon={FileEditIcon} size={15} strokeWidth={1.5} />
							Edit
						</DropdownMenuItem>
					)}
				{isFile && (
					<DropdownMenuItem onClick={props.onDownload}>
						<HugeiconsIcon
							icon={CloudDownloadIcon}
							size={15}
							strokeWidth={1.5}
						/>
						Download
					</DropdownMenuItem>
				)}
				{isFile && (
					<DropdownMenuItem onClick={props.onRename}>
						<HugeiconsIcon icon={PencilIcon} size={15} strokeWidth={1.5} />
						Rename
					</DropdownMenuItem>
				)}
				{isFile && (
					<DropdownMenuItem onClick={props.onReplace}>
						<HugeiconsIcon icon={FileEditIcon} size={15} strokeWidth={1.5} />
						Replace
					</DropdownMenuItem>
				)}
				{isFile && (
					<DropdownMenuItem onClick={props.onShare}>
						<HugeiconsIcon icon={CopyLinkIcon} size={15} strokeWidth={1.5} />
						Copy URL
					</DropdownMenuItem>
				)}
				{!isFile && (
					<DropdownMenuItem onClick={props.onOpenFolder}>
						<HugeiconsIcon icon={FolderOpenIcon} size={15} strokeWidth={1.5} />
						Open
					</DropdownMenuItem>
				)}
				{!isFile && (
					<DropdownMenuItem onClick={props.onOpenInNewTab}>
						<HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={1.5} />
						Open in new tab
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={props.onDelete} variant="destructive">
					<HugeiconsIcon icon={DeleteThrowIcon} size={15} strokeWidth={1.5} />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function EntryRow(props: EntryActions & { maxSize: number }) {
	const { item, maxSize } = props;
	const isFolder = item.kind === "folder";

	// Square-root scale: linear makes every ordinary file a 1px stub next to one
	// outlier, which is exactly when you most want to read the small ones.
	const weight =
		!isFolder && maxSize > 0
			? Math.max(2, Math.sqrt(item.size / maxSize) * 100)
			: 0;

	return (
		<div
			className={cn(
				ENTRY_GRID,
				"group/row relative h-14 w-full border-border/60 border-b text-left transition-colors hover:bg-muted/50",
				props.selected && "bg-muted",
			)}
		>
			<Checkbox
				aria-label={`Select ${item.name}`}
				checked={props.selected}
				onCheckedChange={props.onSelect}
			/>

			<FileGlyph item={item} size="md" />

			<div className="flex min-w-0 flex-col">
				<button
					className="truncate text-left font-medium text-sm hover:underline"
					onClick={() => {
						if (isFolder) {
							props.onOpenFolder();
							return;
						}
						if (item.isPreviewable) {
							props.onPreview();
						} else {
							props.onDownload();
						}
					}}
					title={item.name}
					type="button"
				>
					{item.name}
				</button>
				<span className="truncate text-muted-foreground text-xs min-[900px]:hidden">
					{isFolder
						? "prefix"
						: `${formatBytes(item.size)} · ${formatTimestamp(item.lastModified)}`}
				</span>
			</div>

			<span
				className={cn(
					HIDE_SM,
					"truncate font-mono text-muted-foreground text-xs uppercase",
				)}
			>
				{isFolder ? "DIR" : extensionLabel(item) || "—"}
			</span>
			{/* Weight rule: size relative to the largest file in view, drawn as a
			    small meter under the number instead of a full-width row underline
			    (which read as a stray border). */}
			<span className={cn(HIDE_SM, "min-w-0")}>
				<span className="block truncate text-xs tabular-nums">
					{isFolder ? "—" : formatBytes(item.size)}
				</span>
				{weight > 0 && (
					<span className="mt-1 block h-0.5 w-14 overflow-hidden rounded-full bg-muted">
						<span
							className="block h-full rounded-full bg-foreground/30 transition-[width] duration-300"
							style={{ width: `${weight}%` }}
						/>
					</span>
				)}
			</span>
			<span className={cn(HIDE_SM, "truncate text-muted-foreground text-xs")}>
				{isFolder ? "—" : formatTimestamp(item.lastModified)}
			</span>

			<div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100">
				<EntryMenu {...props} />
			</div>
		</div>
	);
}

function ObjectCard(props: EntryActions & { maxSize: number }) {
	const { item } = props;
	const isFolder = item.kind === "folder";
	return (
		<Card
			className={cn(
				"gap-3 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
				props.selected && "bg-muted ring-primary/40",
			)}
			size="sm"
		>
			<CardContent className="flex items-start justify-between gap-2">
				<FileGlyph item={item} size="lg" />
				<div className="flex items-center gap-1">
					<Checkbox
						aria-label={`Select ${item.name}`}
						checked={props.selected}
						onCheckedChange={props.onSelect}
					/>
					<EntryMenu {...props} />
				</div>
			</CardContent>
			<CardContent className="min-w-0">
				<button
					className="w-full truncate text-left font-medium text-sm hover:underline"
					onClick={isFolder ? props.onOpenFolder : props.onPreview}
					title={item.name}
					type="button"
				>
					{item.name}
				</button>
				<div className="mt-1 truncate text-muted-foreground text-xs">
					{isFolder
						? "prefix"
						: `${formatBytes(item.size)} · ${formatTimestamp(item.lastModified)}`}
				</div>
			</CardContent>
		</Card>
	);
}
