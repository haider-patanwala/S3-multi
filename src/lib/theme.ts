export type Theme = "dark" | "light";

const STORAGE_KEY = "s3m-theme";

export function readTheme(): Theme {
	return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

/**
 * Called once at module load in main.tsx (before React renders) so the page
 * never paints the wrong theme first, and again on every toggle.
 */
export function applyTheme(theme: Theme) {
	document.documentElement.dataset.theme = theme;
	localStorage.setItem(STORAGE_KEY, theme);
}
