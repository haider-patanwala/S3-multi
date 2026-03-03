import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, Link } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { AppShell } from "../components/app-shell";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	component: RootComponent,
	notFoundComponent: () => {
		return (
			<div className="mx-auto max-w-xl px-6 py-24 text-center">
				<div className="section-label">404</div>
				<p className="mt-3 font-display text-4xl text-stone-100 uppercase tracking-[0.18em]">
					Route offline
				</p>
				<p className="mt-4 text-sm text-stone-400 leading-6">
					The requested control surface does not exist.
				</p>
				<Link className="button-primary mt-6 inline-flex" to="/browse">
					Return to browser
				</Link>
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
