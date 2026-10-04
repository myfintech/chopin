export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type UserPreferences = { theme: ThemePreference };

/** A user who never chose follows the operating system. */
export const DEFAULT_PREFERENCES: UserPreferences = { theme: "system" };

export function isThemePreference(value: unknown): value is ThemePreference {
	return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** Per-user interface preferences, applied on every sign-in. */
export interface PreferenceStore {
	get(userId: string): Promise<UserPreferences>;
	setTheme(userId: string, theme: ThemePreference, now: Date): Promise<UserPreferences>;
}
