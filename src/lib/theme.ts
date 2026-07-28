export type Theme = "dark" | "light";

const STORAGE_KEY = "s3m-theme";

export function readTheme(): Theme {
	return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

/**
 * Called once at module load in main.tsx (before React renders) so the page
 * never paints the wrong theme first, and again on every toggle.
 *
 * The `dark` class is what shadcn's `dark:` variant keys off (see the
 * `@custom-variant dark` line in styles.css). `color-scheme` follows it so the
 * native widgets the app does not own — scrollbars, form controls, the
 * canvas behind an overscroll — match.
 */
export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	root.classList.toggle("dark", theme === "dark");
	root.style.colorScheme = theme;
	localStorage.setItem(STORAGE_KEY, theme);
}
