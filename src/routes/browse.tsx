import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type DragEvent,
	startTransition,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { z } from "zod";
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
				className="max-h-[70vh] rounded-3xl object-contain"
				src={preview.blobUrl}
			/>
		);
	}
	if (preview.contentType.startsWith("video/")) {
		return (
			<video
				className="max-h-[70vh] rounded-3xl"
				controls
				src={preview.blobUrl}
			>
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
		return (
			<pre className="max-h-[70vh] overflow-auto rounded-3xl bg-black/30 p-4 text-stone-200 text-xs leading-6">
				{textPreview}
			</pre>
		);
	}
	return (
		<iframe
			className="h-[70vh] w-[80vw] rounded-3xl bg-white"
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
	const [bucketInput, setBucketInput] = useState(bucket ?? "");
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
		setBucketInput(bucket ?? "");
	}, [bucket]);

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

	const queueSnapshot = runningTransfers.slice(0, 4);
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

	const applyBucketInput = () => {
		const nextBucket = bucketInput.trim();
		if (!nextBucket) {
			setStatusMessage("Enter a bucket name to browse.");
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
	};

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
				<h2 className="mt-2 font-display text-3xl text-stone-100 uppercase tracking-[0.16em]">
					No provider configured
				</h2>
				<p className="mt-4 max-w-2xl text-sm text-stone-300 leading-6">
					Create at least one provider profile before browsing objects. The app
					stores credentials only in the browser and uses direct S3 API
					requests.
				</p>
				<Link className="button-primary mt-6 inline-flex" to="/providers">
					Open providers
				</Link>
			</section>
		);
	}

	return (
		<div className="space-y-6">
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
			<section className="control-panel px-4 py-4 lg:px-5 lg:py-5">
				<div className="space-y-4">
					<div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
						<div>
							<div className="section-label">Object browser</div>
							<h2 className="mt-1 font-display text-2xl text-stone-100 uppercase tracking-[0.14em]">
								Bucket navigation
							</h2>
							<p className="mt-2 max-w-3xl text-sm text-stone-400 leading-6">
								Compact controls, direct file viewing, and replace-in-place for
								existing keys.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
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

					<div className="compact-toolbar">
						<label className="field">
							<span>Provider</span>
							<select
								className="select"
								onChange={(event) => {
									const nextProviderId = event.target.value;
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
								value={provider?.id ?? ""}
							>
								{providers.map((entry) => (
									<option key={entry.id} value={entry.id}>
										{entry.name}
									</option>
								))}
							</select>
						</label>

						<label className="field">
							<span>Bucket</span>
							<div className="flex gap-2">
								<input
									className="input"
									list="bucket-suggestions"
									onChange={(event) => setBucketInput(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											applyBucketInput();
										}
									}}
									placeholder="Enter bucket name"
									value={bucketInput}
								/>
								<datalist id="bucket-suggestions">
									{(bucketsQuery.data ?? []).map((entry) => (
										<option key={entry} value={entry} />
									))}
								</datalist>
								<button
									className="button-secondary whitespace-nowrap"
									onClick={applyBucketInput}
									type="button"
								>
									Open
								</button>
							</div>
						</label>

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

					<div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
						<div className="text-[11px] text-stone-500 uppercase tracking-[0.24em]">
							Path
						</div>
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<button
								className="crumb"
								onClick={() =>
									void navigate({
										search: (current) => ({ ...current, prefix: "" }),
									})
								}
								type="button"
							>
								{bucket ?? "root"}
							</button>
							{pathSegments.map((segment, index) => {
								const nextPrefix = `${pathSegments.slice(0, index + 1).join("/")}/`;
								return (
									<button
										className="crumb"
										key={nextPrefix}
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
								);
							})}
						</div>
						{bucketsQuery.data?.length ? null : (
							<div className="mt-3 text-stone-500 text-xs leading-5">
								Bucket suggestions may be empty when the provider blocks
								browser-based account listing. Manual bucket entry still works.
							</div>
						)}
					</div>
				</div>
			</section>

			<div className="space-y-4">
				<section className="control-panel px-4 py-4 lg:px-5 lg:py-5">
					<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<div className="status-banner">{statusMessage}</div>
						<div className="flex flex-wrap gap-2">
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
								Upload
							</label>
							<button
								className="button-secondary"
								onClick={() => {
									const nextFolder = window.prompt("Folder name");
									if (!(nextFolder && provider && bucket)) {
										return;
									}
									void createFolder(
										provider,
										bucket,
										`${search.prefix}${nextFolder}/`,
									)
										.then(async () => {
											setStatusMessage(`Created folder ${nextFolder}.`);
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
								}}
								type="button"
							>
								New folder
							</button>
							<button
								className="button-danger"
								disabled={!selectedKeys.length}
								onClick={() => {
									if (!selectedKeys.length) {
										return;
									}
									if (
										window.confirm(
											`Delete ${selectedKeys.length} selected item${selectedKeys.length > 1 ? "s" : ""}?`,
										)
									) {
										deleteMutation.mutate(selectedKeys);
									}
								}}
								type="button"
							>
								Delete
							</button>
						</div>
					</div>

					<div className="mt-3 flex flex-wrap gap-2 text-stone-500 text-xs">
						<span className="pill">{objects.length} visible</span>
						<span className="pill">{selectedKeys.length} selected</span>
						<span className="pill">
							{runningTransfers.length} transfers active
						</span>
						{queueSnapshot[0] ? (
							<span className="pill">Latest: {queueSnapshot[0].fileName}</span>
						) : null}
						<span className="pill">
							Replace uploads write to the existing key
						</span>
						<span className="pill">
							View only appears for text, image, and video files
						</span>
					</div>

					{/* biome-ignore lint/a11y/noStaticElementInteractions: this section is a drag-and-drop target for file uploads, not a click target */}
					<section
						className={cn(
							"file-dropzone mt-4",
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
									<div className="mt-2 font-display text-2xl text-stone-100 uppercase tracking-[0.14em]">
										Release to send into {bucket ?? "current bucket"}
									</div>
									<div className="mt-2 text-sm text-stone-300 leading-6">
										Files will upload into the current prefix:
										<span className="ml-2 text-amber-200">
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
											const nextName = window.prompt(
												"Rename object",
												item.name,
											);
											if (
												!(
													nextName &&
													bucket &&
													provider &&
													item.kind === "file"
												)
											) {
												return;
											}
											renameMutation.mutate({
												fromKey: item.key,
												toKey: `${search.prefix}${nextName}`,
											});
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
							<div className="table-list">
								<div className="table-header">
									<div className="pr-2">Name</div>
									<div>Size</div>
									<div>Updated</div>
									<div className="text-right">Actions</div>
								</div>
								<div className="max-h-[720px] overflow-auto" ref={parentRef}>
									<div
										className="relative"
										style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
									>
										{rowVirtualizer.getVirtualItems().map((virtualItem) => {
											const item = objects[virtualItem.index];
											return (
												<div
													className="table-row"
													key={item.key}
													style={{
														height: `${virtualItem.size}px`,
														transform: `translateY(${virtualItem.start}px)`,
													}}
												>
													<div className="flex items-center gap-3 pr-3">
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
														<button
															className="table-name"
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
															<span>{item.name}</span>
														</button>
													</div>
													<div className="text-sm text-stone-300">
														{item.kind === "folder"
															? "Folder"
															: formatBytes(item.size)}
													</div>
													<div className="text-sm text-stone-400">
														{formatTimestamp(item.lastModified)}
													</div>
													<div className="table-actions">
														{item.kind === "folder" ? (
															<button
																className="button-quiet"
																onClick={() =>
																	void navigate({
																		search: (current) => ({
																			...current,
																			prefix: item.key,
																		}),
																	})
																}
																type="button"
															>
																Open
															</button>
														) : (
															<>
																{item.isPreviewable ? (
																	<button
																		className="button-quiet"
																		onClick={() => previewMutation.mutate(item)}
																		type="button"
																	>
																		View
																	</button>
																) : null}
																<button
																	className="button-quiet"
																	onClick={() => downloadMutation.mutate(item)}
																	type="button"
																>
																	Download
																</button>
																<button
																	className="button-quiet"
																	onClick={() => {
																		const nextName = window.prompt(
																			"Rename object",
																			item.name,
																		);
																		if (!(nextName && provider && bucket)) {
																			return;
																		}
																		renameMutation.mutate({
																			fromKey: item.key,
																			toKey: `${search.prefix}${nextName}`,
																		});
																	}}
																	type="button"
																>
																	Rename
																</button>
																<button
																	className="button-quiet"
																	onClick={() => openReplacePicker(item)}
																	type="button"
																>
																	Replace
																</button>
															</>
														)}
														<button
															className="button-quiet button-quiet-danger"
															onClick={() => deleteMutation.mutate([item.key])}
															type="button"
														>
															Delete
														</button>
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
			</div>

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
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
					<div className="max-h-[90vh] max-w-[90vw] rounded-[34px] border border-white/12 bg-[#120d08] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
						<div className="mb-4 flex items-center justify-between gap-4">
							<div>
								<div className="section-label">Preview</div>
								<div className="mt-2 font-display text-2xl text-stone-100 uppercase tracking-[0.14em]">
									{preview.fileName}
								</div>
							</div>
							<button
								className="button-secondary"
								onClick={() => {
									URL.revokeObjectURL(preview.blobUrl);
									setPreview(null);
									setTextPreview(null);
								}}
								type="button"
							>
								Close
							</button>
						</div>
						{previewRenderer(preview, textPreview)}
					</div>
				</div>
			) : null}
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
					className="line-clamp-2 text-left font-display text-stone-100 text-xl uppercase tracking-[0.1em]"
					onClick={
						item.kind === "folder" ? props.onOpenFolder : props.onPreview
					}
					type="button"
				>
					{item.name}
				</button>
				<div className="mt-2 text-sm text-stone-400">
					{item.kind === "folder"
						? "Folder marker / prefix"
						: `${formatBytes(item.size)} • ${formatTimestamp(item.lastModified)}`}
				</div>
			</div>
			<div className="mt-4 flex flex-wrap gap-2">
				{item.kind === "folder" ? (
					<button
						className="button-secondary"
						onClick={props.onOpenFolder}
						type="button"
					>
						Open
					</button>
				) : (
					<>
						{item.isPreviewable ? (
							<button
								className="button-quiet"
								onClick={props.onPreview}
								type="button"
							>
								View
							</button>
						) : null}
						<button
							className="button-quiet"
							onClick={props.onDownload}
							type="button"
						>
							Download
						</button>
						<button
							className="button-quiet"
							onClick={props.onRename}
							type="button"
						>
							Rename
						</button>
						<button
							className="button-quiet"
							onClick={props.onReplace}
							type="button"
						>
							Replace
						</button>
						<button
							className="button-quiet"
							onClick={props.onShare}
							type="button"
						>
							Copy URL
						</button>
					</>
				)}
				<button
					className="button-quiet button-quiet-danger"
					onClick={props.onDelete}
					type="button"
				>
					Delete
				</button>
			</div>
		</div>
	);
}
