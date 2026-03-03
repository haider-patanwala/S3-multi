import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/hp")({
	component: HpLayoutComponent,
});

function HpLayoutComponent() {
	return (
		<div>
			<p>Layout of hp route</p>
			<Outlet />
		</div>
	);
}
