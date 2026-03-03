import {
	CloudDownloadIcon,
	CopyLinkIcon,
	DeleteThrowIcon,
	EyeIcon,
	FileEditIcon,
	FolderOpenIcon,
	MoreVerticalIcon,
	PencilIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type DragEvent,
	Fragment,
	startTransition,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { z } from "zod";
import { Button, buttonVariants } from "../components/ui/button";
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
import {
	Table,
	TableHead,
	TableHeader,
	TableRow,
} from "../components/ui/table";
import {
	getActiveProviderId,
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
	objectIcon,
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
	if (
		preview.contentType.startsWith("text/") ||
		preview.contentType.includes("yaml") ||
		preview.contentType.includes("yml") ||
		preview.contentType.includes("markdown") ||
		preview.contentType.includes("xml") ||
		preview.contentType.includes("json")
	) {
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
		bucketsQuery.data?.[0];
	const [searchInput, setSearchInput] = useState("");
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
	const [textPreview, setTextPreview] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState(
		"Select a provider and bucket to start browsing objects.",
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
		estimateSize: () => 82,
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
			setStatusMessage(
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
			if (
				nextPreview.contentType.startsWith("text/") ||
				nextPreview.contentType.includes("json")
			) {
				nextText = await fetch(nextPreview.blobUrl).then((response) =>
					response.text(),
				);
			}
			return { nextPreview, nextText };
		},
		onSuccess: ({ nextPreview, nextText }) => {
			if (preview) {
				URL.revokeObjectURL(preview.blobUrl);
			}
			setPreview(nextPreview);
			setTextPreview(nextText);
		},
		onError: (error) => {
			setStatusMessage(
				error instanceof Error ? error.message : "Preview failed.",
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
			setStatusMessage(
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
			setStatusMessage(
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
			setStatusMessage(
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
			setStatusMessage(
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
			<section className="control-panel px-6 py-8">
				<div className="section-label">Browser</div>
				<h2 className="page-title mt-2">No provider configured</h2>
				<p className="page-copy mt-4 max-w-2xl">
					Create at least one provider profile before browsing objects. The app
					stores credentials only in the browser and uses direct S3 API
					requests.
				</p>
				<Link
					className={cn(
						buttonVariants({ size: "sm", variant: "default" }),
						"mt-6",
					)}
					to="/providers"
				>
					Open providers
				</Link>
			</section>
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

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<div className="browser-breadcrumbs">
						<Button
							className="text-neutral-300 text-xs!"
							variant="link"
							size="xs"
							onClick={() =>
								void navigate({
									search: (current) => ({ ...current, prefix: "" }),
								})
							}
							type="button"
						>
							{bucket ?? "root"}
						</Button>
						{pathSegments.length > 0 && (
							<span className="browser-breadcrumb-separator">/</span>
						)}
						{pathSegments.map((segment, index) => {
							const nextPrefix = `${pathSegments.slice(0, index + 1).join("/")}/`;
							return (
								<Fragment key={nextPrefix}>
									<Button
										className="text-neutral-300 text-xs!"
										variant="link"
										size="xs"
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
									</Button>
									{index < pathSegments.length - 1 && (
										<span className="browser-breadcrumb-separator">/</span>
									)}
								</Fragment>
							);
						})}
					</div>
					<span className="browser-kpi-chip">
						<strong>{objects.length}</strong> objects
					</span>
					<span className="browser-kpi-chip">
						<strong>{formatBytes(visibleBytes)}</strong>
					</span>
					{runningTransfers.length > 0 && (
						<span className="browser-kpi-chip">
							<strong>{runningTransfers.length}</strong> transfer
							{runningTransfers.length === 1 ? "" : "s"}
						</span>
					)}
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<div className="browser-actions">
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
							className={cn(
								buttonVariants({ size: "xs", variant: "default" }),
								"cursor-pointer",
							)}
							htmlFor="upload-input"
						>
							Upload
						</label>
						<Button
							onClick={() => {
								setFolderName("");
								setFolderDialogOpen(true);
							}}
							size="xs"
							className="text-xs!"
							type="button"
							variant="outline"
						>
							New folder
						</Button>
						<Button
							disabled={!selectedKeys.length}
							onClick={() => setDeleteConfirmOpen(true)}
							size="xs"
							className="text-xs!"
							type="button"
							variant="destructive"
						>
							Delete
						</Button>
					</div>
					<div className="flex gap-1">
						<button
							className={cn(
								"toggle-button",
								search.view === "list" && "toggle-button-active",
							)}
							onClick={() =>
								void navigate({
									search: (current) => ({
										...current,
										view: "list" satisfies BrowserView,
									}),
								})
							}
							type="button"
						>
							List
						</button>
						<button
							className={cn(
								"toggle-button",
								search.view === "grid" && "toggle-button-active",
							)}
							onClick={() =>
								void navigate({
									search: (current) => ({
										...current,
										view: "grid" satisfies BrowserView,
									}),
								})
							}
							type="button"
						>
							Grid
						</button>
					</div>
				</div>
			</div>

			<section className="control-panel browser-workspace px-4 py-4 lg:px-5 lg:py-5">
				<div className="browser-toolbar">
					<div className="compact-toolbar">
						<div className="field">
							<span>Provider</span>
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
								<SelectTrigger className="w-full">
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
						</div>

						<div className="field">
							<span>Bucket</span>
							<Select
								onValueChange={(nextBucket) => {
									if (!nextBucket) {
										return;
									}
									void navigate({
										search: (current) => ({
											...current,
											bucket: nextBucket,
											prefix: "",
										}),
									});
									setStatusMessage(`Opened bucket ${nextBucket}.`);
								}}
								value={bucket}
							>
								<SelectTrigger className="w-full">
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
						</div>

						<label className="field">
							<span>Search</span>
							<input
								className="input"
								onChange={(event) => setSearchInput(event.target.value)}
								placeholder="Filter visible objects"
								value={searchInput}
							/>
						</label>
					</div>

					<div>
						{bucketsQuery.data?.length ? null : (
							<div className="field-note mt-3">
								No buckets are available to show. If this is R2, account-level
								listing may be blocked by browser CORS.
							</div>
						)}
					</div>
				</div>

				{/* biome-ignore lint/a11y/noStaticElementInteractions: this section is a drag-and-drop target for file uploads, not a click target */}
				<section
					className={cn(
						"file-dropzone",
						isDragActive && "file-dropzone-active",
					)}
					onDragEnter={handleDragEnter}
					onDragLeave={handleDragLeave}
					onDragOver={handleDragOver}
					onDrop={handleDrop}
				>
					{isDragActive ? (
						<div className="drop-overlay">
							<div className="drop-overlay-inner">
								<div className="section-label">Drop files to upload</div>
								<div className="drop-title">
									Release to send into {bucket ?? "current bucket"}
								</div>
								<div className="drop-copy">
									Files will upload into the current prefix:
									<span className="drop-accent ml-2">
										{search.prefix || "/"}
									</span>
								</div>
							</div>
						</div>
					) : null}
					{search.view === "grid" ? (
						<div className="object-grid">
							{objects.map((item) => (
								<ObjectCard
									item={item}
									key={item.key}
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
									onShare={async () => {
										if (!provider || !bucket) {
											return;
										}
										const url = buildObjectUrl(provider, bucket, item.key);
										if (!url) {
											setStatusMessage(
												"Direct URL unavailable for this provider.",
											);
											return;
										}
										await navigator.clipboard.writeText(url);
										setStatusMessage(`Copied URL for ${item.name}.`);
									}}
									selected={selectedKeys.includes(item.key)}
								/>
							))}
						</div>
					) : (
						<div className="overflow-hidden rounded-lg border border-border">
							<Table>
								<TableHeader>
									<TableRow className="border-b-border hover:bg-transparent">
										<TableHead className="w-8 px-3" />
										<TableHead>Name</TableHead>
										<TableHead className="w-24">Size</TableHead>
										<TableHead className="w-36">Updated</TableHead>
										<TableHead className="w-24 pr-3 text-right">
											Actions
										</TableHead>
									</TableRow>
								</TableHeader>
							</Table>
							<div
								className="max-h-[calc(100vh-320px)] min-h-[400px] overflow-auto"
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
												className="absolute right-0 left-0 flex items-center border-border border-b transition-colors hover:bg-[rgba(255,255,255,0.025)]"
												key={item.key}
												style={{
													height: `${virtualItem.size}px`,
													transform: `translateY(${virtualItem.start}px)`,
												}}
											>
												<div className="w-8 shrink-0 px-3">
													<input
														checked={selectedKeys.includes(item.key)}
														onChange={(event) =>
															setSelectedKeys((current) =>
																event.target.checked
																	? [...new Set([...current, item.key])]
																	: current.filter(
																			(entry) => entry !== item.key,
																		),
															)
														}
														type="checkbox"
													/>
												</div>
												<div className="min-w-0 flex-1 px-2">
													<button
														className="inline-flex items-center gap-2 border-none bg-transparent p-0 text-left text-(--text) text-sm"
														onClick={() => {
															if (item.kind === "folder") {
																void navigate({
																	search: (current) => ({
																		...current,
																		prefix: item.key,
																	}),
																});
																return;
															}
															if (item.isPreviewable) {
																previewMutation.mutate(item);
															}
														}}
														type="button"
													>
														<span className="icon-chip">
															{item.kind === "folder"
																? "DIR"
																: objectIcon(item.key)}
														</span>
														<span className="truncate">{item.name}</span>
													</button>
												</div>
												<div className="w-24 shrink-0 px-2 text-(--text-soft) text-sm">
													{item.kind === "folder"
														? "Folder"
														: formatBytes(item.size)}
												</div>
												<div className="w-36 shrink-0 px-2 text-muted text-sm">
													{formatTimestamp(item.lastModified)}
												</div>
												<div className="flex w-28 shrink-0 items-center justify-end gap-1 px-2">
													{item.kind === "folder" ? (
														<Button
															onClick={() =>
																void navigate({
																	search: (current) => ({
																		...current,
																		prefix: item.key,
																	}),
																})
															}
															size="xs"
															title="Open folder"
															type="button"
															variant="outline"
															className="gap-1 text-xs!"
														>
															<HugeiconsIcon
																icon={FolderOpenIcon}
																strokeWidth={2}
															/>
															<span className="text-xs!">Open</span>
														</Button>
													) : (
														<Button
															onClick={() => downloadMutation.mutate(item)}
															size="xs"
															title="Download"
															type="button"
															variant="default"
															className="gap-1 text-xs!"
														>
															<HugeiconsIcon
																icon={CloudDownloadIcon}
																strokeWidth={2}
															/>
															<span className="text-xs!">Download</span>
														</Button>
													)}
													<DropdownMenu>
														<DropdownMenuTrigger
															render={
																<Button
																	size="icon-xs"
																	title="More actions"
																	variant="ghost"
																/>
															}
														>
															<HugeiconsIcon
																icon={MoreVerticalIcon}
																strokeWidth={2}
															/>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end" side="bottom">
															{item.kind === "file" && item.isPreviewable && (
																<DropdownMenuItem
																	onClick={() => previewMutation.mutate(item)}
																>
																	<HugeiconsIcon
																		icon={EyeIcon}
																		strokeWidth={2}
																	/>
																	Preview
																</DropdownMenuItem>
															)}
															{item.kind === "file" && (
																<DropdownMenuItem
																	onClick={() => downloadMutation.mutate(item)}
																>
																	<HugeiconsIcon
																		icon={CloudDownloadIcon}
																		strokeWidth={2}
																	/>
																	Download
																</DropdownMenuItem>
															)}
															{item.kind === "file" && (
																<DropdownMenuItem
																	onClick={() => {
																		setRenameTarget(item);
																		setRenameValue(item.name);
																	}}
																>
																	<HugeiconsIcon
																		icon={PencilIcon}
																		strokeWidth={2}
																	/>
																	Rename
																</DropdownMenuItem>
															)}
															{item.kind === "file" && (
																<DropdownMenuItem
																	onClick={() => openReplacePicker(item)}
																>
																	<HugeiconsIcon
																		icon={FileEditIcon}
																		strokeWidth={2}
																	/>
																	Replace
																</DropdownMenuItem>
															)}
															{item.kind === "file" && (
																<DropdownMenuItem
																	onClick={async () => {
																		if (!provider || !bucket) return;
																		const url = buildObjectUrl(
																			provider,
																			bucket,
																			item.key,
																		);
																		if (!url) {
																			setStatusMessage(
																				"Direct URL unavailable for this provider.",
																			);
																			return;
																		}
																		await navigator.clipboard.writeText(url);
																		setStatusMessage(
																			`Copied URL for ${item.name}.`,
																		);
																	}}
																>
																	<HugeiconsIcon
																		icon={CopyLinkIcon}
																		strokeWidth={2}
																	/>
																	Copy URL
																</DropdownMenuItem>
															)}
															{item.kind === "folder" && (
																<DropdownMenuItem
																	onClick={() =>
																		void navigate({
																			search: (current) => ({
																				...current,
																				prefix: item.key,
																			}),
																		})
																	}
																>
																	<HugeiconsIcon
																		icon={FolderOpenIcon}
																		strokeWidth={2}
																	/>
																	Open
																</DropdownMenuItem>
															)}
															<DropdownMenuSeparator />
															<DropdownMenuItem
																onClick={() =>
																	deleteMutation.mutate([item.key])
																}
																variant="destructive"
															>
																<HugeiconsIcon
																	icon={DeleteThrowIcon}
																	strokeWidth={2}
																/>
																Delete
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						</div>
					)}
				</section>
			</section>

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
							<Button
								onClick={() => {
									URL.revokeObjectURL(preview.blobUrl);
									setPreview(null);
									setTextPreview(null);
								}}
								size="sm"
								type="button"
								variant="outline"
							>
								Close
							</Button>
						</div>
						{previewRenderer(preview, textPreview)}
					</div>
				</div>
			) : null}

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

function ObjectCard(props: {
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
}) {
	const { item } = props;
	return (
		<div className="object-card">
			<div className="flex items-start justify-between gap-4">
				<label className="inline-flex items-center gap-3">
					<input
						checked={props.selected}
						onChange={(event) => props.onSelect(event.target.checked)}
						type="checkbox"
					/>
					<span className="icon-chip">
						{item.kind === "folder" ? "DIR" : objectIcon(item.key)}
					</span>
				</label>
				<span className="pill">
					{item.kind === "folder"
						? "folder"
						: item.isPreviewable
							? "viewable"
							: "file"}
				</span>
			</div>
			<div className="mt-4">
				<button
					className="truncate object-card-title text-left"
					onClick={
						item.kind === "folder" ? props.onOpenFolder : props.onPreview
					}
					type="button"
				>
					{item.name}
				</button>
				<div className="mt-2 object-card-meta">
					{item.kind === "folder"
						? "Folder marker / prefix"
						: `${formatBytes(item.size)} • ${formatTimestamp(item.lastModified)}`}
				</div>
			</div>
			<div className="mt-3 flex items-center gap-1">
				{item.kind === "folder" ? (
					<Button
						onClick={props.onOpenFolder}
						size="xs"
						type="button"
						variant="outline"
					>
						<HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
						Open
					</Button>
				) : (
					<Button
						onClick={props.onDownload}
						size="xs"
						type="button"
						variant="ghost"
					>
						<HugeiconsIcon icon={CloudDownloadIcon} strokeWidth={2} />
						Download
					</Button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button size="icon-xs" title="More actions" variant="ghost" />
						}
					>
						<HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" side="bottom">
						{item.kind === "file" && item.isPreviewable && (
							<DropdownMenuItem onClick={props.onPreview}>
								<HugeiconsIcon icon={EyeIcon} strokeWidth={2} />
								Preview
							</DropdownMenuItem>
						)}
						{item.kind === "file" && (
							<DropdownMenuItem onClick={props.onDownload}>
								<HugeiconsIcon icon={CloudDownloadIcon} strokeWidth={2} />
								Download
							</DropdownMenuItem>
						)}
						{item.kind === "file" && (
							<DropdownMenuItem onClick={props.onRename}>
								<HugeiconsIcon icon={PencilIcon} strokeWidth={2} />
								Rename
							</DropdownMenuItem>
						)}
						{item.kind === "file" && (
							<DropdownMenuItem onClick={props.onReplace}>
								<HugeiconsIcon icon={FileEditIcon} strokeWidth={2} />
								Replace
							</DropdownMenuItem>
						)}
						{item.kind === "file" && (
							<DropdownMenuItem onClick={props.onShare}>
								<HugeiconsIcon icon={CopyLinkIcon} strokeWidth={2} />
								Copy URL
							</DropdownMenuItem>
						)}
						{item.kind === "folder" && (
							<DropdownMenuItem onClick={props.onOpenFolder}>
								<HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
								Open
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={props.onDelete} variant="destructive">
							<HugeiconsIcon icon={DeleteThrowIcon} strokeWidth={2} />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
