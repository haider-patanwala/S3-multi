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
	},
	{
		to: "/providers",
		label: "Providers",
	},
	{
		to: "/transfers",
		label: "Transfers",
	},
	{
		to: "/help",
		label: "Help",
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
		<div className="workspace-frame min-h-screen overflow-x-hidden">
			<div className="app-shell workspace-shell mx-auto">
				<aside className="shell-sidebar">
					<div className="shell-brand">
						<div className="shell-mark">S3</div>
						<h1 className="shell-title">Multi-cloud storage dashboard</h1>
						<span className="shell-badge">
							{activeProvider
								? shortProviderLabel(activeProvider.type)
								: "No provider"}
						</span>
					</div>

					<nav className="shell-nav">
						{navItems.map((item) => (
							<Link
								key={item.to}
								className={cn(
									"nav-chip",
									pathname.startsWith(item.to) && "nav-chip-active",
								)}
								to={item.to}
							>
								<span className="nav-chip-label">{item.label}</span>
							</Link>
						))}
					</nav>

					<div className="shell-aside-note">
						<div className="metric-label">Active provider</div>
						<p>
							{activeProvider?.name ?? "None selected"}
						</p>
					</div>
				</aside>

				<div className="shell-stage min-w-0">
					<header className="overview-panel">
						<div className="overview-intro">
							<div className="eyebrow">Dashboard</div>
							<h2 className="overview-title">
								{pathname.startsWith("/browse")
									? "Object browser"
									: pathname.startsWith("/providers")
										? "Provider vault"
										: pathname.startsWith("/transfers")
											? "Transfer queue"
											: pathname.startsWith("/help")
												? "Getting started"
												: "Overview"}
							</h2>
						</div>

						<div className="header-meta overview-stats">
							<div className="header-stat">
								<span className="metric-label">Transfers</span>
								<span className="header-stat-value">{runningTransfers}</span>
								<span className="header-stat-note">Active</span>
							</div>
							<div className="header-stat">
								<span className="metric-label">Volume</span>
								<span className="header-stat-value">{formatBytes(queuedBytes)}</span>
								<span className="header-stat-note">Total tracked</span>
							</div>
							<div className="header-stat">
								<span className="metric-label">Providers</span>
								<span className="header-stat-value">{providers.length}</span>
								<span className="header-stat-note">In vault</span>
							</div>
						</div>
					</header>

					<section className="shell-main min-w-0">
						<Outlet />
					</section>
				</div>
			</div>
		</div>
	);
}
