import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/hp/")({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/hp"!</div>;
}
