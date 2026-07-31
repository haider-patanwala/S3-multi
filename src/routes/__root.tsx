import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, Link } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { AppShell } from "../components/app-shell";
import { Button } from "../components/ui/button";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	component: RootComponent,
	notFoundComponent: () => {
		return (
			<div className="mx-auto max-w-xl px-6 py-24 text-center">
				<div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
					404
				</div>
				<p className="mt-3 font-semibold text-xl">Route not found</p>
				<p className="mt-4 text-muted-foreground text-sm">
					The requested page does not exist.
				</p>
				<Button className="mt-6" render={<Link to="/browse" />}>
					Return to browser
				</Button>
			</div>
		);
	},
});

function RootComponent() {
	return (
		<>
			<AppShell />
			{import.meta.env.VITE_NODE_ENV === "development" && (
				<>
					<ReactQueryDevtools buttonPosition="top-right" />
					<TanStackRouterDevtools position="bottom-right" />
				</>
			)}
		</>
	);
}
