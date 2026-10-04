import { DEFAULT_THEME_PREFERENCE, isThemePreference, resolveTheme } from "./color-theme-model";

import type { ThemePreference } from "./color-theme-model";

export const THEME_STORAGE_KEY = "chopin:theme";

export function cachedThemePreference(): ThemePreference | undefined {
	try {
		let value = localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

export function applyThemePreference(preference: ThemePreference): void {
	let root = document.documentElement;
	let systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
	root.dataset.theme = resolveTheme(preference, systemDark);
}

/**
 * Paints the cached choice before the first render. The store that asks the
 * server and follows the system is kept out of the initial bundle and loads
 * beside the app.
 */
export function bootColorTheme(): void {
	applyThemePreference(cachedThemePreference() ?? DEFAULT_THEME_PREFERENCE);
	void import("./color-theme").then(module => module.startColorTheme());
}
