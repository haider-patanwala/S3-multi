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
							<SidebarMenu>
								{navItems.map((item) => (
									<SidebarMenuItem key={item.to}>
										<SidebarMenuButton
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
					<div className="rounded-md border p-2">
						<div className="text-muted-foreground text-xs">Active provider</div>
						<div className="mt-1 truncate font-medium text-sm">
							{activeProvider?.name ?? "None selected"}
						</div>
					</div>
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>

			<SidebarInset className="min-w-0">
				<header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
					<SidebarTrigger />
					<Separator className="mr-1 h-4" orientation="vertical" />
					<h2 className="font-semibold text-base">{title}</h2>

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

				<main className="min-w-0 flex-1 p-4">
					<Outlet />
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
