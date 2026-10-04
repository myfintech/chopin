import { DEFAULT_PREFERENCES } from "./model";

import type { PreferenceStore, UserPreferences } from "./model";

export class MemoryPreferenceStore implements PreferenceStore {
	#preferences = new Map<string, UserPreferences>();

	get(userId: string): Promise<UserPreferences> {
		return Promise.resolve({ ...(this.#preferences.get(userId) ?? DEFAULT_PREFERENCES) });
	}

	setTheme(userId: string, theme: UserPreferences["theme"]): Promise<UserPreferences> {
		let saved = { ...(this.#preferences.get(userId) ?? DEFAULT_PREFERENCES), theme };
		this.#preferences.set(userId, saved);
		return Promise.resolve({ ...saved });
	}
}
