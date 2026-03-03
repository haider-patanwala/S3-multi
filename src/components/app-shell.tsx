import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
	activeProviderQueryOptions,
	providerQueryOptions,
	transferQueryOptions,
} from "../lib/query-options";
import { cn, formatBytes, shortProviderLabel } from "../lib/utils";

const navItems = [
	{
		to: "/browse",
		label: "Browser",
		blurb: "Inspect buckets and operate on objects",
	},
	{
		to: "/providers",
		label: "Providers",
		blurb: "Store encrypted S3 credentials locally",
	},
	{
		to: "/transfers",
		label: "Transfers",
		blurb: "Watch uploads, downloads, and retries",
	},
] as const;

export function AppShell() {
	const providersQuery = useQuery(providerQueryOptions);
	const activeProviderIdQuery = useQuery(activeProviderQueryOptions);
	const transfersQuery = useQuery(transferQueryOptions);
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	const providers = providersQuery.data ?? [];
	const activeProvider = providers.find(
		(provider) => provider.id === activeProviderIdQuery.data,
	);
	const transfers = transfersQuery.data ?? [];
	const runningTransfers = transfers.filter(
		(transfer) => transfer.status === "running",
	).length;
	const queuedBytes = transfers.reduce(
		(total, transfer) => total + (transfer.totalBytes ?? 0),
		0,
	);

	return (
		<div className="min-h-screen overflow-x-hidden">
			<div className="app-shell mx-auto max-w-[1780px] px-3 py-3 sm:px-5 lg:px-6">
				<header className="control-panel mb-4 overflow-hidden">
					<div className="absolute inset-y-0 right-0 hidden w-56 bg-[radial-gradient(circle_at_center,rgba(255,157,61,0.18),transparent_70%)] lg:block" />
					<div className="relative grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-5 lg:py-4">
						<div className="space-y-3">
							<div className="eyebrow">Client-side control room</div>
							<div className="max-w-3xl">
								<h1 className="font-display text-3xl text-stone-50 uppercase tracking-[0.18em] sm:text-[2.2rem]">
									S3 Multi
								</h1>
								<p className="mt-1 max-w-3xl text-[0.82rem] text-stone-400 leading-5">
									Encrypted browser-native storage for S3, R2, and custom
									endpoints.
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								{navItems.map((item) => (
									<Link
										key={item.to}
										className={cn(
											"nav-chip min-w-[140px]",
											pathname.startsWith(item.to) && "nav-chip-active",
										)}
										to={item.to}
									>
										<span className="font-display text-base uppercase tracking-[0.16em]">
											{item.label}
										</span>
										<span className="text-stone-400 text-xs">{item.blurb}</span>
									</Link>
								))}
							</div>
						</div>

						<div className="header-meta">
							<div className="header-stat">
								<span className="metric-label">Provider</span>
								<span className="header-stat-value">
									{activeProvider?.name ?? "None"}
								</span>
								<span className="header-stat-note">
									{activeProvider
										? shortProviderLabel(activeProvider.type)
										: "No active selection"}
								</span>
							</div>
							<div className="header-stat">
								<span className="metric-label">Transfers</span>
								<span className="header-stat-value">{runningTransfers}</span>
								<span className="header-stat-note">
									{formatBytes(queuedBytes)} queued
								</span>
							</div>
							<div className="header-stat">
								<span className="metric-label">Vault</span>
								<span className="header-stat-value">{providers.length}</span>
								<span className="header-stat-note">HTTPS only</span>
							</div>
						</div>
					</div>
				</header>

				<section className="min-w-0">
					<Outlet />
				</section>
			</div>
		</div>
	);
}
