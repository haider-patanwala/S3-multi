import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
	defaultBucket: string;
	forcePathStyle: boolean;
	createdAt?: number;
};

const blankForm: FormState = {
	name: "",
	type: "aws",
	endpoint: "",
	region: "us-east-1",
	accessKeyId: "",
	secretAccessKey: "",
	defaultBucket: "",
	forcePathStyle: false,
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
		defaultBucket: provider.defaultBucket ?? "",
		forcePathStyle: provider.forcePathStyle ?? false,
		createdAt: provider.createdAt,
	};
}

function toDraft(form: FormState): ProviderDraft {
	return {
		id: form.id ?? crypto.randomUUID(),
		name: form.name,
		type: form.type,
		endpoint: form.endpoint || undefined,
		region: form.region || undefined,
		accessKeyId: form.accessKeyId,
		secretAccessKey: form.secretAccessKey,
		defaultBucket: form.defaultBucket || undefined,
		forcePathStyle: form.forcePathStyle,
		createdAt: form.createdAt,
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
	const [notice, setNotice] = useState<string>(
		"Add a provider, test the connection, then save it locally.",
	);

	useEffect(() => {
		if (!selectedId && providers[0]) {
			setSelectedId(providers[0].id);
		}
	}, [providers, selectedId]);

	useEffect(() => {
		const selected = providers.find((provider) => provider.id === selectedId);
		setForm(toForm(selected));
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
			setNotice(`Stored ${saved.name} with encrypted credentials.`);
			setSelectedId(saved.id);
			await queryClient.invalidateQueries({ queryKey: ["providers"] });
			await queryClient.invalidateQueries({
				queryKey: ["providers", "active"],
			});
		},
		onError: (error) => {
			setNotice(
				error instanceof Error ? error.message : "Provider save failed.",
			);
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
			setNotice(result.message);
		},
		onError: (error) => {
			setNotice(
				error instanceof Error
					? error.message.replace(form.secretAccessKey, "[redacted]")
					: "Connection test failed.",
			);
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
			setNotice(
				activeProvider
					? `${activeProvider.name} is now the active provider.`
					: "Active provider updated.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (providerId: string) => {
			await removeProvider(providerId);
		},
		onSuccess: async () => {
			setSelectedId(undefined);
			setForm(blankForm);
			setNotice("Provider removed from the local vault.");
			await queryClient.invalidateQueries({ queryKey: ["providers"] });
			await queryClient.invalidateQueries({
				queryKey: ["providers", "active"],
			});
		},
	});

	const profileStats = useMemo(
		() => [
			{
				label: "Vault entries",
				value: providers.length,
				subtle: "Stored locally in IndexedDB",
			},
			{
				label: "Active",
				value:
					providers.find(
						(provider) => provider.id === activeProviderIdQuery.data,
					)?.name ?? "None",
				subtle: "Used as the browse default",
			},
		],
		[providers, activeProviderIdQuery.data],
	);

	return (
		<div className="space-y-6">
			<section className="control-panel page-header px-5 py-5 lg:px-6 lg:py-6">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<div className="section-label">Providers</div>
						<h2 className="page-title mt-2">Local credential vault</h2>
						<p className="page-copy mt-3 max-w-3xl">
							Create AWS S3, Cloudflare R2, or custom S3 profiles. Secrets are
							encrypted before being written to IndexedDB, and they never leave
							the browser.
						</p>
					</div>
					<div className="page-stat-grid">
						{profileStats.map((stat) => (
							<div className="metric-card" key={stat.label}>
								<div className="metric-label">{stat.label}</div>
								<div className="metric-value text-2xl">{stat.value}</div>
								<div className="metric-subtle">{stat.subtle}</div>
							</div>
						))}
					</div>
				</div>
			</section>

			<div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
				<section className="control-panel px-5 py-5">
					<div className="panel-header">
						<div className="section-label">Stored profiles</div>
						<button
							className="button-secondary"
							onClick={() => {
								setSelectedId(undefined);
								setForm(blankForm);
								setNotice("Compose a new provider profile.");
							}}
							type="button"
						>
							New provider
						</button>
					</div>
					<div className="stack-list mt-4">
						{providers.length ? (
							providers.map((provider) => {
								const active = provider.id === activeProviderIdQuery.data;
								const selected = provider.id === selectedId;
								return (
									<button
										className={cn(
											"provider-card",
											selected && "provider-card-active",
										)}
										key={provider.id}
										onClick={() => setSelectedId(provider.id)}
										type="button"
									>
										<div className="flex items-start justify-between gap-3">
											<div>
												<div className="provider-card-title">
													{provider.name}
												</div>
												<div className="provider-card-type">
													{shortProviderLabel(provider.type)}
												</div>
											</div>
											{active ? (
												<span className="pill pill-active">Active</span>
											) : null}
										</div>
										<div className="provider-card-note">
											{provider.defaultBucket
												? `Pinned bucket: ${provider.defaultBucket}`
												: "Bucket picked from browser context"}
										</div>
										<div className="provider-card-actions">
											<button
												className="button-secondary"
												onClick={(event) => {
													event.stopPropagation();
													activateMutation.mutate(provider.id);
												}}
												type="button"
											>
												Use now
											</button>
											<button
												className="button-danger"
												onClick={(event) => {
													event.stopPropagation();
													if (
														window.confirm(
															`Delete ${provider.name} from the local vault?`,
														)
													) {
														deleteMutation.mutate(provider.id);
													}
												}}
												type="button"
											>
												Delete
											</button>
										</div>
									</button>
								);
							})
						) : (
							<div className="empty-state">
								No providers saved yet. Fill the form to create the first one.
							</div>
						)}
					</div>
				</section>

				<section className="control-panel px-5 py-5 lg:px-6">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
						<div>
							<div className="section-label">Edit profile</div>
							<h3 className="page-subtitle mt-2">
								{form.id ? "Update provider" : "Create provider"}
							</h3>
						</div>
						<div className="status-banner max-w-xl">{notice}</div>
					</div>

					<div className="form-grid mt-6">
						<label className="field">
							<span>Name</span>
							<input
								className="input"
								onChange={(event) =>
									setForm((current) => ({
										...current,
										name: event.target.value,
									}))
								}
								placeholder="R2 production vault"
								value={form.name}
							/>
						</label>
						<label className="field">
							<span>Provider type</span>
							<select
								className="select"
								onChange={(event) =>
									setForm((current) => ({
										...current,
										type: event.target.value as ProviderType,
										region:
											event.target.value === "aws"
												? current.region || "us-east-1"
												: event.target.value === "r2"
													? "auto"
													: current.region,
									}))
								}
								value={form.type}
							>
								<option value="aws">AWS S3</option>
								<option value="r2">Cloudflare R2</option>
								<option value="custom">Custom S3</option>
							</select>
						</label>
						<label className="field">
							<span>Access key ID</span>
							<input
								autoComplete="off"
								className="input"
								onChange={(event) =>
									setForm((current) => ({
										...current,
										accessKeyId: event.target.value,
									}))
								}
								placeholder="AKIA..."
								value={form.accessKeyId}
							/>
						</label>
						<label className="field">
							<span>Secret access key</span>
							<input
								autoComplete="off"
								className="input"
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
						</label>
						<label className="field">
							<span>Region</span>
							<input
								className="input"
								onChange={(event) =>
									setForm((current) => ({
										...current,
										region: event.target.value,
									}))
								}
								placeholder={form.type === "aws" ? "us-east-1" : "auto"}
								value={form.region}
							/>
						</label>
						<label className="field">
							<span>Endpoint</span>
							<input
								className="input"
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
						</label>
						<label className="field">
							<span>Default bucket</span>
							<input
								className="input"
								onChange={(event) =>
									setForm((current) => ({
										...current,
										defaultBucket: event.target.value,
									}))
								}
								placeholder="Optional pinned bucket"
								value={form.defaultBucket}
							/>
							<span className="field-note">
								Recommended for R2 and browser-only setups. It lets the app test
								the connection with `HeadBucket` instead of relying on bucket
								listing.
							</span>
						</label>
						<label className="field">
							<span>Path style</span>
							<div className="toggle-row">
								<button
									aria-pressed={form.forcePathStyle}
									className={cn(
										"toggle-button",
										form.forcePathStyle && "toggle-button-active",
									)}
									onClick={() =>
										setForm((current) => ({
											...current,
											forcePathStyle: !current.forcePathStyle,
										}))
									}
									type="button"
								>
									{form.forcePathStyle ? "Enabled" : "Disabled"}
								</button>
								<span className="field-note">
									R2 uses path-style internally. This toggle is mainly for
									custom S3 endpoints such as MinIO.
								</span>
							</div>
						</label>
					</div>

					<div className="form-actions mt-6">
						<button
							className="button-primary"
							disabled={saveMutation.isPending}
							onClick={() => saveMutation.mutate()}
							type="button"
						>
							{saveMutation.isPending ? "Saving..." : "Save provider"}
						</button>
						<button
							className="button-secondary"
							disabled={testMutation.isPending}
							onClick={() => testMutation.mutate()}
							type="button"
						>
							{testMutation.isPending ? "Testing..." : "Test connection"}
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
