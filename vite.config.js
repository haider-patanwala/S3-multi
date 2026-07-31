import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		tailwindcss(),
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		react(),
	],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	/*
	 * Assets are referenced from the domain root. Hosting the bundle under a
	 * path prefix (a bucket subfolder, `/app/`) needs this set to that prefix —
	 * relative "./" breaks instead, because a deep client route like /browse is
	 * served index.html and would resolve assets against /browse/.
	 */
	base: "/",
	build: {
		/*
		 * Honest floor. Vite's default (`baseline-widely-available`) claims
		 * Chrome 107 / Firefox 104, but the stylesheet uses oklch() everywhere
		 * (Chrome 111, FF 113) and the UI kit uses :has(), @container and
		 * @property (FF 128). Transpiling JS for engines that cannot render the
		 * colours produces a working bundle that looks broken — better to state
		 * the real requirement in one place. See docs/12-deployment.md.
		 */
		target: ["chrome111", "edge111", "firefox128", "safari16.4"],
	},
});
