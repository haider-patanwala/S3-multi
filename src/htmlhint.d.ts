/**
 * htmlhint ships no type declarations and there is no `@types/htmlhint`.
 * `src/lib/richtext.ts` uses exactly one function and four message fields, so
 * this declares that surface rather than adding a dependency for it.
 *
 * The module is CJS with no `exports` map, so it is reachable as a named export
 * (Vite's interop) or under `default` (node's ESM loader). Both are declared —
 * see `lintHtml`, which has to run in the browser and under `node *.check.ts`.
 */
declare module "htmlhint" {
	export type HtmlHintMessage = {
		message: string;
		line: number;
		col: number;
		raw?: string;
	};

	export const HTMLHint: {
		verify(html: string, rules: Record<string, boolean>): HtmlHintMessage[];
	};

	const _default: { HTMLHint: typeof HTMLHint };
	export default _default;
}
