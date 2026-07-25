import {
	ArrowRight01Icon,
	CloudDownloadIcon,
	CopyLinkIcon,
	Database01Icon,
	Delete02Icon,
	DeleteThrowIcon,
	EyeIcon,
	FileEditIcon,
	FolderAddIcon,
	FolderOpenIcon,
	GridViewIcon,
	LeftToRightListBulletIcon,
	MoreHorizontalIcon,
	PencilIcon,
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
import { Button } from "../components/ui/button";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import {
	buildPurgeCommand,
	canPurge,
	type PurgeCommand,
	purgeCache,
} from "../lib/cdn";
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
import {
	buildObjectUrl,
	createFolder,
	deleteKeys,
	downloadObject,
	previewObject,
	putObjectText,
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
		return <pre className="preview-code">{textPreview}</pre>;
	}
	return (
		<iframe
			className="h-[70vh] w-[80vw] rounded-lg bg-[color:var(--panel-strong)]"
			src={preview.blobUrl}
			title={preview.fileName}
		/>
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
	const [editText, setEditText] = useState("");
	const [purgeOpen, setPurgeOpen] = useState(false);
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
			const single = buildPurgeCommand(draft, [previewKey]);
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
	}, [provider, cfDistId, cfZoneId, cfToken, cdnBaseUrl, previewKey]);

	const runningTransfers = useMemo(
		() =>
			(transfersQuery.data ?? []).filter(
				(transfer) => transfer.status === "running",
			),
		[transfersQuery.data],
	);

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
		mutationFn: async (item: ObjectEntry) => {
			if (!(provider && bucket)) {
				throw new Error("Choose a provider and bucket first.");
			}
			const nextPreview = await previewObject(provider, bucket, item.key);
			let nextText: string | null = null;
			if (isEditableTextContentType(nextPreview.contentType)) {
				nextText = await fetch(nextPreview.blobUrl).then((response) =>
					response.text(),
				);
			}
			return { nextPreview, nextText };
		},
		onSuccess: ({ nextPreview, nextText }, item) => {
			if (preview) {
				URL.revokeObjectURL(preview.blobUrl);
			}
			setPreview(nextPreview);
			setPreviewKey(item.key);
			setTextPreview(nextText);
			setEditText(nextText ?? "");
		},
		onError: (error) => {
			setErrorMessage(
				error instanceof Error ? error.message : "Preview failed.",
			);
		},
	});

	const saveTextMutation = useMutation({
		mutationFn: async () => {
			if (!(provider && bucket && preview && previewKey)) {
				throw new Error("Nothing to save.");
			}
			// putObjectText writes then reads the object back, so reaching here
			// means the bytes are really in the bucket.
			await putObjectText(
				provider,
				bucket,
				previewKey,
				editText,
				preview.contentType,
			);

			// A stale CDN copy is the other half of "my edit disappeared". AWS can
			// purge in-app; R2 cannot (Cloudflare's API refuses browser calls), so
			// there we point at the copy-paste command instead of failing. Either
			// way a purge problem must never read as a save failure.
			if (canPurge(provider)) {
				const purge = await purgeCache(provider, [previewKey]).catch(
					(error: unknown) =>
						`Saved, but the CDN purge failed: ${
							error instanceof Error ? error.message : String(error)
						}`,
				);
				return { saved: editText, purge };
			}
			const needsManualPurge =
				provider.type === "r2" &&
				Boolean(provider.cloudflareZoneId && provider.cloudflareApiToken);
			return {
				saved: editText,
				purge: needsManualPurge
					? "CDN not purged — open Purge cache for the command to run."
					: undefined,
			};
		},
		onSuccess: async ({ saved, purge }) => {
			setTextPreview(saved);
			setStatusMessage(
				purge ? `Saved to ${bucket}. ${purge}` : `Saved to ${bucket}.`,
			);
			await queryClient.invalidateQueries({
				queryKey: ["objects", provider?.id, bucket],
			});
		},
		onError: (error) => {
			setErrorMessage(error instanceof Error ? error.message : "Save failed.");
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
			await navigator.clipboard.writeText(url);
			setStatusMessage(`Copied URL for ${item.name}.`);
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
			<div className="empty-state">
				<FileGlyph item={{ kind: "folder", key: "" }} open size="lg" />
				<h2 className="page-subtitle">No provider configured</h2>
				<p className="page-copy max-w-md">
					Add a provider profile to start browsing. Credentials stay in this
					browser and requests go straight to the S3 API.
				</p>
				<Link className="button-primary mt-1" to="/providers">
					Open providers
				</Link>
			</div>
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

			<div className="browser-toolbar">
				<div className="browser-breadcrumbs">
					<button
						className={cn(
							"crumb crumb-root",
							!pathSegments.length && "crumb-current",
						)}
						onClick={() =>
							void navigate({
								search: (current) => ({ ...current, prefix: "" }),
							})
						}
						type="button"
					>
						<HugeiconsIcon icon={Database01Icon} size={14} strokeWidth={1.5} />
						{bucket ?? "root"}
					</button>
					{pathSegments.map((segment, index) => {
						const nextPrefix = `${pathSegments.slice(0, index + 1).join("/")}/`;
						const isLast = index === pathSegments.length - 1;
						return (
							<Fragment key={nextPrefix}>
								<span className="browser-breadcrumb-separator">
									<HugeiconsIcon
										icon={ArrowRight01Icon}
										size={13}
										strokeWidth={1.5}
									/>
								</span>
								<button
									className={cn("crumb", isLast && "crumb-current")}
									onClick={() =>
										void navigate({
											search: (current) => ({
												...current,
												prefix: nextPrefix,
											}),
										})
									}
									type="button"
								>
									{segment}
								</button>
							</Fragment>
						);
					})}
				</div>

				<div className="browser-actions">
					<span className="browser-kpi-chip">
						{folderCount ? `${folderCount} ▸ ` : ""}
						{fileCount} {fileCount === 1 ? "file" : "files"}
						{visibleBytes > 0 ? ` · ${formatBytes(visibleBytes)}` : ""}
					</span>
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
					<label
						className="button-primary cursor-pointer"
						htmlFor="upload-input"
					>
						<HugeiconsIcon icon={Upload01Icon} size={15} strokeWidth={1.5} />
						Upload
					</label>
					<button
						className="button-secondary"
						onClick={() => {
							setFolderName("");
							setFolderDialogOpen(true);
						}}
						type="button"
					>
						<HugeiconsIcon icon={FolderAddIcon} size={15} strokeWidth={1.5} />
						New folder
					</button>
					{selectedKeys.length > 0 && (
						<button
							className="button-danger"
							onClick={() => setDeleteConfirmOpen(true)}
							type="button"
						>
							<HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={1.5} />
							Delete {selectedKeys.length}
						</button>
					)}
				</div>
			</div>

			<div className="browser-toolbar">
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
						<SelectTrigger className="h-[30px] w-[168px]" size="sm">
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
							<SelectTrigger className="h-[30px] w-[168px]" size="sm">
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
							<div className="search-field w-[168px]">
								<input
									aria-label="Bucket name"
									onChange={(event) => setBucketInput(event.target.value)}
									placeholder="Bucket name…"
									value={bucketInput}
								/>
							</div>
						</form>
					)}

					<div className="search-field">
						<HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.5} />
						<input
							onChange={(event) => setSearchInput(event.target.value)}
							placeholder="Filter this folder"
							value={searchInput}
						/>
					</div>
				</div>

				<div className="view-switch">
					{(
						[
							["list", LeftToRightListBulletIcon, "List"],
							["grid", GridViewIcon, "Grid"],
						] as const
					).map(([view, icon, label]) => (
						<button
							className="view-switch-item"
							data-active={search.view === view}
							key={view}
							onClick={() =>
								void navigate({
									search: (current) => ({
										...current,
										view: view satisfies BrowserView,
									}),
								})
							}
							title={`${label} view`}
							type="button"
						>
							<HugeiconsIcon icon={icon} size={15} strokeWidth={1.5} />
						</button>
					))}
				</div>
			</div>

			{bucketsQuery.data?.length ? null : (
				<div className="field-note">
					No buckets are available to show. If this is R2, account-level listing
					may be blocked by browser CORS.
				</div>
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
					<div className="drop-veil">
						Drop to upload into {search.prefix || "/"}
					</div>
				) : null}

				{objects.length === 0 ? (
					<div className="empty-state">
						<FileGlyph item={{ kind: "folder", key: "" }} open size="lg" />
						<div className="page-subtitle">
							{searchInput
								? "Nothing matches that filter"
								: "This folder is empty"}
						</div>
						<p className="page-copy max-w-sm">
							{searchInput
								? "Clear the filter to see everything in this prefix."
								: "Drop files here to upload them into this prefix."}
						</p>
					</div>
				) : search.view === "grid" ? (
					<div className="object-grid">
						{objects.map((item) => (
							<ObjectCard
								item={item}
								key={item.key}
								maxSize={maxVisibleSize}
								onDelete={() => deleteMutation.mutate([item.key])}
								onDownload={() => downloadMutation.mutate(item)}
								onOpenFolder={() =>
									void navigate({
										search: (current) => ({
											...current,
											prefix: item.key,
										}),
									})
								}
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
					<div className="entry-list">
						<div className="entry-head">
							<div className="entry-check">
								<input
									aria-label="Select all"
									checked={
										selectedKeys.length > 0 &&
										selectedKeys.length === objects.length
									}
									onChange={(event) =>
										setSelectedKeys(
											event.target.checked
												? objects.map((entry) => entry.key)
												: [],
										)
									}
									type="checkbox"
								/>
							</div>
							<span />
							<span className="section-label">Name</span>
							<span className="section-label entry-hide-sm">Type</span>
							<span className="section-label entry-hide-sm">Size</span>
							<span className="section-label entry-hide-sm">Modified</span>
							<span />
						</div>
						<div
							className="entry-scroll max-h-[calc(100vh-260px)] min-h-[320px]"
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
												onOpenFolder={() =>
													void navigate({
														search: (current) => ({
															...current,
															prefix: item.key,
														}),
													})
												}
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
				<div className="status-banner status-banner-error" role="alert">
					<span>{status.text}</span>
					<Button
						onClick={() => setStatusMessage("")}
						size="xs"
						type="button"
						variant="outline"
					>
						Dismiss
					</Button>
				</div>
			) : status.text ? (
				<div className="status-banner" role="status">
					{status.text}
				</div>
			) : null}

			{transferToasts.length ? (
				<div className="toast-stack">
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
							<div className="transfer-toast" key={transfer.id}>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<div className="toast-title">{transfer.fileName}</div>
										<div className="toast-meta">
											{transfer.kind} • {transfer.status}
										</div>
									</div>
									<span
										className={cn(
											"pill",
											transfer.status === "failed" && "pill-danger",
										)}
									>
										{transfer.totalBytes ? `${Math.round(progress)}%` : "live"}
									</span>
								</div>
								<div className="toast-progress mt-3">
									<div
										className={cn(
											"toast-progress-bar",
											transfer.status === "failed" &&
												"toast-progress-bar-danger",
										)}
										style={{ width: `${progress}%` }}
									/>
								</div>
								<div className="toast-meta mt-2">
									{transfer.errorMessage
										? transfer.errorMessage
										: `${formatBytes(transfer.transferredBytes)} / ${formatBytes(transfer.totalBytes)}`}
								</div>
							</div>
						);
					})}
				</div>
			) : null}

			{preview ? (
				<div className="preview-modal">
					<div className="preview-frame">
						<div className="mb-4 flex items-center justify-between gap-4">
							<div>
								<div className="section-label">Preview</div>
								<div className="preview-title mt-2">{preview.fileName}</div>
							</div>
							<div className="flex items-center gap-2">
								{provider &&
								(provider.type === "aws" || provider.type === "r2") ? (
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
								<Button
									onClick={() => {
										URL.revokeObjectURL(preview.blobUrl);
										setPreview(null);
										setPreviewKey(null);
										setTextPreview(null);
										setEditText("");
									}}
									size="sm"
									type="button"
									variant="outline"
								>
									Close
								</Button>
							</div>
						</div>
						{textPreview !== null &&
						isEditableTextContentType(preview.contentType) ? (
							<div className="flex flex-col gap-3">
								<Textarea
									className="h-[62vh] w-[80vw] max-w-full resize-none font-mono text-sm"
									onChange={(event) => setEditText(event.target.value)}
									spellCheck={false}
									value={editText}
								/>
								<div className="flex items-center justify-end gap-2">
									<Button
										disabled={editText === textPreview}
										onClick={() => setEditText(textPreview)}
										size="sm"
										type="button"
										variant="outline"
									>
										Reset
									</Button>
									<Button
										disabled={
											editText === textPreview || saveTextMutation.isPending
										}
										onClick={() => saveTextMutation.mutate()}
										size="sm"
										type="button"
										variant="default"
									>
										{saveTextMutation.isPending ? "Saving…" : "Save changes"}
									</Button>
								</div>
							</div>
						) : (
							previewRenderer(preview, textPreview)
						)}
					</div>
				</div>
			) : null}

			<Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Purge CDN cache</DialogTitle>
						<DialogDescription>
							{provider?.type === "r2"
								? "Cloudflare's API refuses browser calls, so this builds a command for you to run yourself. Credentials are stored encrypted with this provider and never leave your machine."
								: "Invalidates the distribution so viewers get the latest objects. Credentials are stored encrypted with this provider."}
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							purgeMutation.mutate({});
						}}
					>
						{provider?.type === "aws" ? (
							<div className="flex flex-col gap-2">
								<label className="section-label" htmlFor="cf-dist">
									CloudFront Distribution ID
								</label>
								<Input
									autoFocus
									id="cf-dist"
									onChange={(event) => setCfDistId(event.target.value)}
									placeholder="E1A2B3C4D5E6F7"
									value={cfDistId}
								/>
								<p className="text-muted-foreground text-xs">
									AWS Console → CloudFront → Distributions → copy the ID of the
									distribution serving this bucket. Uses this provider's
									existing access key (needs the{" "}
									<code>cloudfront:CreateInvalidation</code> IAM permission).
								</p>
							</div>
						) : provider?.type === "r2" ? (
							<div className="flex flex-col gap-2">
								<label className="section-label" htmlFor="cf-zone">
									Cloudflare Zone ID
								</label>
								<Input
									autoFocus
									id="cf-zone"
									onChange={(event) => setCfZoneId(event.target.value)}
									placeholder="0123456789abcdef0123456789abcdef"
									value={cfZoneId}
								/>
								<label className="section-label mt-2" htmlFor="cf-token">
									Cloudflare API Token
								</label>
								<Input
									id="cf-token"
									onChange={(event) => setCfToken(event.target.value)}
									placeholder="API token with Cache Purge permission"
									type="password"
									value={cfToken}
								/>
								<p className="text-muted-foreground text-xs">
									Zone ID: Cloudflare dashboard → select your domain → Overview
									→ API panel (right side). Token: My Profile → API Tokens →
									Create Token → give it <code>Zone · Cache Purge</code>{" "}
									permission for this zone.
								</p>
							</div>
						) : (
							<p className="text-muted-foreground text-sm">
								Cache purge is only available for AWS (CloudFront) and
								Cloudflare R2 providers.
							</p>
						)}
						{provider?.type === "aws" || provider?.type === "r2" ? (
							<div className="mt-4 flex flex-col gap-2">
								<label className="section-label" htmlFor="cdn-base">
									Public CDN URL (optional)
								</label>
								<Input
									id="cdn-base"
									onChange={(event) => setCdnBaseUrl(event.target.value)}
									placeholder="https://cdn.example.com"
									value={cdnBaseUrl}
								/>
								<p className="text-muted-foreground text-xs">
									The domain your visitors load these objects from. Set it and
									saving a file purges just that file instead of the whole
									zone/distribution.
								</p>
							</div>
						) : null}
						{purgeCommands.length ? (
							<div className="mt-5 flex flex-col gap-4">
								<div className="section-label">
									{provider?.type === "r2"
										? "Run this in your terminal"
										: "Or run it from your terminal"}
								</div>
								{purgeCommands.map((entry) => (
									<div className="flex flex-col gap-2" key={entry.label}>
										<div className="flex items-center justify-between gap-3">
											<span className="font-medium text-sm">{entry.label}</span>
											<Button
												onClick={async () => {
													await navigator.clipboard.writeText(
														entry.value.command,
													);
													setStatusMessage(`Copied: ${entry.label}.`);
												}}
												size="xs"
												type="button"
												variant="outline"
											>
												Copy
											</Button>
										</div>
										<pre className="preview-code max-h-48 overflow-auto text-xs">
											{entry.value.command}
										</pre>
										<p className="text-muted-foreground text-xs">
											{entry.value.scope}
										</p>
										{entry.value.notes.map((note) => (
											<p className="text-destructive text-xs" key={note}>
												{note}
											</p>
										))}
									</div>
								))}
								{provider?.type === "r2" ? (
									<p className="text-muted-foreground text-xs">
										Paste it into a terminal after saving a file. The token is
										visible in the command — prefer a token scoped to{" "}
										<code>Zone · Cache Purge</code> on this zone only, and clear
										your shell history if that matters to you. Cloudflare
										replies <code>{'"success": true'}</code> when the purge is
										accepted; edge propagation takes a few seconds.
									</p>
								) : (
									<p className="text-muted-foreground text-xs">
										Requires the AWS CLI and credentials with{" "}
										<code>cloudfront:CreateInvalidation</code>. The in-app
										button below does the same thing without leaving the
										browser.
									</p>
								)}
							</div>
						) : null}
						<DialogFooter className="mt-5">
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
									onClick={() => purgeMutation.mutate({ purge: true })}
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
	onDownload: () => void;
	onPreview: () => void;
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
		<div className="entry-row" data-selected={props.selected}>
			<div className="entry-check">
				<input
					aria-label={`Select ${item.name}`}
					checked={props.selected}
					onChange={(event) => props.onSelect(event.target.checked)}
					type="checkbox"
				/>
			</div>

			<FileGlyph item={item} size="md" />

			<div className="entry-main">
				<button
					className="entry-name"
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
				<span className="entry-meta">
					{isFolder
						? "prefix"
						: `${formatBytes(item.size)} · ${formatTimestamp(item.lastModified)}`}
				</span>
			</div>

			<span className="ext-label entry-hide-sm">
				{isFolder ? "DIR" : extensionLabel(item) || "—"}
			</span>
			<span className="entry-cell entry-hide-sm">
				{isFolder ? "—" : formatBytes(item.size)}
			</span>
			<span className="entry-cell entry-cell-muted entry-hide-sm">
				{isFolder ? "—" : formatTimestamp(item.lastModified)}
			</span>

			<div className="entry-actions">
				<EntryMenu {...props} />
			</div>

			{weight > 0 && (
				<span
					className="entry-weight"
					style={{ width: `calc((100% - 24px) * ${weight / 100})` }}
				/>
			)}
		</div>
	);
}

function ObjectCard(props: EntryActions & { maxSize: number }) {
	const { item, maxSize } = props;
	const isFolder = item.kind === "folder";
	const weight =
		!isFolder && maxSize > 0
			? Math.max(2, Math.sqrt(item.size / maxSize) * 100)
			: 0;
	return (
		<div className="object-card" data-selected={props.selected}>
			<div className="flex items-start justify-between gap-2">
				<FileGlyph item={item} size="lg" />
				<div className="flex items-center gap-1">
					<input
						aria-label={`Select ${item.name}`}
						checked={props.selected}
						onChange={(event) => props.onSelect(event.target.checked)}
						type="checkbox"
					/>
					<EntryMenu {...props} />
				</div>
			</div>
			<div className="min-w-0">
				<button
					className="w-full object-card-title text-left"
					onClick={isFolder ? props.onOpenFolder : props.onPreview}
					title={item.name}
					type="button"
				>
					{item.name}
				</button>
				<div className="mt-1 object-card-meta">
					{isFolder
						? "prefix"
						: `${formatBytes(item.size)} · ${formatTimestamp(item.lastModified)}`}
				</div>
			</div>
		</div>
	);
}
