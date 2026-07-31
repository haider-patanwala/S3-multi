export type Theme = "dark" | "light";

const STORAGE_KEY = "s3m-theme";

/*
 * Storage access throws, not returns null, when the browser blocks it —
 * hardened Firefox, Safari in a third-party frame, some private modes. These
 * run before React mounts (see applyTheme's note), so an uncaught SecurityError
 * here is a white screen rather than a wrong theme. Failing to the default is
 * always the right trade.
 */
export function readTheme(): Theme {
	try {
		return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
	} catch {
		return "dark";
	}
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
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Theme still applies for this session; it just will not be remembered.
	}
}
