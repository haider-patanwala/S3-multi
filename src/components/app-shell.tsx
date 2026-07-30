import {
	ArrowDataTransferVerticalIcon,
	CloudServerIcon,
	Folder02Icon,
	HelpCircleIcon,
	Moon02Icon,
	Sun01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import {
	activeProviderQueryOptions,
	providerQueryOptions,
	transferQueryOptions,
} from "../lib/query-options";
import { applyTheme, readTheme, type Theme } from "../lib/theme";
import { formatBytes, shortProviderLabel } from "../lib/utils";

const navItems = [
	{ to: "/browse", label: "Browser", icon: Folder02Icon },
	{ to: "/providers", label: "Providers", icon: CloudServerIcon },
	{ to: "/transfers", label: "Transfers", icon: ArrowDataTransferVerticalIcon },
	{ to: "/help", label: "Help", icon: HelpCircleIcon },
] as const;

export function AppShell() {
	const providersQuery = useQuery(providerQueryOptions);
	const activeProviderIdQuery = useQuery(activeProviderQueryOptions);
	const transfersQuery = useQuery(transferQueryOptions);
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const [theme, setTheme] = useState<Theme>(readTheme);

	const providers = providersQuery.data ?? [];
	const activeNavIndex = navItems.findIndex((item) =>
		pathname.startsWith(item.to),
	);
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

	// /edit is reached from the browser rather than the sidebar, so it has no nav
	// item to take its title from.
	const title =
		navItems.find((item) => pathname.startsWith(item.to))?.label ??
		(pathname.startsWith("/edit") ? "Editor" : "Overview");

	function toggleTheme() {
		const next: Theme = theme === "dark" ? "light" : "dark";
		setTheme(next);
		applyTheme(next);
	}

	return (
		<SidebarProvider>
			<Sidebar collapsible="icon">
				<SidebarHeader>
					<div className="flex items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:px-0">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground text-xs">
							S3
						</div>
						<div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
							<span className="truncate font-medium text-sm">S3 Multi</span>
							<span className="truncate text-muted-foreground text-xs">
								{activeProvider
									? shortProviderLabel(activeProvider.type)
									: "No provider"}
							</span>
						</div>
					</div>
				</SidebarHeader>

				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>Workspace</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu className="relative">
								{/* The active-tab pill. One element slides between rows on a
								    CSS transition with an overshoot curve (the spring); React
								    only sets the target offset. Rows are 32px tall, gap-0.
								    Hidden when collapsed to icons, where the buttons fall
								    back to their own active background. */}
								{activeNavIndex >= 0 && (
									<li
										aria-hidden
										className="pointer-events-none absolute top-0 left-0 h-8 w-full rounded-md bg-card shadow-sm ring-1 ring-foreground/10 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-data-[collapsible=icon]:hidden dark:bg-sidebar-accent dark:shadow-none dark:ring-0"
										style={{
											transform: `translateY(${activeNavIndex * 32}px)`,
										}}
									/>
								)}
								{navItems.map((item) => (
									<SidebarMenuItem key={item.to}>
										<SidebarMenuButton
											className="relative z-10 transition-all duration-200 hover:translate-x-0.5 data-active:bg-transparent data-active:hover:translate-x-0 group-data-[collapsible=icon]:data-active:bg-sidebar-accent"
											isActive={pathname.startsWith(item.to)}
											render={<Link to={item.to} />}
											tooltip={item.label}
										>
											<HugeiconsIcon
												icon={item.icon}
												size={16}
												strokeWidth={1.5}
											/>
											<span>{item.label}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>

				<SidebarFooter className="group-data-[collapsible=icon]:hidden">
					<div className="rounded-lg border bg-card p-2.5 shadow-xs">
						<div className="text-muted-foreground text-xs">Active provider</div>
						<div className="mt-0.5 truncate font-medium text-sm">
							{activeProvider?.name ?? "None selected"}
						</div>
					</div>
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>

			<SidebarInset className="min-w-0">
				{/* Sticky glass bar: content scrolls under it, the blur + hairline
				    shadow keep it reading as its own layer above the canvas. */}
				<header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 shadow-2xs backdrop-blur-md">
					<SidebarTrigger />
					<Separator className="mr-1 h-4" orientation="vertical" />
					<h2 className="font-semibold text-[15px] tracking-tight">{title}</h2>

					<div className="ml-auto flex items-center gap-2">
						{runningTransfers > 0 && (
							<Badge variant="secondary">
								{runningTransfers} active · {formatBytes(queuedBytes)}
							</Badge>
						)}
						<Button
							onClick={toggleTheme}
							size="icon-sm"
							title={theme === "dark" ? "Switch to light" : "Switch to dark"}
							type="button"
							variant="ghost"
						>
							<HugeiconsIcon
								icon={theme === "dark" ? Sun01Icon : Moon02Icon}
								size={16}
								strokeWidth={1.5}
							/>
						</Button>
					</div>
				</header>

				<main className="min-w-0 flex-1 px-6 py-5">
					<Outlet />
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
