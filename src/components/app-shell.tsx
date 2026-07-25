import {
	ArrowDataTransferVerticalIcon,
	CloudServerIcon,
	Folder02Icon,
	HelpCircleIcon,
	Moon02Icon,
	SidebarLeft01Icon,
	Sun01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
	activeProviderQueryOptions,
	providerQueryOptions,
	transferQueryOptions,
} from "../lib/query-options";
import { applyTheme, readTheme, type Theme } from "../lib/theme";
import { cn, formatBytes, shortProviderLabel } from "../lib/utils";

const navItems = [
	{ to: "/browse", label: "Browser", icon: Folder02Icon },
	{ to: "/providers", label: "Providers", icon: CloudServerIcon },
	{ to: "/transfers", label: "Transfers", icon: ArrowDataTransferVerticalIcon },
	{ to: "/help", label: "Help", icon: HelpCircleIcon },
] as const;

const pageTitles: [prefix: string, title: string][] = [
	["/browse", "Browser"],
	["/providers", "Providers"],
	["/transfers", "Transfers"],
	["/help", "Help"],
];

export function AppShell() {
	const providersQuery = useQuery(providerQueryOptions);
	const activeProviderIdQuery = useQuery(activeProviderQueryOptions);
	const transfersQuery = useQuery(transferQueryOptions);
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const [collapsed, setCollapsed] = useState(false);
	const [theme, setTheme] = useState<Theme>(readTheme);

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

	const title =
		pageTitles.find(([prefix]) => pathname.startsWith(prefix))?.[1] ??
		"Overview";

	function toggleTheme() {
		const next: Theme = theme === "dark" ? "light" : "dark";
		setTheme(next);
		applyTheme(next);
	}

	return (
		<div className="workspace-frame min-h-screen overflow-x-hidden">
			<div
				className={cn(
					"app-shell workspace-shell mx-auto",
					collapsed && "workspace-shell-collapsed",
				)}
			>
				<aside
					className={cn(
						"shell-sidebar",
						collapsed && "shell-sidebar-collapsed",
					)}
				>
					<div className="shell-brand">
						<div className="shell-brand-row">
							<div className="shell-mark">S3</div>
							{!collapsed && (
								<button
									className="sidebar-toggle"
									onClick={() => setCollapsed(true)}
									title="Collapse sidebar"
									type="button"
								>
									<HugeiconsIcon
										icon={SidebarLeft01Icon}
										size={16}
										strokeWidth={1.5}
									/>
								</button>
							)}
						</div>
						{!collapsed && (
							<span className="shell-badge">
								{activeProvider
									? shortProviderLabel(activeProvider.type)
									: "No provider"}
							</span>
						)}
					</div>

					<nav className="shell-nav">
						{navItems.map((item) => (
							<Link
								key={item.to}
								className={cn(
									"nav-chip",
									pathname.startsWith(item.to) && "nav-chip-active",
								)}
								title={collapsed ? item.label : undefined}
								to={item.to}
							>
								<HugeiconsIcon icon={item.icon} size={16} strokeWidth={1.5} />
								{!collapsed && (
									<span className="nav-chip-label">{item.label}</span>
								)}
							</Link>
						))}
					</nav>

					{!collapsed && (
						<div className="shell-aside-note">
							<div className="metric-label">Active provider</div>
							<p>{activeProvider?.name ?? "None selected"}</p>
						</div>
					)}
				</aside>

				<div className="shell-stage min-w-0">
					<header className="overview-panel">
						<div className="overview-intro">
							{collapsed && (
								<button
									className="sidebar-toggle"
									onClick={() => setCollapsed(false)}
									title="Expand sidebar"
									type="button"
								>
									<HugeiconsIcon
										icon={SidebarLeft01Icon}
										size={16}
										strokeWidth={1.5}
									/>
								</button>
							)}
							<h2 className="overview-title">{title}</h2>
						</div>

						<div className="header-meta">
							{runningTransfers > 0 && (
								<div className="header-stat">
									<span className="header-stat-value">{runningTransfers}</span>
									<span className="header-stat-note">
										active · {formatBytes(queuedBytes)}
									</span>
								</div>
							)}
							<button
								className="icon-button"
								onClick={toggleTheme}
								title={theme === "dark" ? "Switch to light" : "Switch to dark"}
								type="button"
							>
								<HugeiconsIcon
									icon={theme === "dark" ? Sun01Icon : Moon02Icon}
									size={16}
									strokeWidth={1.5}
								/>
							</button>
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
