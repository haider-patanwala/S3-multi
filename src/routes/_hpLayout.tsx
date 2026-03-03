import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_hpLayout")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<div>
			<p>Hello "/_hpLayout"!</p>
			<Outlet />
		</div>
	);
}
