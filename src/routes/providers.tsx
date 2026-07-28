import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CACHE_PRESETS } from "../lib/cache-control";
import {
	getActiveProviderId,
	removeProvider,
	saveProvider,
	setActiveProviderId,
} from "../lib/providers";
import {
	activeProviderQueryOptions,
	providerQueryOptions,
} from "../lib/query-options";
import { testConnection } from "../lib/s3";
import type { ProviderConfig, ProviderDraft, ProviderType } from "../lib/types";
import { cn, shortProviderLabel } from "../lib/utils";

export const Route = createFileRoute("/providers")({
	component: ProvidersPage,
});

type FormState = {
	id?: string;
	name: string;
	type: ProviderType;
	endpoint: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	buckets: string[];
	defaultBucket: string;
	forcePathStyle: boolean;
	defaultCacheControl: string;
	createdAt?: number;
	/**
	 * CDN/purge settings live in the browser's Purge dialog, not on this form.
	 * They are carried through here so saving a provider does not wipe them.
	 */
	cdn: Pick<
		ProviderConfig,
		| "cloudFrontDistributionId"
		| "cloudflareZoneId"
		| "cloudflareApiToken"
		| "publicBaseUrl"
	>;
};

const blankForm: FormState = {
	name: "",
	type: "aws",
	endpoint: "",
	region: "us-east-1",
	accessKeyId: "",
	secretAccessKey: "",
	buckets: [],
	defaultBucket: "",
	forcePathStyle: false,
	defaultCacheControl: "",
	cdn: {},
};

function toForm(provider?: ProviderConfig): FormState {
	if (!provider) {
		return blankForm;
	}
	return {
		id: provider.id,
		name: provider.name,
		type: provider.type,
		endpoint: provider.endpoint ?? "",
		region: provider.region ?? "",
		accessKeyId: provider.accessKeyId,
		secretAccessKey: provider.secretAccessKey,
		buckets: provider.buckets ?? [],
		defaultBucket: provider.defaultBucket ?? "",
		forcePathStyle: provider.forcePathStyle ?? false,
		defaultCacheControl: provider.defaultCacheControl ?? "",
		createdAt: provider.createdAt,
		cdn: {
			cloudFrontDistributionId: provider.cloudFrontDistributionId,
			cloudflareZoneId: provider.cloudflareZoneId,
			cloudflareApiToken: provider.cloudflareApiToken,
			publicBaseUrl: provider.publicBaseUrl,
		},
	};
}

function toDraft(form: FormState): ProviderDraft {
	const buckets = form.buckets.filter(Boolean);
	const defaultBucket = form.defaultBucket || buckets[0] || undefined;
	return {
		id: form.id ?? crypto.randomUUID(),
		name: form.name,
		type: form.type,
		endpoint: form.endpoint || undefined,
		region: form.region || undefined,
		accessKeyId: form.accessKeyId,
		secretAccessKey: form.secretAccessKey,
		buckets: buckets.length ? buckets : undefined,
		defaultBucket,
		forcePathStyle: form.forcePathStyle,
		defaultCacheControl: form.defaultCacheControl.trim() || undefined,
		createdAt: form.createdAt,
		...form.cdn,
	};
}

function validateForm(form: FormState) {
	if (!form.name.trim()) {
		return "Name is required.";
	}
	if (!form.accessKeyId.trim() || !form.secretAccessKey.trim()) {
		return "Access key and secret key are required.";
	}
	if (form.type === "aws" && !form.region.trim()) {
		return "AWS providers need a region.";
	}
	if ((form.type === "r2" || form.type === "custom") && !form.endpoint.trim()) {
		return "R2 and custom providers need an endpoint.";
	}
	return undefined;
}

function ProvidersPage() {
	const queryClient = useQueryClient();
	const providersQuery = useQuery(providerQueryOptions);
	const activeProviderIdQuery = useQuery(activeProviderQueryOptions);
	const providers = providersQuery.data ?? [];
	const [selectedId, setSelectedId] = useState<string>();
	const [form, setForm] = useState<FormState>(blankForm);
	const [bucketInput, setBucketInput] = useState("");
	const [notice, setNotice] = useState<{ text: string; error?: boolean }>({
		text: "Add a provider, test the connection, then save it locally.",
	});
	const [pendingDelete, setPendingDelete] = useState<ProviderConfig>();

	useEffect(() => {
		if (!selectedId && providers[0]) {
			setSelectedId(providers[0].id);
		}
	}, [providers, selectedId]);

	useEffect(() => {
		const selected = providers.find((provider) => provider.id === selectedId);
		setForm(toForm(selected));
		setBucketInput("");
	}, [providers, selectedId]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const error = validateForm(form);
			if (error) {
				throw new Error(error);
			}
			const saved = await saveProvider(toDraft(form));
			return saved;
		},
		onSuccess: async (saved) => {
			setNotice({ text: `Stored ${saved.name} with encrypted credentials.` });
			setSelectedId(saved.id);
			await queryClient.invalidateQueries({ queryKey: ["providers"] });
			await queryClient.invalidateQueries({
				queryKey: ["providers", "active"],
			});
		},
		onError: (error) => {
			setNotice({
				text: error instanceof Error ? error.message : "Provider save failed.",
				error: true,
			});
		},
	});

	const testMutation = useMutation({
		mutationFn: async () => {
			const error = validateForm(form);
			if (error) {
				throw new Error(error);
			}
			return testConnection(toDraft(form) as ProviderConfig);
		},
		onSuccess: (result) => {
			setNotice({ text: result.message });
		},
		onError: (error) => {
			setNotice({
				text:
					error instanceof Error
						? error.message.replace(form.secretAccessKey, "[redacted]")
						: "Connection test failed.",
				error: true,
			});
		},
	});

	const activateMutation = useMutation({
		mutationFn: (providerId: string) => setActiveProviderId(providerId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["providers", "active"],
			});
			const activeId = await getActiveProviderId();
			const activeProvider = providers.find(
				(provider) => provider.id === activeId,
			);
			setNotice({
				text: activeProvider
					? `${activeProvider.name} is now the active provider.`
					: "Active provider updated.",
			});
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (providerId: string) => {
			await removeProvider(providerId);
		},
		onSuccess: async () => {
			setSelectedId(undefined);
			setForm(blankForm);
			setNotice({ text: "Provider removed from the local vault." });
			await queryClient.invalidateQueries({ queryKey: ["providers"] });
			await queryClient.invalidateQueries({
				queryKey: ["providers", "active"],
			});
		},
	});

	const activeProviderName = useMemo(
		() =>
			providers.find((provider) => provider.id === activeProviderIdQuery.data)
				?.name ?? "None",
		[providers, activeProviderIdQuery.data],
	);

	const addBucket = () => {
		const name = bucketInput.trim();
		if (!name || form.buckets.includes(name)) {
			return;
		}
		setForm((current) => ({
			...current,
			buckets: [...current.buckets, name],
			defaultBucket: current.defaultBucket || name,
		}));
		setBucketInput("");
	};

	return (
		<div className="space-y-4">
			<Card>
				<CardContent className="flex flex-wrap items-center gap-5">
					<span className="flex items-baseline gap-1.5 text-muted-foreground text-sm">
						<span className="font-semibold text-foreground text-lg tabular-nums">
							{providers.length}
						</span>
						{providers.length === 1 ? "profile" : "profiles"}
					</span>
					<span className="flex items-center gap-2 text-muted-foreground text-sm">
						active
						<Badge
							variant={activeProviderName === "None" ? "outline" : "default"}
						>
							{activeProviderName}
						</Badge>
					</span>
				</CardContent>
			</Card>

			<div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
				<Card>
					<CardHeader className="flex-row items-center justify-between gap-2">
						<CardTitle>Stored profiles</CardTitle>
						<Button
							onClick={() => {
								setSelectedId(undefined);
								setForm(blankForm);
								setNotice({ text: "Compose a new provider profile." });
							}}
							size="sm"
							type="button"
							variant="outline"
						>
							New provider
						</Button>
					</CardHeader>
					<CardContent className="space-y-2">
						{providers.length ? (
							providers.map((provider) => {
								const active = provider.id === activeProviderIdQuery.data;
								const selected = provider.id === selectedId;
								return (
									// biome-ignore lint/a11y/useKeyWithClickEvents: the inner buttons carry the actions; this outer surface is a pointer affordance around them
									// biome-ignore lint/a11y/noStaticElementInteractions: a <button> here would nest the action buttons below
									<div
										className={cn(
											"w-full cursor-pointer rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
											selected && "border-primary/40 bg-muted",
										)}
										key={provider.id}
										onClick={() => setSelectedId(provider.id)}
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<div className="truncate font-medium text-sm">
													{provider.name}
												</div>
												<div className="text-muted-foreground text-xs">
													{shortProviderLabel(provider.type)}
												</div>
											</div>
											{active ? <Badge>Active</Badge> : null}
										</div>
										<div className="mt-2 text-muted-foreground text-xs">
											{provider.buckets?.length
												? `${provider.buckets.length} bucket${provider.buckets.length > 1 ? "s" : ""}${provider.defaultBucket ? ` · default: ${provider.defaultBucket}` : ""}`
												: provider.defaultBucket
													? `Pinned bucket: ${provider.defaultBucket}`
													: "Bucket picked from browser context"}
										</div>
										<div className="mt-3 flex gap-2">
											<Button
												onClick={(event) => {
													event.stopPropagation();
													activateMutation.mutate(provider.id);
												}}
												size="xs"
												type="button"
												variant="outline"
											>
												Use now
											</Button>
											<Button
												onClick={(event) => {
													event.stopPropagation();
													setPendingDelete(provider);
												}}
												size="xs"
												type="button"
												variant="destructive"
											>
												Delete
											</Button>
										</div>
									</div>
								);
							})
						) : (
							<p className="py-8 text-center text-muted-foreground text-sm">
								No providers saved yet. Fill the form to create the first one.
							</p>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>
							{form.id ? "Update provider" : "Create provider"}
						</CardTitle>
						<CardDescription>
							Credentials are AES-GCM encrypted in this browser's IndexedDB.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<Alert variant={notice.error ? "destructive" : "default"}>
							<AlertDescription>{notice.text}</AlertDescription>
						</Alert>

						<FieldGroup className="@md/field-group:grid @md/field-group:grid-cols-2 @md/field-group:gap-5">
							<Field>
								<FieldLabel htmlFor="provider-name">Name</FieldLabel>
								<Input
									id="provider-name"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											name: event.target.value,
										}))
									}
									placeholder="R2 production vault"
									value={form.name}
								/>
							</Field>

							<Field>
								<FieldLabel htmlFor="provider-type">Provider type</FieldLabel>
								<Select
									onValueChange={(value) =>
										setForm((current) => ({
											...current,
											type: value as ProviderType,
											region:
												value === "aws"
													? current.region || "us-east-1"
													: value === "r2"
														? "auto"
														: current.region,
										}))
									}
									value={form.type}
								>
									<SelectTrigger className="w-full" id="provider-type">
										<SelectValue placeholder="Provider type" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="aws">AWS S3</SelectItem>
										<SelectItem value="r2">Cloudflare R2</SelectItem>
										<SelectItem value="custom">Custom S3</SelectItem>
									</SelectContent>
								</Select>
							</Field>

							<Field>
								<FieldLabel htmlFor="access-key">Access key ID</FieldLabel>
								<Input
									autoComplete="off"
									id="access-key"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											accessKeyId: event.target.value,
										}))
									}
									placeholder="AKIA..."
									value={form.accessKeyId}
								/>
							</Field>

							<Field>
								<FieldLabel htmlFor="secret-key">Secret access key</FieldLabel>
								<Input
									autoComplete="off"
									id="secret-key"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											secretAccessKey: event.target.value,
										}))
									}
									placeholder="Encrypted at rest"
									type="password"
									value={form.secretAccessKey}
								/>
								<FieldDescription>
									Never sent anywhere but your storage provider.
								</FieldDescription>
							</Field>

							<Field>
								<FieldLabel htmlFor="region">Region</FieldLabel>
								<Input
									id="region"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											region: event.target.value,
										}))
									}
									placeholder={form.type === "aws" ? "us-east-1" : "auto"}
									value={form.region}
								/>
							</Field>

							<Field>
								<FieldLabel htmlFor="endpoint">Endpoint</FieldLabel>
								<Input
									id="endpoint"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											endpoint: event.target.value,
										}))
									}
									placeholder={
										form.type === "aws"
											? "Optional override"
											: "https://<account>.r2.cloudflarestorage.com"
									}
									value={form.endpoint}
								/>
							</Field>

							<Field className="@md/field-group:col-span-2">
								<FieldLabel htmlFor="bucket-input">Buckets</FieldLabel>
								<div className="flex gap-2">
									<Input
										id="bucket-input"
										onChange={(event) => setBucketInput(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												addBucket();
											}
										}}
										placeholder="Bucket name"
										value={bucketInput}
									/>
									<Button onClick={addBucket} type="button" variant="outline">
										Add
									</Button>
								</div>
								{form.buckets.length > 0 && (
									<div className="space-y-1 rounded-lg border p-1">
										{form.buckets.map((name) => {
											const isDefault = name === form.defaultBucket;
											return (
												<div
													className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
													key={name}
												>
													<div className="flex min-w-0 items-center gap-2">
														<span className="truncate text-sm">{name}</span>
														{isDefault && <Badge>Default</Badge>}
													</div>
													<div className="flex shrink-0 gap-1">
														{!isDefault && (
															<Button
																onClick={() =>
																	setForm((current) => ({
																		...current,
																		defaultBucket: name,
																	}))
																}
																size="xs"
																type="button"
																variant="ghost"
															>
																Set default
															</Button>
														)}
														<Button
															onClick={() =>
																setForm((current) => {
																	const next = current.buckets.filter(
																		(b) => b !== name,
																	);
																	return {
																		...current,
																		buckets: next,
																		defaultBucket:
																			current.defaultBucket === name
																				? (next[0] ?? "")
																				: current.defaultBucket,
																	};
																})
															}
															size="xs"
															type="button"
															variant="destructive"
														>
															Remove
														</Button>
													</div>
												</div>
											);
										})}
									</div>
								)}
								<FieldDescription>
									Pre-define buckets for this provider. Recommended for R2 and
									custom endpoints where bucket listing may not be available.
								</FieldDescription>
							</Field>

							<Field className="@md/field-group:col-span-2">
								<FieldLabel htmlFor="cache-control">
									Default Cache-Control
								</FieldLabel>
								<ToggleGroup
									onValueChange={(value: string[]) =>
										setForm((current) => ({
											...current,
											defaultCacheControl: value[0] ?? "",
										}))
									}
									value={
										form.defaultCacheControl ? [form.defaultCacheControl] : []
									}
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
									id="cache-control"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											defaultCacheControl: event.target.value,
										}))
									}
									placeholder="public, max-age=31536000, immutable"
									value={form.defaultCacheControl}
								/>
								<FieldDescription>
									Written on every upload, and offered when saving an edit.
									Empty picks per file type — long for media, short for editable
									text.
								</FieldDescription>
							</Field>

							<Field
								className="@md/field-group:col-span-2"
								orientation="horizontal"
							>
								<Switch
									checked={form.forcePathStyle}
									id="path-style"
									onCheckedChange={(checked) =>
										setForm((current) => ({
											...current,
											forcePathStyle: checked,
										}))
									}
								/>
								<div>
									<FieldLabel htmlFor="path-style">Path style</FieldLabel>
									<FieldDescription>
										R2 uses path-style internally. This toggle is mainly for
										custom S3 endpoints such as MinIO.
									</FieldDescription>
								</div>
							</Field>
						</FieldGroup>

						<div className="flex flex-wrap gap-2">
							<Button
								disabled={saveMutation.isPending}
								onClick={() => saveMutation.mutate()}
								type="button"
							>
								{saveMutation.isPending ? "Saving..." : "Save provider"}
							</Button>
							<Button
								disabled={testMutation.isPending}
								onClick={() => testMutation.mutate()}
								type="button"
								variant="outline"
							>
								{testMutation.isPending ? "Testing..." : "Test connection"}
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>

			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						setPendingDelete(undefined);
					}
				}}
				open={!!pendingDelete}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete provider</DialogTitle>
						<DialogDescription>
							Delete {pendingDelete?.name} from the local vault? The stored
							credentials are erased from this browser. This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => setPendingDelete(undefined)}
							size="xs"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							onClick={() => {
								if (pendingDelete) {
									deleteMutation.mutate(pendingDelete.id);
								}
								setPendingDelete(undefined);
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
