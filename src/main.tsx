import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { applyTheme, readTheme } from "./lib/theme";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

// Before first paint, so the page never flashes the wrong theme.
applyTheme(readTheme());

const queryClient = new QueryClient();

// Set up a Router instance
const router = createRouter({
	routeTree,
	context: {
		queryClient,
	},
	defaultPreload: "intent",
	// Since we're using React Query, we don't want loader calls to ever be stale
	// This will ensure that the loader is always called when the route is preloaded or visited
	defaultPreloadStaleTime: 0,
	scrollRestoration: true,
});

// Register things for typesafety
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.getElementById("app")!;

/*
 * The credential vault is WebCrypto, and WebCrypto only exists in a secure
 * context. Served over plain HTTP — which is exactly what an S3 *website*
 * endpoint gives you — `crypto.subtle` is undefined and every provider save
 * dies with a TypeError deep in the vault. Say so up front instead: this is a
 * deployment mistake with a one-line fix, not a bug the operator can debug
 * from a stack trace. See docs/12-deployment.md.
 */
if (!(window.isSecureContext && window.crypto?.subtle)) {
	rootElement.innerHTML = `
		<div style="max-width:34rem;margin:12vh auto;padding:0 1.5rem;font:14px/1.6 system-ui,sans-serif">
			<h1 style="font-size:1.25rem;margin:0 0 .75rem">This app needs HTTPS</h1>
			<p style="margin:0 0 .75rem">
				Credentials are encrypted with the Web Crypto API, which browsers only
				expose over a secure connection. This page was loaded over
				<code>${location.protocol}</code>, so storing a provider would fail.
			</p>
			<p style="margin:0">
				Serve it over HTTPS (a CDN such as CloudFront or Cloudflare in front of
				the bucket), or open it from <code>localhost</code> for local use.
			</p>
		</div>`;
} else if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}
