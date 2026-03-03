import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	Link,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	component: RootComponent,
	notFoundComponent: () => {
		return (
			<div>
				<p>This is the notFoundComponent configured on root route</p>
				<Link to="/">Start Over</Link>
			</div>
		);
	},
});

function RootComponent() {
	return (
		<>
			<div className="flex gap-2 p-2 text-lg">
				<Link
					activeOptions={{ exact: true }}
					activeProps={{
						className: "font-bold",
					}}
					to="/"
				>
					Home
				</Link>{" "}
				<Link
					activeProps={{
						className: "font-bold",
					}}
					to="/posts"
				>
					Posts
				</Link>{" "}
				<Link
					activeProps={{
						className: "font-bold",
					}}
					// @ts-expect-error
					to="/this-route-does-not-exist"
				>
					This Route Does Not Exist
				</Link>
			</div>
			<hr />
			<Outlet />
			<ReactQueryDevtools buttonPosition="top-right" />
			<TanStackRouterDevtools position="bottom-right" />
		</>
	);
}
