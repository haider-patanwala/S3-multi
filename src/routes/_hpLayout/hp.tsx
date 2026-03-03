import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_hpLayout/hp")({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/hp"!</div>;
}
