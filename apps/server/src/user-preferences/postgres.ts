import { corrupt } from "../storage/errors";
import { DEFAULT_PREFERENCES, isThemePreference } from "./model";

import type { SQL } from "bun";
import type { PreferenceStore, ThemePreference, UserPreferences } from "./model";

type Run = <T>(action: string, execute: () => Promise<T>) => Promise<T>;

type PreferenceRow = { theme: string };

function preferences(row: PreferenceRow | undefined): UserPreferences {
	if (!row) return { ...DEFAULT_PREFERENCES };
	if (!isThemePreference(row.theme)) throw corrupt("storage returned an invalid theme");
	return { theme: row.theme };
}

export class PostgresPreferenceStore implements PreferenceStore {
	readonly #sql: SQL;
	readonly #run: Run;

	constructor(sql: SQL, run: Run) {
		this.#sql = sql;
		this.#run = run;
	}

	get(userId: string): Promise<UserPreferences> {
		return this.#run("read user preferences", async () => {
			let sql = this.#sql;
			let [found]: PreferenceRow[] = await sql`
				SELECT theme FROM user_preferences WHERE user_id = ${userId}
			`;
			return preferences(found);
		});
	}

	setTheme(userId: string, theme: ThemePreference, now: Date): Promise<UserPreferences> {
		return this.#run("save user preferences", async () => {
			let sql = this.#sql;
			let [saved]: PreferenceRow[] = await sql`
				INSERT INTO user_preferences (user_id, theme, updated_at)
				VALUES (${userId}, ${theme}, ${now})
				ON CONFLICT (user_id) DO UPDATE SET
					theme = EXCLUDED.theme,
					updated_at = EXCLUDED.updated_at
				RETURNING theme
			`;
			if (!saved) throw corrupt("saving user preferences returned no record");
			return preferences(saved);
		});
	}
}
